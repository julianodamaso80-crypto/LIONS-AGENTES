"""
Stripe Webhook Handler

Processes Stripe webhook events for subscription management:
- checkout.session.completed: Activate new subscription + add credits
- invoice.paid: Renew subscription + add credits
- customer.subscription.deleted: Cancel subscription
"""

import logging
from datetime import datetime
from decimal import Decimal

import stripe
from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import settings
from app.services.billing_service import get_billing_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/stripe")
async def stripe_webhook(request: Request):
    """
    Receive and process Stripe webhook events.

    Security: Validates webhook signature using STRIPE_WEBHOOK_SECRET.
    Idempotency: Uses stripe_payment_id to prevent duplicate processing.
    """
    # Get raw body for signature verification
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        logger.warning("[Stripe Webhook] Missing stripe-signature header")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing stripe-signature header"
        )

    if not settings.STRIPE_WEBHOOK_SECRET:
        logger.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook secret not configured"
        )

    # Verify webhook signature
    try:
        stripe.api_key = settings.STRIPE_SECRET_KEY
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as e:
        logger.error(f"[Stripe Webhook] Invalid payload: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payload"
        ) from e
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"[Stripe Webhook] Invalid signature: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid signature"
        ) from e

    event_type = event["type"]
    logger.info(f"[Stripe Webhook] Received event: {event_type}")

    billing_service = get_billing_service()

    try:
        # Handle different event types
        if event_type == "checkout.session.completed":
            await handle_checkout_completed(event, billing_service)

        elif event_type == "invoice.paid":
            await handle_invoice_paid(event, billing_service)

        elif event_type == "invoice.payment_failed":
            await handle_invoice_payment_failed(event, billing_service)

        elif event_type == "customer.subscription.deleted":
            await handle_subscription_deleted(event, billing_service)

        elif event_type == "customer.subscription.updated":
            await handle_subscription_updated(event, billing_service)

        else:
            logger.debug(f"[Stripe Webhook] Unhandled event type: {event_type}")

        return {"status": "success", "event_type": event_type}

    except Exception as e:
        logger.error(f"[Stripe Webhook] Error processing {event_type}: {e}", exc_info=True)
        # Return 500 so Stripe will retry
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing webhook: {str(e)}"
        ) from e


async def handle_checkout_completed(event: dict, billing_service):
    """
    Handle checkout.session.completed event.

    Per Stripe best practices:
    - This event is for linking customer_id and creating the subscription record
    - Do NOT provision access/credits here
    - Credits are added when invoice.paid is received
    """
    session = event["data"]["object"]

    # Extract metadata (we pass company_id and plan_id during checkout creation)
    metadata = session.get("metadata", {})
    company_id = metadata.get("company_id")
    plan_id = metadata.get("plan_id")

    if not company_id or not plan_id:
        logger.error(f"[Stripe Webhook] checkout.session.completed missing metadata: {metadata}")
        raise ValueError("Missing company_id or plan_id in metadata")

    # Get subscription details
    stripe_subscription_id = session.get("subscription")
    stripe_customer_id = session.get("customer")

    if not stripe_subscription_id:
        logger.warning("[Stripe Webhook] No subscription in session (one-time payment?)")
        return

    # Fetch subscription from Stripe to get period dates
    subscription = stripe.Subscription.retrieve(stripe_subscription_id)

    try:
        items_data = subscription.get("items", {}).get("data", [])
        if items_data and len(items_data) > 0:
            first_item = items_data[0]
            period_start = first_item.get("current_period_start", 0)
            period_end = first_item.get("current_period_end", 0)
        else:
            period_start = subscription.get("created", 0)
            period_end = subscription.get("created", 0) + (30 * 24 * 60 * 60)

        current_period_start = datetime.fromtimestamp(int(period_start)) if period_start else datetime.utcnow()
        current_period_end = datetime.fromtimestamp(int(period_end)) if period_end else datetime.utcnow()
    except Exception as e:
        logger.warning(f"[Stripe Webhook] Error extracting period dates: {e}, using defaults")
        current_period_start = datetime.utcnow()
        current_period_end = datetime.utcnow()

    logger.info(f"[Stripe Webhook] Creating subscription record for company {company_id}, plan {plan_id} (credits via invoice.paid)")

    # Create subscription record WITHOUT adding credits
    # Credits will be added by invoice.paid event
    success = billing_service.setup_subscription(
        company_id=company_id,
        plan_id=plan_id,
        stripe_subscription_id=stripe_subscription_id,
        stripe_customer_id=stripe_customer_id,
        current_period_start=current_period_start,
        current_period_end=current_period_end
    )

    if success:
        logger.info(f"[Stripe Webhook] ✅ Subscription record created for company {company_id}")
    else:
        raise ValueError(f"Failed to setup subscription for company {company_id}")


