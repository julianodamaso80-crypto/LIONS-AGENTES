"""
Usage Service - Token Usage and Cost Tracking for FinOps

Centralizes pricing calculations and logging to Supabase.
Now supports database-backed pricing with in-memory cache.
"""

import logging
import time
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Optional

from ..core.config import settings
from ..core.database import get_supabase_client

logger = logging.getLogger(__name__)


# ============================================================================
# CACHE GLOBAL (TTL 5 minutos)
# ============================================================================
_pricing_cache: Dict[str, dict] = {}
_cache_loaded_at: float = 0
CACHE_TTL_SECONDS = 300  # 5 minutos


# ============================================================================
# FALLBACK PRICING TABLE (usado se banco falhar)
# ============================================================================
PRICING_TABLE = {
    # Anthropic
    "claude-opus-4-6": {"input": 5.00, "output": 25.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00},
    "claude-opus-4-5-20251101": {"input": 5.00, "output": 25.00},
    "claude-sonnet-4-5-20250929": {"input": 3.00, "output": 15.00},
    "claude-opus-4-1-20250805": {"input": 15.00, "output": 75.00},
    "claude-opus-4-20250514": {"input": 15.00, "output": 75.00},
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
    "claude-3-7-sonnet-20250219": {"input": 3.00, "output": 15.00},
    "claude-3-5-sonnet-20241022": {"input": 3.00, "output": 15.00},
    "claude-3-5-sonnet-20240620": {"input": 3.00, "output": 15.00},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.00},
    "claude-opus-4-5": {"input": 5.00, "output": 25.00},
    "claude-sonnet-4-5": {"input": 3.00, "output": 15.00},
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},

    # OpenAI
    "gpt-5.2": {"input": 1.75, "output": 14.00},
    "gpt-5.2-pro": {"input": 21.00, "output": 168.00},
    "gpt-5.2-chat-latest": {"input": 1.75, "output": 14.00},
    "gpt-5.1": {"input": 1.25, "output": 10.00},
    "o3-pro": {"input": 15.00, "output": 60.00},
    "o3": {"input": 5.00, "output": 20.00},
    "o3-mini": {"input": 1.00, "output": 4.00},
    "o1": {"input": 15.00, "output": 60.00},
    "o1-pro": {"input": 30.00, "output": 120.00},
    "o1-mini": {"input": 3.00, "output": 12.00},
    "o1-preview": {"input": 15.00, "output": 60.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o-mini-2024-07-18": {"input": 0.15, "output": 0.60},
    "chatgpt-4o-latest": {"input": 5.00, "output": 15.00},

    # Google
    "gemini-3-pro-preview": {"input": 2.00, "output": 8.00},
    "gemini-3-deep-think": {"input": 5.00, "output": 20.00},
    "gemini-2.5-pro": {"input": 1.25, "output": 5.00},
    "gemini-2.5-flash": {"input": 0.10, "output": 0.40},
    "gemini-2.5-flash-lite": {"input": 0.05, "output": 0.20},
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},

    # Outros
    "grok-4": {"input": 2.00, "output": 10.00},
    "grok-3": {"input": 2.00, "output": 10.00},
    "deepseek-chat": {"input": 0.50, "output": 2.00},
    "mistral-large-latest": {"input": 2.00, "output": 6.00},
    "text-embedding-3-small": {"input": 0.02, "output": 0.0},
    "whisper-1": {"input": 0.006, "output": 0.0, "unit": "minute"},

    # OpenRouter — Exclusive models (not available via native providers)
    "meta-llama/llama-3.1-405b-instruct": {"input": 2.00, "output": 6.00},
    "meta-llama/llama-3.1-70b-instruct": {"input": 0.52, "output": 0.75},
    "deepseek/deepseek-chat": {"input": 0.14, "output": 0.28},
    "deepseek/deepseek-reasoner": {"input": 0.55, "output": 2.19},
    "mistralai/mistral-large": {"input": 2.00, "output": 6.00},
    "x-ai/grok-2": {"input": 2.00, "output": 10.00},
    "cohere/command-r-plus": {"input": 2.50, "output": 10.00},
    "qwen/qwen-2.5-72b-instruct": {"input": 0.36, "output": 0.36},
}


