"""
Utils - Funções utilitárias centralizadas
"""

import logging
import os

logger = logging.getLogger(__name__)


def get_api_key_for_provider(provider: str = None, model: str = None) -> str:
    """
    Retorna API key do ambiente baseado no provider ou modelo.
    Centraliza lógica para evitar duplicação em múltiplos arquivos.

    Args:
        provider: 'openai', 'anthropic' ou 'google'
        model: Nome do modelo (fallback se provider não definido)

    Returns:
        API key do ambiente

    Raises:
        ValueError: Se a variável de ambiente não existir
    """
    # Se provider não definido, infere do modelo
    if not provider and model:
        if model.startswith(("gpt-", "o1", "o3")):
            provider = "openai"
        elif model.startswith("claude"):
            provider = "anthropic"
        elif model.startswith("gemini"):
            provider = "google"
        # OpenRouter models usam formato "provider/model" (ex: "meta-llama/llama-3.1-405b")
        elif "/" in model:
            provider = "openrouter"

    key_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "google": "GOOGLE_API_KEY",
        "openai": "OPENAI_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
    }

    env_var = key_map.get(provider, "OPENAI_API_KEY")
    api_key = os.getenv(env_var)

    if not api_key:
        raise ValueError(f"❌ Variável {env_var} ausente no .env para provider '{provider}'")

    return api_key
