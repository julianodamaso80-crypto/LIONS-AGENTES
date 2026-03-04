"""
Stripe Checkout Endpoints

Create Stripe Checkout Sessions for:
- Subscription purchases
- Credit top-ups (future)
"""

import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_company_id
from app.core.config import settings
from app.core.database import AsyncSupabaseClient, get_async_db
from app.services.billing_service import get_billing_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Configure Stripe API key once at module level
if settings.STRIPE_SECRET_KEY:
    stripe.api_key = settings.STRIPE_SECRET_KEY


class SubscriptionCheckoutRequest(BaseModel):
    """Request to create subscription checkout session."""
    plan_id: str = Field(..., description="UUID of the plan to subscribe to")
    success_url: str = Field(..., description="URL to redirect after successful payment")
    cancel_url: str = Field(..., description="URL to redirect if user cancels")


class TopupCheckoutRequest(BaseModel):
    """Request to create credit topup checkout session."""
    amount_brl: float = Field(..., gt=0, description="Amount in BRL to add")
    success_url: str = Field(..., description="URL to redirect after successful payment")
    cancel_url: str = Field(..., description="URL to redirect if user cancels")


class CheckoutResponse(BaseModel):
    """Response with checkout URL."""
    checkout_url: str
    session_id: str


@router.post("/checkout/subscription", response_model=CheckoutResponse)
async def create_subscription_checkout(
    checkout_request: SubscriptionCheckoutRequest,
    company_id: str = Depends(get_current_company_id),
    db: AsyncSupabaseClient = Depends(get_async_db)
):
    """
    Create a Stripe Checkout Session for a subscription plan.

    SECURITY: company_id is extracted via centralized auth dependency.

    Flow:
    1. Validate plan exists and has stripe_price_id
    2. Get or create Stripe Customer for the company
    3. Create Checkout Session
    4. Return checkout URL
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe not configured"
        )

    # Fetch plan
    plan_result = await db.client.table("plans") \
        .select("id, name, stripe_price_id, price_brl, is_active") \
        .eq("id", checkout_request.plan_id) \
        .single() \
        .execute()

    if not plan_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found"
        )

    plan = plan_result.data

    if not plan.get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plan is not active"
        )

    if not plan.get("stripe_price_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plan does not have Stripe pricing configured"
        )

    # Get or create Stripe customer
    billing_service = get_billing_service()
    stripe_customer_id = billing_service.get_or_create_stripe_customer(company_id)

    if not stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not create Stripe customer. Ensure company has an owner with email."
        )

    # Create Checkout Session
    try:

        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=stripe_customer_id,
            line_items=[{
                "price": plan["stripe_price_id"],
                "quantity": 1
            }],
            success_url=checkout_request.success_url + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=checkout_request.cancel_url,
            metadata={
                "company_id": company_id,
                "plan_id": checkout_request.plan_id
            },
            subscription_data={
                "metadata": {
                    "company_id": company_id,
                    "plan_id": checkout_request.plan_id
                }
            }
        )

        logger.info(f"[Stripe Checkout] Created session {session.id} for company {company_id}, plan {plan['name']}")

        return CheckoutResponse(
            checkout_url=session.url,
            session_id=session.id
        )

    except stripe.error.StripeError as e:
        logger.error(f"[Stripe Checkout] Error creating session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stripe error: {str(e)}"
        ) from e


@router.post("/checkout/topup", response_model=CheckoutResponse)
async def create_topup_checkout(
    checkout_request: TopupCheckoutRequest,
    company_id: str = Depends(get_current_company_id),
    db: AsyncSupabaseClient = Depends(get_async_db)
):
    """
    Create a Stripe Checkout Session for a one-time credit top-up.

    SECURITY: company_id is extracted via centralized auth dependency.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe not configured"
        )

    # Get or create Stripe customer
    billing_service = get_billing_service()
    stripe_customer_id = billing_service.get_or_create_stripe_customer(company_id)

    if not stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not create Stripe customer"
        )

    try:
        # Amount in centavos (Stripe uses smallest currency unit)
        amount_centavos = int(checkout_request.amount_brl * 100)

        session = stripe.checkout.Session.create(
            mode="payment",
            customer=stripe_customer_id,
            line_items=[{
                "price_data": {
                    "currency": "brl",
                    "unit_amount": amount_centavos,
                    "product_data": {
                        "name": f"Créditos - R$ {checkout_request.amount_brl:.2f}",
                        "description": "Recarga de créditos para uso da plataforma"
                    }
                },
                "quantity": 1
            }],
            success_url=checkout_request.success_url + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=checkout_request.cancel_url,
            metadata={
                "company_id": company_id,
                "type": "topup",
                "amount_brl": str(checkout_request.amount_brl)
            }
        )

        logger.info(f"[Stripe Checkout] Created topup session {session.id} for company {company_id}, R${checkout_request.amount_brl}")

        return CheckoutResponse(
            checkout_url=session.url,
            session_id=session.id
        )

    except stripe.error.StripeError as e:
        logger.error(f"[Stripe Checkout] Error creating topup session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stripe error: {str(e)}"
        ) from e