class UsageService:
    """
    Centralized service for tracking token usage and costs.
    Uses database-backed pricing with in-memory cache.
    """

    def __init__(self):
        self.supabase = get_supabase_client()
        self._ensure_cache_loaded()

    def _ensure_cache_loaded(self):
        """Carrega cache do banco se expirado ou vazio."""
        global _pricing_cache, _cache_loaded_at

        now = time.time()

        # Cache ainda válido
        if _pricing_cache and (now - _cache_loaded_at) < CACHE_TTL_SECONDS:
            return

        try:
            result = self.supabase.client.table("llm_pricing") \
                .select("model_name, input_price_per_million, output_price_per_million, unit, sell_multiplier, cache_write_multiplier, cache_read_multiplier, cached_input_multiplier") \
                .eq("is_active", True) \
                .execute()

            if result.data and len(result.data) > 0:
                _pricing_cache = {
                    row["model_name"]: {
                        "input": float(row["input_price_per_million"]),
                        "output": float(row["output_price_per_million"]),
                        "unit": row.get("unit") or "token",
                        "sell_multiplier": float(row.get("sell_multiplier") or 2.68),
                        # Cache multipliers (podem ser NULL)
                        "cache_write_multiplier": float(row["cache_write_multiplier"]) if row.get("cache_write_multiplier") else None,
                        "cache_read_multiplier": float(row["cache_read_multiplier"]) if row.get("cache_read_multiplier") else None,
                        "cached_input_multiplier": float(row["cached_input_multiplier"]) if row.get("cached_input_multiplier") else None,
                    }
                    for row in result.data
                }
                _cache_loaded_at = now
                logger.info(f"[UsageService] ✅ Pricing cache loaded from DB: {len(_pricing_cache)} models")
            else:
                # Banco vazio ou tabela não existe - usa fallback
                _pricing_cache = PRICING_TABLE.copy()
                _cache_loaded_at = now
                logger.warning("[UsageService] ⚠️ No pricing in DB, using hardcoded fallback")

        except Exception as e:
            # Erro de conexão/tabela - usa fallback
            logger.error(f"[UsageService] ❌ Failed to load pricing from DB: {e}")
            if not _pricing_cache:
                _pricing_cache = PRICING_TABLE.copy()
                _cache_loaded_at = now
                logger.info("[UsageService] Using hardcoded fallback due to DB error")

    def reload_cache(self):
        """Força reload do cache (chamar via API admin)."""
        global _cache_loaded_at
        _cache_loaded_at = 0  # Invalida cache
        self._ensure_cache_loaded()
        return len(_pricing_cache)

    def get_pricing(self, model: str) -> dict:
        """Retorna pricing do cache para um modelo."""
        self._ensure_cache_loaded()

        pricing = _pricing_cache.get(model)
        if not pricing:
            logger.warning(f"[UsageService] Unknown model: {model}, using gpt-4o-mini fallback")
            pricing = _pricing_cache.get("gpt-4o-mini", {"input": 0.15, "output": 0.60, "unit": "token"})

        return pricing

    def calculate_cost(
        self, model: str, input_tokens: int, output_tokens: int = 0,
        cache_creation_tokens: int = 0, cache_read_tokens: int = 0, cached_tokens: int = 0
    ) -> float:
        """
        Calculate cost in USD for a given model and token count.

        Supports cache tokens:
        - cache_creation_tokens: Anthropic cache write (1.25x input price)
        - cache_read_tokens: Anthropic cache read (0.10x input price)
        - cached_tokens: OpenAI cached (0.50x input price, already included in input_tokens)
        """
        pricing = self.get_pricing(model)

        # Check if this is audio (per-minute pricing)
        if pricing.get("unit") == "minute":
            minutes = input_tokens / 60.0
            return minutes * pricing["input"]

        input_price = pricing["input"]
        output_price = pricing["output"]

        # Cache multipliers do banco (com fallback hardcoded)
        cache_write_mult = pricing.get("cache_write_multiplier") or 1.25  # Anthropic default
        cache_read_mult = pricing.get("cache_read_multiplier") or 0.10   # Anthropic default
        cached_input_mult = pricing.get("cached_input_multiplier") or 0.50  # OpenAI default

        # Tokens cacheados JÁ estão incluídos em input_tokens, subtrair para não cobrar 2x
        # - OpenAI: cached_tokens
        # - Anthropic: cache_read_tokens (lidos) + cache_creation_tokens (escritos)
        # Obs: cache_creation paga 1.25x, não 1.0x + 0.25x extra
        # SAFETY: max(0, ...) previne valores negativos se API retornar dados inconsistentes
        regular_input_tokens = max(0, input_tokens - cached_tokens - cache_read_tokens - cache_creation_tokens)

        # Input normal (preço cheio) - tokens que não são de cache
        input_cost = (regular_input_tokens / 1_000_000) * input_price

        # OpenAI cache (usa multiplier do banco)
        openai_cache_cost = (cached_tokens / 1_000_000) * input_price * cached_input_mult

        # Anthropic cache write (usa multiplier do banco)
        cache_write_cost = (cache_creation_tokens / 1_000_000) * input_price * cache_write_mult

        # Anthropic cache read (usa multiplier do banco)
        cache_read_cost = (cache_read_tokens / 1_000_000) * input_price * cache_read_mult

        # Output
        output_cost = (output_tokens / 1_000_000) * output_price

        return input_cost + openai_cache_cost + cache_write_cost + cache_read_cost + output_cost

    def track_cost_sync(
        self,
        service_type: str,
        model: str,
        input_tokens: int,
        output_tokens: int = 0,
        company_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        cache_creation_tokens: int = 0,
        cache_read_tokens: int = 0,
        cached_tokens: int = 0,
    ) -> bool:
        """
        Synchronous version of track_cost for non-async contexts.
        Now supports cache token tracking.
        """
        try:
            cost = self.calculate_cost(
                model, input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens, cached_tokens
            )

            # Convert UUIDs to strings if passed as UUID objects
            if company_id and hasattr(company_id, 'hex'):
                company_id = str(company_id)
            if agent_id and hasattr(agent_id, 'hex'):
                agent_id = str(agent_id)

            log_entry = {
                "service_type": service_type,
                "model_name": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_cost_usd": cost,
                "details": details or {},
                "created_at": datetime.utcnow().isoformat(),
                "cache_creation_tokens": cache_creation_tokens,
                "cache_read_tokens": cache_read_tokens,
                "cached_tokens": cached_tokens,
            }

            if company_id:
                log_entry["company_id"] = company_id
            if agent_id:
                log_entry["agent_id"] = agent_id

            result = (
                self.supabase.client.table("token_usage_logs")
                .insert(log_entry)
                .execute()
            )

            if result.data:
                cache_info = ""
                if cache_creation_tokens or cache_read_tokens:
                    cache_info = f" | cache_w={cache_creation_tokens} cache_r={cache_read_tokens}"
                elif cached_tokens:
                    cache_info = f" | cached={cached_tokens}"

                logger.info(
                    f"[UsageService] ✅ Logged {service_type} | {model} | "
                    f"in={input_tokens} out={output_tokens}{cache_info} | ${cost:.6f}"
                )
                return True
            return False

        except Exception as e:
            logger.error(f"[UsageService] ❌ Failed to log usage: {e}")
            return False

    def calculate_and_debit_client(
        self,
        company_id: str,
        agent_id: Optional[str],
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """
        Calcula custo para o cliente (com multiplicador) e debita do saldo.

        Fórmula: custo_cliente_brl = custo_real_usd × DOLAR × sell_multiplier

        Args:
            company_id: ID da empresa
            agent_id: ID do agente (opcional)
            model: Nome do modelo LLM
            input_tokens: Tokens de entrada
            output_tokens: Tokens de saída

        Returns:
            Valor debitado em BRL (float)
        """
        from .billing_service import get_billing_service

        DOLLAR_RATE = settings.DOLLAR_RATE

        # Custo real em USD
        cost_usd = Decimal(str(self.calculate_cost(model, input_tokens, output_tokens)))

        # Busca multiplicador do modelo
        pricing = self.get_pricing(model)
        multiplier = Decimal(str(pricing.get("sell_multiplier", 2.68)))

        # Custo para o cliente em BRL
        cost_client_brl = cost_usd * DOLLAR_RATE * multiplier

        # Debita do saldo
        billing_service = get_billing_service()
        billing_service.debit_credits(
            company_id=company_id,
            agent_id=agent_id,
            amount_brl=cost_client_brl,
            model_name=model,
            tokens_input=input_tokens,
            tokens_output=output_tokens
        )

        logger.debug(
            f"[UsageService] Client debit: {model} | "
            f"USD ${cost_usd:.6f} → BRL R${cost_client_brl:.4f} (×{multiplier})"
        )

        return float(cost_client_brl)


# Singleton instance
_usage_service: Optional[UsageService] = None


def get_usage_service() -> UsageService:
    """Get or create singleton UsageService instance."""
    global _usage_service
    if _usage_service is None:
        _usage_service = UsageService()
    return _usage_service


def preload_pricing_cache():
    """
    Preload pricing cache on app startup.
    Call this in main.py lifespan to avoid cold start delay.
    """
    service = get_usage_service()
    count = service.reload_cache()
    logger.info(f"[UsageService] Preloaded {count} pricing entries")
    return count