async def handle_invoice_paid(event: dict, billing_service):
    """
    Handle invoice.paid event.

    Per Stripe best practices:
    - This is THE event for provisioning access/credits
    - Handles ALL billing_reasons: subscription_create, subscription_cycle, subscription_update
    """
    invoice = event["data"]["object"]

    billing_reason = invoice.get("billing_reason")

    # In Stripe API 2025+, the subscription field is deprecated
    # New location: invoice.parent.subscription_details.subscription
    stripe_subscription_id = invoice.get("subscription")  # Legacy field

    # Check new API location: parent.subscription_details.subscription
    if not stripe_subscription_id:
        parent = invoice.get("parent", {})
        if parent.get("type") == "subscription_details":
            sub_details = parent.get("subscription_details", {})
            stripe_subscription_id = sub_details.get("subscription")

    # Fallback: check lines.data[0].subscription
    if not stripe_subscription_id:
        lines_data = invoice.get("lines", {}).get("data", [])
        if lines_data:
            stripe_subscription_id = lines_data[0].get("subscription")
            # Also try lines.data[0].parent
            if not stripe_subscription_id:
                line_parent = lines_data[0].get("parent", {})
                if line_parent.get("type") == "subscription_item_details":
                    stripe_subscription_id = line_parent.get("subscription_item_details", {}).get("subscription")

    logger.info(f"[Stripe Webhook] invoice.paid: billing_reason={billing_reason}, subscription={stripe_subscription_id}")

    if not stripe_subscription_id:
        logger.info("[Stripe Webhook] Invoice not related to subscription, skipping")
        return

    # Process ALL subscription-related invoices
    if billing_reason not in ["subscription_create", "subscription_cycle", "subscription_update"]:
        logger.info(f"[Stripe Webhook] Unhandled billing_reason: {billing_reason}, skipping")
        return

    # Use invoice ID as payment identifier for idempotency
    stripe_payment_id = invoice.get("id")

    # Check idempotency first
    if billing_service.is_payment_processed(stripe_payment_id):
        logger.info(f"[Stripe Webhook] Invoice {stripe_payment_id} already processed, skipping")
        return

    # Extract the REAL amount paid (converting from centavos to BRL)
    amount_paid_cents = invoice.get("amount_paid", 0)
    amount_paid_brl = Decimal(str(amount_paid_cents)) / Decimal("100")

    logger.info(f"[Stripe Webhook] Processing invoice: reason={billing_reason}, amount=R${amount_paid_brl}")

    # Fetch subscription from Stripe to get updated period dates
    subscription = stripe.Subscription.retrieve(stripe_subscription_id)

    try:
        items_data = subscription.get("items", {}).get("data", [])
        if items_data and len(items_data) > 0:
            first_item = items_data[0]
            period_start = first_item.get("current_period_start", 0)
            period_end = first_item.get("current_period_end", 0)
        else:
            period_start = subscription.get("created", 0)
            period_end = subscription.get("created", 0) + (30 * 24 * 60 * 60)

        current_period_start = datetime.fromtimestamp(int(period_start)) if period_start else datetime.utcnow()
        current_period_end = datetime.fromtimestamp(int(period_end)) if period_end else datetime.utcnow()
    except Exception as e:
        logger.warning(f"[Stripe Webhook] Error extracting period dates: {e}, using defaults")
        current_period_start = datetime.utcnow()
        current_period_end = datetime.utcnow()

    # For initial subscription, get company_id from subscription metadata or lookup
    company_id = None
    plan_id = None
    subscription_exists = False

    # Try to get from existing subscription record first
    sub_info = billing_service.get_subscription_by_stripe_id(stripe_subscription_id)
    if sub_info:
        company_id = sub_info.get("company_id")
        plan_id = sub_info.get("plan_id")
        subscription_exists = True

    if not company_id:
        # Subscription record doesn't exist yet (invoice.paid arrived before checkout.session.completed)
        # Get from subscription metadata
        sub_metadata = subscription.get("metadata", {})
        company_id = sub_metadata.get("company_id")
        plan_id = sub_metadata.get("plan_id")

    if not company_id or not plan_id:
        logger.error(f"[Stripe Webhook] Cannot find company_id/plan_id for subscription {stripe_subscription_id}")
        raise ValueError(f"Cannot find company_id/plan_id for subscription {stripe_subscription_id}")

    # If subscription record doesn't exist, create it first
    # This handles the race condition where invoice.paid arrives before checkout.session.completed
    if not subscription_exists:
        logger.info("[Stripe Webhook] Creating subscription record (invoice.paid arrived first)")
        stripe_customer_id = subscription.get("customer")
        billing_service.setup_subscription(
            company_id=company_id,
            plan_id=plan_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_customer_id=stripe_customer_id,
            current_period_start=current_period_start,
            current_period_end=current_period_end
        )

    # Add credits and update subscription
    success = billing_service.process_invoice_payment(
        stripe_subscription_id=stripe_subscription_id,
        stripe_payment_id=stripe_payment_id,
        amount_paid=amount_paid_brl,
        billing_reason=billing_reason,
        current_period_start=current_period_start,
        current_period_end=current_period_end
    )

    if success:
        reason_label = {
            "subscription_create": "activated",
            "subscription_cycle": "renewed",
            "subscription_update": "updated"
        }.get(billing_reason, billing_reason)
        logger.info(f"[Stripe Webhook] ✅ Subscription {reason_label}: {stripe_subscription_id}")
    else:
        raise ValueError(f"Failed to process invoice {stripe_payment_id}")


