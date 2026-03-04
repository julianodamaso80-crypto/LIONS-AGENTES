import asyncio
import logging
import os
from typing import Tuple

logger = logging.getLogger(__name__)


class HybridSafetyService:
    """
    Singleton service for comprehensive AI safety checks using Groq.

    Combina dois modelos especializados:
    1. Llama Prompt Guard 2 (86M) -> Detecta Jailbreak/Prompt Injection
    2. Llama Guard 4 (11B) -> Detecta NSFW, Hate, Violence, Self-Harm

    Estratégia:
    - Executa Prompt Guard primeiro (rápido, focado em ataques)
    - Se passar e check_nsfw estiver ativo, executa Llama Guard 4
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        """Initialize Groq client (called once per singleton)."""
        self.groq_client = None

        try:
            from groq import Groq
            self.groq_api_key = os.getenv("GROQ_API_KEY")

            if self.groq_api_key:
                self.groq_client = Groq(api_key=self.groq_api_key)
                logger.info("[SAFETY] ✅ Groq client initialized")
            else:
                logger.warning("[SAFETY] ⚠️ GROQ_API_KEY not found in environment")

        except ImportError:
            logger.error("[SAFETY] ❌ Groq SDK not installed. Run: pip install groq")

        logger.info(f"[SAFETY] Service ready (Groq available: {bool(self.groq_client)})")

    async def _call_model(self, model: str, message: str) -> str:
        """Executa chamada ao Groq via thread async."""
        try:
            chat_completion = await asyncio.to_thread(
                self.groq_client.chat.completions.create,
                messages=[{"role": "user", "content": message}],
                model=model,
                temperature=0.0,
            )
            return chat_completion.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"[SAFETY] ❌ Groq API error ({model}): {e}")
            raise e

    async def validate_jailbreak(self, message: str, fail_close: bool = True) -> Tuple[bool, str]:
        """
        Verifica Jailbreak/Injection usando Llama Prompt Guard 2.
        Retorna: (is_malicious, reason)
        """
        if not self.groq_client:
            return False, ""

        try:
            result = await self._call_model("meta-llama/llama-prompt-guard-2-86m", message)

            # Prompt Guard 2 retorna "MALICIOUS" ou "BENIGN"
            if "MALICIOUS" in result.upper():
                logger.warning("[SAFETY] 🚨 Prompt Injection/Jailbreak detected (Prompt Guard 2)")
                return True, "Tentativa de manipulação detectada"

            return False, ""
        except Exception as e:
            if fail_close:
                logger.error(f"[SAFETY] ❌ Fail-Close triggered via Jailbreak check: {e}")
                return True, "Serviço de segurança indisponível (Fail-Close)"
            return False, ""

    async def validate_toxicity(self, message: str, skip_categories: list = None, fail_close: bool = True) -> Tuple[bool, str]:
        """
        Verifica NSFW/Hate/Violence usando Llama Guard 4.

        Args:
            message: Texto a validar
            skip_categories: Lista de categorias a ignorar (ex: ['S7'] para privacy)

        Retorna: (is_unsafe, reason)
        """
        if not self.groq_client:
            return False, ""

        skip_categories = skip_categories or []

        try:
            result = await self._call_model("meta-llama/llama-guard-4-12b", message)

            # Llama Guard 4 retorna "unsafe\nS1, S2..." ou "safe"
            if result.lower().startswith("unsafe"):
                # Extrai categorias
                raw_categories = result.replace("unsafe", "").strip().split(",")
                categories = [c.strip() for c in raw_categories if c.strip()]

                # Filtra categorias ignoradas
                active_categories = [c for c in categories if c not in skip_categories]

                if active_categories:
                    logger.warning(f"[SAFETY] 🚨 Content blocking triggered: {active_categories} (Llama Guard 4)")
                    return True, "Conteúdo bloqueado por violação de segurança"
                else:
                    logger.info(f"[SAFETY] ⚠️ Skipped categories: {categories} (User config)")
                    return False, ""

            return False, ""
            return False, ""
        except Exception as e:
            if fail_close:
                logger.error(f"[SAFETY] ❌ Fail-Close triggered via Toxicity check: {e}")
                return True, "Serviço de segurança indisponível (Fail-Close)"
            return False, ""

    async def validate_all(
        self,
        message: str,
        check_jailbreak: bool = True,
        check_nsfw: bool = True,
        skip_categories: list = None,
        fail_close: bool = True
    ) -> Tuple[bool, str]:
        """
        Facade que executa validações sequenciais.

        Args:
            skip_categories: Categorias do Llama Guard a ignorar (ex: ['S7'] para privacy)
        """
        # 1. Check Jailbreak (Prioridade)
        if check_jailbreak:
            is_jailbreak, reason = await self.validate_jailbreak(message, fail_close=fail_close)
            if is_jailbreak:
                return True, reason

        # 2. Check Toxicity (Se passar no jailbreak)
        if check_nsfw:
            is_toxic, reason = await self.validate_toxicity(message, skip_categories=skip_categories, fail_close=fail_close)
            if is_toxic:
                return True, reason

        return False, ""


# Alias para manter compatibilidade
LlamaGuardService = HybridSafetyService

def get_llama_guard_service():
    """Retorna instância singleton do HybridSafetyService."""
    return HybridSafetyService()