@router.get("/checkout/session/{session_id}")
async def get_checkout_session(session_id: str):
    """
    Get details of a checkout session.

    Useful for checking payment status after redirect.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe not configured"
        )

    try:
        session = stripe.checkout.Session.retrieve(session_id)

        return {
            "session_id": session.id,
            "status": session.status,
            "payment_status": session.payment_status,
            "customer": session.customer,
            "subscription": session.subscription,
            "metadata": session.metadata
        }

    except stripe.error.StripeError as e:
        logger.error(f"[Stripe Checkout] Error retrieving session: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        ) from e


# =============================================================================
# BILLING PORTAL
# =============================================================================

class PortalRequest(BaseModel):
    """Request to create billing portal session."""
    return_url: str = Field(..., description="URL to return to after portal session")


@router.post("/checkout/portal")
async def create_portal_session(
    portal_request: PortalRequest,
    company_id: str = Depends(get_current_company_id),
    db: AsyncSupabaseClient = Depends(get_async_db)
):
    """
    Create a Stripe Billing Portal session.

    SECURITY: company_id is extracted via centralized auth dependency.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe not configured"
        )

    try:
        logger.info(f"[Stripe Portal] Creating portal session for company: {company_id}")

        # Get stripe_customer_id from subscription
        result = await db.client.table("subscriptions") \
            .select("stripe_customer_id") \
            .eq("company_id", company_id) \
            .limit(1) \
            .execute()

        if not result.data or not result.data[0].get("stripe_customer_id"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nenhuma assinatura encontrada. Você precisa ter uma assinatura para acessar o portal."
            )

        customer_id = result.data[0]["stripe_customer_id"]

        portal_session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=portal_request.return_url,
        )

        logger.info(f"[Stripe Portal] ✅ Portal session created for customer: {customer_id}")

        return {
            "portal_url": portal_session.url,
            "session_id": portal_session.id
        }

    except stripe.error.StripeError as e:
        logger.error(f"[Stripe Portal] Error creating portal session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao criar sessão do portal: {str(e)}"
        ) from e
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Stripe Portal] Unexpected error: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro inesperado: {str(e)}"
        ) from e


# =============================================================================
# UPGRADE/DOWNGRADE ENDPOINTS (Legacy - use portal instead)
# =============================================================================

class ChangePlanRequest(BaseModel):
    """Request to change subscription plan."""
    new_plan_id: str = Field(..., description="UUID of the new plan")
    proration_behavior: str = Field(
        default="always_invoice",
        description="always_invoice, create_prorations, or none"
    )


