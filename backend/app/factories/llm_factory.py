"""
LLM Factory to decouple LLM creation from Graph logic.
"""
import logging
from typing import Any, Dict, Optional

from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from app.core.callbacks.cost_callback import CostCallbackHandler
from app.core.config import settings

logger = logging.getLogger(__name__)

class LLMFactory:
    @staticmethod
    def create_llm(
        company_config: Dict[str, Any],
        agent_data: Optional[Dict[str, Any]],
        api_key: str,
        company_id: str = None,
        agent_id: str = None,
    ):
        """
        Create LLM with hierarchy: Agent Config > Company Config.
        """
        if not api_key:
            raise ValueError(
                f"CRITICAL: API Key missing for agent {agent_id or 'Unknown'}."
            )

        source = agent_data if agent_data else company_config

        provider = source.get("llm_provider") or company_config.get(
            "llm_provider", "openai"
        )
        model = (source.get("llm_model") or company_config.get("llm_model")) or "gpt-4o"

        temp_val = source.get("llm_temperature")
        if temp_val is None:
            temp_val = company_config.get("llm_temperature", 0.7)
        temperature = float(temp_val)

        max_tokens = source.get("llm_max_tokens") or company_config.get(
            "llm_max_tokens", 8192
        )

        reasoning_effort = source.get("reasoning_effort") or "medium"

        # Logic for reasoning models (fixed temperature)
        use_temperature = True
        if model.startswith("o1") or model.startswith("o3") or model.startswith("gpt-5"):
            use_temperature = False

        logger.info(
            f"[Factory] Creating LLM: provider={provider}, model={model}, "
            f"temp={temperature if use_temperature else 'fixed'}"
        )

        callbacks = []
        if company_id:
            callbacks.append(
                CostCallbackHandler(
                    service_type="chat",
                    company_id=company_id,
                    agent_id=agent_id,
                    model_name=model
                )
            )

        if provider == "openai":
            return LLMFactory._create_openai(
                model, api_key, max_tokens, temperature, use_temperature,
                reasoning_effort, callbacks
            )
        elif provider == "anthropic":
            return LLMFactory._create_anthropic(
                model, api_key, max_tokens, temperature, callbacks
            )
        elif provider == "google":
            return LLMFactory._create_google(
                model, api_key, max_tokens, temperature, callbacks
            )
        elif provider == "openrouter":
            return LLMFactory._create_openrouter(
                model, api_key, max_tokens, temperature, callbacks
            )
        else:
            logger.warning(f"Unknown provider '{provider}', using OpenAI fallback")
            return LLMFactory._create_openai(
                "gpt-4o-mini", api_key, max_tokens, temperature, True, "medium", callbacks
            )

    @staticmethod
    def _create_openai(model, api_key, max_tokens, temperature, use_temp, reasoning_effort, callbacks):
        model_kwargs = {}
        if model.startswith("o1") or model.startswith("o3"):
            model_kwargs["reasoning_effort"] = reasoning_effort

        llm_params = {
            "model": model,
            "max_tokens": max_tokens,
            "openai_api_key": api_key,
            "callbacks": callbacks,
            "streaming": True,
        }

        if use_temp:
            llm_params["temperature"] = temperature

        if model_kwargs:
            llm_params["model_kwargs"] = model_kwargs

        # Force usage metadata
        if "model_kwargs" not in llm_params:
            llm_params["model_kwargs"] = {}
        llm_params["model_kwargs"]["stream_options"] = {"include_usage": True}

        return ChatOpenAI(**llm_params)

    @staticmethod
    def _create_anthropic(model, api_key, max_tokens, temperature, callbacks):
        return ChatAnthropic(
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            anthropic_api_key=api_key,
            callbacks=callbacks,
            streaming=True,
            model_kwargs={
                "extra_headers": {
                    "anthropic-beta": "prompt-caching-2024-07-31"
                }
            }
        )

    @staticmethod
    def _create_google(model, api_key, max_tokens, temperature, callbacks):
        return ChatGoogleGenerativeAI(
            model=model,
            temperature=temperature,
            max_output_tokens=max_tokens,
            google_api_key=api_key,
            callbacks=callbacks,
            streaming=True,
        )

    @staticmethod
    def _create_openrouter(model, api_key, max_tokens, temperature, callbacks):
        """
        Cria LLM via OpenRouter usando ChatOpenAI com base_url customizada.
        OpenRouter é 100% compatível com a API OpenAI.
        Model IDs usam formato "provider/model" (ex: "meta-llama/llama-3.1-405b").
        """
        llm_params = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "openai_api_key": api_key,
            "base_url": settings.OPENROUTER_BASE_URL,
            "callbacks": callbacks,
            "streaming": True,
            "default_headers": {
                "HTTP-Referer": settings.FRONTEND_URL,
                "X-Title": "Agent Smith",
            },
            "model_kwargs": {
                "stream_options": {"include_usage": True},
            },
        }

        return ChatOpenAI(**llm_params)