async def handle_invoice_payment_failed(event: dict, billing_service):
    """
    Handle invoice.payment_failed event.

    Marks subscription as 'past_due' so frontend can display a warning banner.
    """
    invoice = event["data"]["object"]

    billing_reason = invoice.get("billing_reason")
    invoice_id = invoice.get("id")
    customer_email = invoice.get("customer_email")

    logger.warning(f"[Stripe Webhook] 💳 PAYMENT FAILED: invoice={invoice_id}, email={customer_email}, reason={billing_reason}")

    # Get subscription ID using same logic as invoice.paid
    stripe_subscription_id = invoice.get("subscription")
    logger.info(f"[Stripe Webhook] Step 1: invoice.subscription = {stripe_subscription_id}")

    if not stripe_subscription_id:
        parent = invoice.get("parent", {})
        parent_type = parent.get("type")
        logger.info(f"[Stripe Webhook] Step 2: parent.type = {parent_type}")

        if parent_type == "subscription_details":
            sub_details = parent.get("subscription_details", {})
            stripe_subscription_id = sub_details.get("subscription")
            logger.info(f"[Stripe Webhook] Step 2b: parent.subscription_details.subscription = {stripe_subscription_id}")

    if not stripe_subscription_id:
        lines_data = invoice.get("lines", {}).get("data", [])
        logger.info(f"[Stripe Webhook] Step 3: lines.data count = {len(lines_data)}")

        if lines_data:
            # Old API: lines.data[0].subscription
            stripe_subscription_id = lines_data[0].get("subscription")
            logger.info(f"[Stripe Webhook] Step 3b: lines.data[0].subscription = {stripe_subscription_id}")

            if not stripe_subscription_id:
                line_parent = lines_data[0].get("parent", {})
                line_parent_type = line_parent.get("type")
                logger.info(f"[Stripe Webhook] Step 3c: lines.data[0].parent.type = {line_parent_type}")

                if line_parent_type == "subscription_item_details":
                    stripe_subscription_id = line_parent.get("subscription_item_details", {}).get("subscription")
                    logger.info(f"[Stripe Webhook] Step 3d: from subscription_item_details = {stripe_subscription_id}")

    if not stripe_subscription_id:
        logger.error(f"[Stripe Webhook] ❌ FAILED TO EXTRACT SUBSCRIPTION ID from invoice {invoice_id}!")
        logger.info(f"[Stripe Webhook] Full invoice keys: {list(invoice.keys())}")
        logger.info(f"[Stripe Webhook] invoice.parent = {invoice.get('parent')}")
        return

    logger.warning(f"[Stripe Webhook] ⚠️ Payment failed for subscription {stripe_subscription_id}")

    # Mark subscription as past_due
    success = billing_service.mark_subscription_past_due(stripe_subscription_id)

    if success:
        logger.info(f"[Stripe Webhook] ✅ Subscription {stripe_subscription_id} marked as past_due")
    else:
        logger.error(f"[Stripe Webhook] ❌ Failed to mark subscription {stripe_subscription_id} as past_due - check if subscription exists in database")


