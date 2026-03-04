"""
Billing Tasks for Celery Worker

STANDALONE VERSION - Does not depend on backend Settings.
Only requires: REDIS_URL, SUPABASE_URL, SUPABASE_KEY

Main tasks:
- process_unbilled_usage: Periodic task that processes unbilled token usage logs
- process_company_billing: On-demand task to process specific company
"""

import logging
import os
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from celery import shared_task

from supabase import Client, create_client

logger = logging.getLogger(__name__)

# Constants
BATCH_SIZE = int(os.getenv("BILLING_BATCH_SIZE", "1000"))


def get_dollar_rate() -> Decimal:
    """Get dollar rate from env var."""
    return Decimal(os.getenv("DOLLAR_RATE", "6.00"))


# ============================================================================
# STANDALONE SUPABASE CLIENT (no Settings dependency)
# ============================================================================

_supabase_client: Optional[Client] = None


def get_supabase_client() -> Client:
    """Get Supabase client - standalone, no Settings dependency."""
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY environment variables are required")
        _supabase_client = create_client(url, key)
        logger.info("[Billing Worker] Supabase client initialized")
    return _supabase_client


# ============================================================================
# BILLING CORE (uses shared code, no Settings dependency)
# ============================================================================

# Import BillingCore from workers package (avoids app.services.__init__ chain)
from app.workers.billing_core import BillingCore


def get_billing_service() -> BillingCore:
    """Get billing service instance for worker. Uses BillingCore directly."""
    supabase = get_supabase_client()
    return BillingCore(supabase)


# ============================================================================
# PRICING HELPER
# ============================================================================

def get_pricing_for_model(supabase: Client, model_name: str) -> Dict[str, Any]:
    """
    Get pricing info for a model from llm_pricing table.
    Returns dict with input_price, output_price, sell_multiplier.
    """
    try:
        result = supabase.table("llm_pricing") \
            .select("input_price_per_million, output_price_per_million, sell_multiplier") \
            .eq("model_name", model_name) \
            .single() \
            .execute()

        if result.data:
            return {
                "input_price": Decimal(str(result.data.get("input_price_per_million", 0))),
                "output_price": Decimal(str(result.data.get("output_price_per_million", 0))),
                "sell_multiplier": Decimal(str(result.data.get("sell_multiplier", 2.68)))
            }
    except Exception as e:
        logger.warning(f"[Billing] Pricing not found for {model_name}, using default: {e}")

    # Default fallback
    return {
        "input_price": Decimal("1.00"),
        "output_price": Decimal("3.00"),
        "sell_multiplier": Decimal("2.68")
    }


# ============================================================================
# CELERY TASKS
# ============================================================================

