"""
Agent Config API - Endpoints para configurar o agente LLM de cada empresa
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, validator

from app.core import get_supabase_client
from app.services.encryption_service import get_encryption_service
from app.services.langchain_service import (
    SUPPORTED_PROVIDERS,
    get_models_for_provider,
    get_supported_providers,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ===== MODELS =====


class ProviderInfo(BaseModel):
    """Informações sobre um provider"""

    name: str = Field(..., description="Nome do provider (openai, anthropic, google)")
    display_name: str = Field(..., description="Nome para exibir na UI")
    models_count: int = Field(..., description="Número de modelos disponíveis")


class AgentConfigRequest(BaseModel):
    """Request para salvar configuração do agente"""

    llm_provider: str = Field(..., description="Provider do LLM")
    llm_model: str = Field(..., description="Modelo do LLM")
    llm_api_key: str = Field(..., description="API Key do provider")
    llm_temperature: float = Field(
        default=0.7, ge=0.0, le=2.0, description="Temperatura (0.0 a 2.0)"
    )
    llm_max_tokens: int = Field(
        default=2000, ge=100, le=100000, description="Máximo de tokens"
    )
    llm_top_p: float = Field(
        default=1.0, ge=0.0, le=1.0, description="Top P (0.0 a 1.0)"
    )
    llm_top_k: int = Field(default=40, ge=1, le=100, description="Top K (1 a 100)")
    llm_frequency_penalty: float = Field(
        default=0.0, ge=-2.0, le=2.0, description="Frequency Penalty (-2.0 a 2.0)"
    )
    llm_presence_penalty: float = Field(
        default=0.0, ge=-2.0, le=2.0, description="Presence Penalty (-2.0 a 2.0)"
    )
    agent_system_prompt: Optional[str] = Field(
        None, description="System prompt customizado"
    )
    agent_enabled: bool = Field(default=True, description="Habilitar agente")
    use_langchain: bool = Field(
        default=True, description="Usar LangChain (true) ou N8N (false)"
    )
    allow_web_search: bool = Field(
        default=True, description="Permitir busca na web via Tavily"
    )
    allow_vision: bool = Field(
        default=False, description="Permitir análise de imagens (GPT-4o, Claude 3.5)"
    )
    vision_model: Optional[str] = Field(
        None, description="Modelo de visão: gpt-4o ou claude-3-5-sonnet-20240620"
    )
    vision_api_key: Optional[str] = Field(
        None, description="API Key para visão (separada da conversação)"
    )

    @validator("llm_provider")
    def validate_provider(cls, v):
        if v not in SUPPORTED_PROVIDERS:
            raise ValueError(
                f"Provider '{v}' not supported. Available: {list(SUPPORTED_PROVIDERS.keys())}"
            )
        return v

    @validator("llm_model")
    def validate_model(cls, v, values):
        provider = values.get("llm_provider")
        # OpenRouter: accept any model (validation done by OpenRouter API)
        if provider == "openrouter":
            return v
        if provider and v not in SUPPORTED_PROVIDERS.get(provider, []):
            raise ValueError(f"Model '{v}' not available for provider '{provider}'")
        return v


class AgentConfigResponse(BaseModel):
    """Response da configuração do agente"""

    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_temperature: float = 0.7
    llm_max_tokens: int = 2000
    llm_top_p: float = 1.0
    llm_top_k: int = 40
    llm_frequency_penalty: float = 0.0
    llm_presence_penalty: float = 0.0
    agent_system_prompt: Optional[str] = None
    agent_enabled: bool = False
    use_langchain: bool = False
    allow_web_search: bool = True
    allow_vision: bool = False  # VISION
    vision_model: Optional[str] = None  # VISION: modelo escolhido
    has_vision_api_key: bool = Field(
        default=False, description="Indica se tem API key de visão configurada"
    )
    # Não retornar API keys por segurança
    has_api_key: bool = Field(
        default=False, description="Indica se tem API key configurada"
    )


class TestConnectionRequest(BaseModel):
    """Request para testar conexão com LLM"""

    llm_provider: str
    llm_model: str
    llm_api_key: str


class TestConnectionResponse(BaseModel):
    """Response do teste de conexão"""

    success: bool
    message: str
    model_info: Optional[Dict[str, Any]] = None


# ===== ENDPOINTS =====


@router.get("/providers", response_model=List[ProviderInfo])
async def list_providers():
    """
    Lista providers disponíveis (openai, anthropic, google)
    """
    providers = []
    display_names = {
        "openai": "OpenAI (GPT)",
        "anthropic": "Anthropic (Claude)",
        "google": "Google (Gemini)",
        "openrouter": "OpenRouter (Multi-provider)",
    }

    for provider_name, models in get_supported_providers().items():
        count = len(models)
        if provider_name == "openrouter":
            # Fetch count dynamically from llm_pricing
            try:
                supabase = get_supabase_client()
                result = (
                    supabase.client.table("llm_pricing")
                    .select("model_name", count="exact", head=True)
                    .eq("provider", "openrouter")
                    .eq("is_active", True)
                    .execute()
                )
                count = result.count if result.count is not None else 0
            except Exception as e:
                logger.error(f"Error counting OpenRouter models: {e}")
                count = 0

        providers.append(
            ProviderInfo(
                name=provider_name,
                display_name=display_names.get(provider_name, provider_name.title()),
                models_count=count,
            )
        )

    return providers


@router.get("/models/{provider}", response_model=List[str])
async def list_models(provider: str):
    """
    Lista modelos disponíveis para um provider.
    Para OpenRouter, busca dinamicamente da tabela llm_pricing.
    """
    if provider == "openrouter":
        # Fetch active OpenRouter models from llm_pricing
        supabase = get_supabase_client()
        result = (
            supabase.client.table("llm_pricing")
            .select("model_name")
            .eq("provider", "openrouter")
            .eq("is_active", True)
            .order("model_name")
            .execute()
        )
        if result.data:
            return [row["model_name"] for row in result.data]
        return []

    # Direct providers (existing logic)
    models = get_models_for_provider(provider)

    if not models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{provider}' not found or has no models",
        )

    return models


@router.get("/config/{company_id}", response_model=AgentConfigResponse)
async def get_agent_config(company_id: str):
    """
    Busca configuração atual do agente para uma empresa
    """
    try:
        supabase = get_supabase_client()
        company = supabase.get_company(company_id)

        if not company:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Company {company_id} not found",
            )

        # Garantir valores default para campos que podem ser NULL
        temperature = company.get("llm_temperature")
        temperature = float(temperature) if temperature is not None else 0.7

        top_p = company.get("llm_top_p")
        top_p = float(top_p) if top_p is not None else 1.0

        frequency_penalty = company.get("llm_frequency_penalty")
        frequency_penalty = (
            float(frequency_penalty) if frequency_penalty is not None else 0.0
        )

        presence_penalty = company.get("llm_presence_penalty")
        presence_penalty = (
            float(presence_penalty) if presence_penalty is not None else 0.0
        )

        max_tokens = company.get("llm_max_tokens")
        max_tokens = int(max_tokens) if max_tokens is not None else 2000

        top_k = company.get("llm_top_k")
        top_k = int(top_k) if top_k is not None else 40

        # Retornar config (sem API keys por segurança)
        return AgentConfigResponse(
            llm_provider=company.get("llm_provider"),
            llm_model=company.get("llm_model"),
            llm_temperature=temperature,
            llm_max_tokens=max_tokens,
            llm_top_p=top_p,
            llm_top_k=top_k,
            llm_frequency_penalty=frequency_penalty,
            llm_presence_penalty=presence_penalty,
            agent_system_prompt=company.get("agent_system_prompt"),
            agent_enabled=company.get("agent_enabled", False),
            use_langchain=company.get("use_langchain", False),
            allow_web_search=company.get("allow_web_search", True),
            allow_vision=company.get("allow_vision", False),
            vision_model=company.get("vision_model"),  # VISION
            has_vision_api_key=bool(company.get("vision_api_key")),
            has_api_key=bool(company.get("llm_api_key")),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching agent config: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch config: {str(e)}",
        ) from e


@router.put("/config/{company_id}")
async def save_agent_config(company_id: str, config: AgentConfigRequest):
    """
    Salva configuração do agente para uma empresa
    """
    try:
        supabase = get_supabase_client()

        # Validar que empresa existe
        company = supabase.get_company(company_id)
        if not company:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Company {company_id} not found",
            )

        # Preparar dados para atualizar
        update_data = {
            "llm_provider": config.llm_provider,
            "llm_model": config.llm_model,
            "llm_temperature": config.llm_temperature,
            "llm_max_tokens": config.llm_max_tokens,
            "llm_top_p": config.llm_top_p,
            "llm_top_k": config.llm_top_k,
            "llm_frequency_penalty": config.llm_frequency_penalty,
            "llm_presence_penalty": config.llm_presence_penalty,
            "agent_system_prompt": config.agent_system_prompt,
            "agent_enabled": config.agent_enabled,
            "use_langchain": config.use_langchain,
            "allow_web_search": config.allow_web_search,
            "allow_vision": config.allow_vision,
            "vision_model": config.vision_model,  # VISION
        }

        # Criptografar API key SOMENTE se for diferente de "UNCHANGED"
        if config.llm_api_key and config.llm_api_key != "UNCHANGED":
            encryption_service = get_encryption_service()
            encrypted_key = encryption_service.encrypt(config.llm_api_key)
            update_data["llm_api_key"] = encrypted_key
            logger.info(f"Updating LLM API key for company {company_id}")
        else:
            logger.info(f"Keeping existing LLM API key for company {company_id}")

        # Criptografar Vision API key SOMENTE se for diferente de "UNCHANGED"
        if config.vision_api_key and config.vision_api_key != "UNCHANGED":
            encryption_service = get_encryption_service()
            encrypted_vision_key = encryption_service.encrypt(config.vision_api_key)
            update_data["vision_api_key"] = encrypted_vision_key
            logger.info(f"Updating Vision API key for company {company_id}")
        else:
            logger.info(f"Keeping existing Vision API key for company {company_id}")

        result = (
            supabase.client.table("companies")
            .update(update_data)
            .eq("id", company_id)
            .execute()
        )

        if not result.data:
            raise Exception("Failed to update company config")

        logger.info(
            f"Agent config saved for company {company_id}: provider={config.llm_provider}, model={config.llm_model}"
        )

        return {
            "success": True,
            "message": "Agent configuration saved successfully",
            "company_id": company_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving agent config: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save config: {str(e)}",
        ) from e


@router.post("/test/{company_id}", response_model=TestConnectionResponse)
async def test_llm_connection(company_id: str, test_request: TestConnectionRequest):
    """
    Testa conexão com o LLM antes de salvar
    """
    try:
        provider = test_request.llm_provider
        model = test_request.llm_model
        api_key = test_request.llm_api_key

        logger.info(f"Testing connection: provider={provider}, model={model}")

        # Criar LLM temporário para teste
        test_message = "Hello, this is a test. Reply with 'OK' if you receive this."

        if provider == "openai":
            llm = ChatOpenAI(
                model=model, temperature=0.7, max_tokens=50, openai_api_key=api_key
            )
        elif provider == "anthropic":
            llm = ChatAnthropic(
                model=model, temperature=0.7, max_tokens=50, anthropic_api_key=api_key
            )
        elif provider == "google":
            llm = ChatGoogleGenerativeAI(
                model=model,
                temperature=0.7,
                max_output_tokens=50,
                google_api_key=api_key,
            )
        elif provider == "openrouter":
            from app.core.config import settings
            openrouter_key = settings.OPENROUTER_API_KEY
            if not openrouter_key:
                return TestConnectionResponse(
                    success=False,
                    message="OPENROUTER_API_KEY não configurada no .env do backend",
                    model_info=None,
                )
            llm = ChatOpenAI(
                model=model,
                temperature=0.7,
                max_tokens=50,
                api_key=openrouter_key,
                base_url=settings.OPENROUTER_BASE_URL,
                default_headers={
                    "HTTP-Referer": settings.FRONTEND_URL,
                    "X-Title": "Agent Smith",
                },
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown provider: {provider}",
            )

        # Testar com mensagem simples
        from langchain_core.messages import HumanMessage

        response = llm.invoke([HumanMessage(content=test_message)])

        logger.info(f"Test successful for {provider}/{model}")

        return TestConnectionResponse(
            success=True,
            message=f"Successfully connected to {provider} ({model})",
            model_info={
                "provider": provider,
                "model": model,
                "test_response": response.content[:100],  # Primeiros 100 chars
            },
        )

    except Exception as e:
        logger.error(f"Connection test failed: {e}")
        return TestConnectionResponse(
            success=False, message=f"Connection failed: {str(e)}", model_info=None
        )