async def handle_subscription_deleted(event: dict, billing_service):
    """
    Handle customer.subscription.deleted event.

    This is triggered when a subscription is canceled (immediately or at period end).
    """
    subscription = event["data"]["object"]
    stripe_subscription_id = subscription.get("id")

    if not stripe_subscription_id:
        logger.error("[Stripe Webhook] subscription.deleted missing subscription ID")
        return

    success = billing_service.cancel_subscription(stripe_subscription_id)

    if success:
        logger.info(f"[Stripe Webhook] ✅ Subscription cancelled: {stripe_subscription_id}")
    else:
        logger.warning(f"[Stripe Webhook] Subscription not found for cancellation: {stripe_subscription_id}")


async def handle_subscription_updated(event: dict, billing_service):
    """
    Handle customer.subscription.updated event.

    - cancel_at has value: subscription is scheduled for cancellation
    - cancel_at is null: subscription active (or cancellation was reverted)
    """
    subscription = event["data"]["object"]
    stripe_subscription_id = subscription.get("id")

    if not stripe_subscription_id:
        logger.error("[Stripe Webhook] subscription.updated missing subscription ID")
        return

    # cancel_at: Unix timestamp if scheduled, None if active
    cancel_at = subscription.get("cancel_at")

    if cancel_at:
        logger.info(f"[Stripe Webhook] Subscription {stripe_subscription_id} scheduled to cancel at {cancel_at}")
    else:
        logger.info(f"[Stripe Webhook] Subscription {stripe_subscription_id} is active (no cancellation)")

    # Update cancel_at in database (null = no cancellation, timestamp = scheduled)
    billing_service.update_subscription_cancel_at(
        stripe_subscription_id=stripe_subscription_id,
        cancel_at=cancel_at
    )

    # Check for plan change
    items_data = subscription.get("items", {}).get("data", [])
    if not items_data:
        return

    new_price_id = items_data[0].get("price", {}).get("id")
    if not new_price_id:
        return

    logger.info(f"[Stripe Webhook] Subscription updated: {stripe_subscription_id}, new price: {new_price_id}")

    billing_service.update_subscription_plan_by_price(
        stripe_subscription_id=stripe_subscription_id,
        stripe_price_id=new_price_id
    )