@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 3},
    name="app.workers.billing_tasks.process_unbilled_usage"
)
def process_unbilled_usage(self):
    """
    Periodic task: Process all unbilled token usage logs.

    Algorithm:
    1. Fetch unbilled logs (billed = false), limit BATCH_SIZE
    2. Group by (company_id, agent_id, model_name) - CADA COMBINAÇÃO SEPARADA
    3. For each group, calculate cost using correct model pricing
    4. Debit individual transactions (preserving agent_id and model_name)
    5. Mark logs as billed
    """
    logger.info("[Billing Worker] Starting process_unbilled_usage...")

    try:
        supabase = get_supabase_client()
        billing_service = get_billing_service()

        # Fetch unbilled logs
        result = supabase.table("token_usage_logs") \
            .select("id, company_id, model_name, input_tokens, output_tokens, total_cost_usd, agent_id") \
            .eq("billed", False) \
            .order("created_at") \
            .limit(BATCH_SIZE) \
            .execute()

        logs = result.data or []

        if not logs:
            logger.info("[Billing Worker] No unbilled logs found.")
            return {"processed": 0, "transactions": 0}

        logger.info(f"[Billing Worker] Found {len(logs)} unbilled logs to process.")

        # 🔥 CORRIGIDO: Agrupar por (company_id, agent_id, model_name)
        # Cada combinação vira uma transação separada
        grouped: Dict[tuple, List[Dict]] = {}
        for log in logs:
            company_id = log.get("company_id")
            agent_id = log.get("agent_id") or "no_agent"
            model_name = log.get("model_name", "unknown")

            if not company_id:
                continue

            key = (company_id, agent_id, model_name)
            if key not in grouped:
                grouped[key] = []
            grouped[key].append(log)

        processed_count = 0
        transactions_count = 0

        # Process each (company, agent, model) combination
        for (company_id, agent_id, model_name), group_logs in grouped.items():
            try:
                # Get pricing for THIS specific model
                pricing = get_pricing_for_model(supabase, model_name)
                multiplier = pricing["sell_multiplier"]

                # Calculate total cost for this group
                total_cost_brl = Decimal("0")
                total_input_tokens = 0
                total_output_tokens = 0
                log_ids = []

                for log in group_logs:
                    cost_usd = Decimal(str(log.get("total_cost_usd", 0)))
                    cost_brl = cost_usd * get_dollar_rate() * multiplier
                    total_cost_brl += cost_brl
                    total_input_tokens += log.get("input_tokens", 0)
                    total_output_tokens += log.get("output_tokens", 0)
                    log_ids.append(log["id"])

                if total_cost_brl > 0:
                    # Debit from company credits - PRESERVA agent_id E model_name
                    billing_service.debit_credits(
                        company_id=company_id,
                        agent_id=agent_id if agent_id != "no_agent" else None,
                        amount_brl=total_cost_brl,
                        model_name=model_name,  # 🔥 USA O MODELO REAL
                        tokens_input=total_input_tokens,
                        tokens_output=total_output_tokens
                    )

                    logger.info(
                        f"[Billing Worker] Debited R${total_cost_brl:.4f} from company {company_id} | "
                        f"agent={agent_id} | model={model_name} | logs={len(group_logs)}"
                    )
                    transactions_count += 1

                # Mark logs as billed
                now = datetime.utcnow().isoformat()
                for log_id in log_ids:
                    supabase.table("token_usage_logs") \
                        .update({"billed": True, "billed_at": now}) \
                        .eq("id", log_id) \
                        .execute()

                processed_count += len(log_ids)

            except Exception as e:
                logger.error(f"[Billing Worker] Error processing {company_id}/{agent_id}/{model_name}: {e}")
                continue

        logger.info(
            f"[Billing Worker] Completed. Processed {processed_count} logs, "
            f"created {transactions_count} transactions."
        )

        return {
            "processed": processed_count,
            "transactions": transactions_count
        }

    except Exception as e:
        logger.error(f"[Billing Worker] Critical error: {e}")
        raise


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    name="app.workers.billing_tasks.process_company_billing"
)
def process_company_billing(self, company_id: str):
    """
    On-demand task: Process unbilled logs for a specific company.
    """
    logger.info(f"[Billing Worker] Processing company {company_id}...")

    try:
        supabase = get_supabase_client()
        billing_service = get_billing_service()

        # Fetch unbilled logs for this company
        result = supabase.table("token_usage_logs") \
            .select("id, model_name, input_tokens, output_tokens, total_cost_usd, agent_id") \
            .eq("company_id", company_id) \
            .eq("billed", False) \
            .execute()

        logs = result.data or []

        if not logs:
            logger.info(f"[Billing Worker] No unbilled logs for company {company_id}")
            return {"processed": 0, "cost_brl": 0}

        total_cost_brl = Decimal("0")
        log_ids = []

        for log in logs:
            model = log.get("model_name", "unknown")
            cost_usd = Decimal(str(log.get("total_cost_usd", 0)))

            pricing = get_pricing_for_model(supabase, model)
            multiplier = pricing["sell_multiplier"]

            cost_brl = cost_usd * get_dollar_rate() * multiplier
            total_cost_brl += cost_brl
            log_ids.append(log["id"])

        if total_cost_brl > 0:
            first_log = logs[0]
            billing_service.debit_credits(
                company_id=company_id,
                agent_id=first_log.get("agent_id"),
                amount_brl=total_cost_brl,
                model_name="batch_processing",
                tokens_input=sum(log.get("input_tokens", 0) for log in logs),
                tokens_output=sum(log.get("output_tokens", 0) for log in logs)
            )

        # Mark as billed
        now = datetime.utcnow().isoformat()
        for log_id in log_ids:
            supabase.table("token_usage_logs") \
                .update({"billed": True, "billed_at": now}) \
                .eq("id", log_id) \
                .execute()

        logger.info(
            f"[Billing Worker] Company {company_id}: Processed {len(logs)} logs, "
            f"debited R${total_cost_brl:.4f}"
        )

        return {
            "processed": len(logs),
            "cost_brl": float(total_cost_brl)
        }

    except Exception as e:
        logger.error(f"[Billing Worker] Error processing company {company_id}: {e}")
        raise