@router.post("/change-plan")
async def change_subscription_plan(
    change_request: ChangePlanRequest,
    company_id: str = Depends(get_current_company_id),
    db: AsyncSupabaseClient = Depends(get_async_db)
):
    """
    Altera o plano de uma assinatura existente.

    SECURITY: company_id is extracted via centralized auth dependency.

    O Stripe calcula automaticamente o rateio (proration):
    - Upgrade: cobra diferença proporcional imediatamente
    - Downgrade: gera crédito para próxima fatura
    """
    from datetime import datetime

    logger.info(f"[Stripe] change-plan called with new_plan_id: {change_request.new_plan_id}")

    try:
        if not settings.STRIPE_SECRET_KEY:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Stripe not configured"
            )

        logger.info(f"[Stripe] company_id: {company_id}")

        # 1. Buscar subscription ativa da empresa (using async db)
        sub_result = await db.client.table("subscriptions") \
            .select("stripe_subscription_id, plan_id") \
            .eq("company_id", company_id) \
            .eq("status", "active") \
            .limit(1) \
            .execute()

        logger.info(f"[Stripe] sub_result: {sub_result.data}")

        if not sub_result.data or not sub_result.data[0].get("stripe_subscription_id"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nenhuma assinatura ativa encontrada"
            )

        stripe_subscription_id = sub_result.data[0]["stripe_subscription_id"]
        current_plan_id = sub_result.data[0]["plan_id"]
        logger.info(f"[Stripe] stripe_subscription_id: {stripe_subscription_id}")

        # 2. Verificar se é o mesmo plano
        if current_plan_id == change_request.new_plan_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Você já está neste plano"
            )

        # 3. Buscar novo plano
        plan_result = await db.client.table("plans") \
            .select("id, name, price_brl, stripe_price_id") \
            .eq("id", change_request.new_plan_id) \
            .eq("is_active", True) \
            .limit(1) \
            .execute()

        logger.info(f"[Stripe] plan_result: {plan_result.data}")

        if not plan_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Plano não encontrado"
            )

        new_plan = plan_result.data[0]

        if not new_plan.get("stripe_price_id"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Plano não configurado para pagamento"
            )

        # 4. Buscar subscription no Stripe para pegar o subscription_item_id
        logger.info(f"[Stripe] Retrieving subscription: {stripe_subscription_id}")

        stripe_sub = stripe.Subscription.retrieve(stripe_subscription_id)
        logger.info("[Stripe] Subscription retrieved successfully")

        # Log subscription object for debugging
        logger.info(f"[Stripe] Subscription type: {type(stripe_sub)}")
        logger.info(f"[Stripe] Has items attr: {hasattr(stripe_sub, 'items')}")

        # Try to access items in a safe way
        try:
            items = stripe_sub["items"]
            items_data = items["data"]
            logger.info(f"[Stripe] Items data length: {len(items_data)}")

            if not items_data:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Subscription sem items"
                )

            subscription_item_id = items_data[0]["id"]
            logger.info(f"[Stripe] Subscription item ID: {subscription_item_id}")

        except (KeyError, TypeError) as e:
            logger.error(f"[Stripe] Error accessing items: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Erro ao acessar items da subscription: {str(e)}"
            ) from e

        # 5. Atualizar subscription com novo plano
        logger.info(f"[Stripe] Modifying subscription to price: {new_plan['stripe_price_id']}")
        stripe.Subscription.modify(
            stripe_subscription_id,
            items=[{
                "id": subscription_item_id,
                "price": new_plan["stripe_price_id"],
            }],
            proration_behavior=change_request.proration_behavior,
        )
        logger.info("[Stripe] Subscription modified successfully")

        # 6. Atualizar plano no banco local
        await db.client.table("subscriptions").update({
            "plan_id": change_request.new_plan_id,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("stripe_subscription_id", stripe_subscription_id).execute()

        logger.info(f"[Stripe] ✅ Plan changed for company {company_id}: {current_plan_id} → {change_request.new_plan_id}")

        return {
            "status": "success",
            "message": f"Plano alterado para {new_plan['name']}",
            "new_plan": new_plan["name"],
            "proration_behavior": change_request.proration_behavior
        }

    except stripe.error.StripeError as e:
        logger.error(f"[Stripe] Stripe API error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao alterar plano: {str(e)}"
        ) from e
    except HTTPException:
        raise  # Re-raise HTTPExceptions
    except Exception as e:
        logger.error(f"[Stripe] Unexpected error: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro inesperado: {type(e).__name__}: {str(e)}"
        ) from e


@router.post("/preview-change")
async def preview_plan_change(
    change_request: ChangePlanRequest,
    company_id: str = Depends(get_current_company_id),
    db: AsyncSupabaseClient = Depends(get_async_db)
):
    """
    Preview do rateio antes de mudar de plano.

    SECURITY: company_id is extracted via centralized auth dependency.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe not configured"
        )

    # Buscar subscription (using async db)
    sub_result = await db.client.table("subscriptions") \
        .select("stripe_subscription_id") \
        .eq("company_id", company_id) \
        .eq("status", "active") \
        .limit(1) \
        .execute()

    if not sub_result.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nenhuma assinatura ativa"
        )

    stripe_subscription_id = sub_result.data[0]["stripe_subscription_id"]

    # Buscar novo plano (using async db)
    plan_result = await db.client.table("plans") \
        .select("stripe_price_id, name, price_brl") \
        .eq("id", change_request.new_plan_id) \
        .limit(1) \
        .execute()

    if not plan_result.data or not plan_result.data[0].get("stripe_price_id"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plano não encontrado"
        )

    new_plan = plan_result.data[0]

    try:
        # Buscar subscription atual
        stripe_sub = stripe.Subscription.retrieve(stripe_subscription_id)

        # Access items directly from subscription object
        if not stripe_sub.items or not stripe_sub.items.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Subscription sem items"
            )

        subscription_item_id = stripe_sub.items.data[0].id
        customer_id = stripe_sub.customer

        # Preview da invoice com as mudanças
        preview = stripe.Invoice.upcoming(
            customer=customer_id,
            subscription=stripe_subscription_id,
            subscription_items=[{
                "id": subscription_item_id,
                "price": new_plan["stripe_price_id"],
            }],
            subscription_proration_behavior="always_invoice",
        )

        # Calcular valores de proration
        proration_amount = 0
        lines_info = []

        for line in preview.lines.data:
            line_amount = line.amount or 0
            is_proration = getattr(line, 'proration', False)

            if is_proration:
                proration_amount += line_amount

            lines_info.append({
                "description": line.description or "",
                "amount": line_amount / 100,  # Stripe usa centavos
                "proration": is_proration
            })

        return {
            "new_plan_name": new_plan["name"],
            "new_plan_price": new_plan["price_brl"],
            "total": (preview.total or 0) / 100,
            "proration_amount": proration_amount / 100,
            "currency": preview.currency or "brl",
            "lines": lines_info
        }

    except stripe.error.StripeError as e:
        logger.error(f"[Stripe] Preview error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao calcular preview: {str(e)}"
        ) from e

