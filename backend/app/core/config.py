"""
Configurações do FastAPI backend
"""

from decimal import Decimal
from typing import List, Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Settings da aplicação"""

    # Supabase
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_DB_URL: Optional[str] = (
        None  # Optional: PostgreSQL connection string for LangGraph checkpointer
    )

    # OpenAI (LLM + Embeddings)
    OPENAI_API_KEY: str

    # Cohere (Reranking)
    COHERE_API_KEY: Optional[str] = None

    # Tavily (Web Search)
    TAVILY_API_KEY: Optional[str] = None

    # Test mode - simula envios e integrações sem chamar APIs externas
    DRY_RUN: bool = False

    # SendGrid (Email)
    SENDGRID_API_KEY: Optional[str] = None
    SENDGRID_FROM_EMAIL: Optional[str] = None

    # Encryption Key para API keys das empresas
    ENCRYPTION_KEY: str

    # MinIO Configuration
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ROOT_USER: str  # Required in .env
    MINIO_ROOT_PASSWORD: str  # Required in .env
    MINIO_SECURE: bool = False
    MINIO_BUCKET: str = "documents"

    # Qdrant Configuration
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    EMBEDDING_DIMENSION: int = 1536

    # Redis Configuration (Message Buffer)
    REDIS_URL: str = (
        "redis://localhost:6379/0"  # localhost since backend runs outside Docker
    )

    # Stripe Configuration
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None

    # Shopify Agent API Credentials (for checkout MCP authentication)
    SHOPIFY_AGENT_CLIENT_ID: Optional[str] = None
    SHOPIFY_AGENT_CLIENT_SECRET: Optional[str] = None

    # LangSmith Configuration (Observability - Optional)
    # Get API key at: https://smith.langchain.com/settings
    LANGCHAIN_TRACING_V2: bool = False  # Disabled by default
    LANGCHAIN_API_KEY: Optional[str] = None
    LANGCHAIN_PROJECT: str = "agent-smith"
    LANGCHAIN_ENDPOINT: str = "https://api.smith.langchain.com"
    LANGSMITH_WORKSPACE_ID: Optional[str] = None  # Required for org-scoped Service Keys

    # Billing Configuration
    DOLLAR_RATE: Decimal = Decimal("6.00")  # Default value, override via env var

    # Buffer Settings (WhatsApp Message Aggregation)
    BUFFER_DEBOUNCE_SECONDS: int = 3  # Wait 3s after last message
    BUFFER_MAX_WAIT_SECONDS: int = 10  # Max 10s since first message
    BUFFER_TTL_SECONDS: int = 60  # Redis TTL safety net

    # Sanitization (Document Sanitizer)
    SANITIZATION_MAX_FILE_SIZE_MB: int = 50
    SANITIZATION_MAX_PAGES: int = 200
    SANITIZATION_JOB_TTL_DAYS: int = 7
    USE_CELERY: bool = False

    # Docling Microservice
    DOCLING_SERVICE_URL: str = "http://localhost:8001"
    DOCLING_SERVICE_KEY: str = ""
    DOCLING_POLL_INTERVAL: int = 5  # Seconds between polling
    DOCLING_MAX_WAIT: int = 600  # Max wait time (10 min)

    # OpenRouter Configuration (Multi-provider Gateway)
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # Frontend URL (used in email templates)
    FRONTEND_URL: str = "https://app.smith.ai"

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def allowed_origins_list(self) -> List[str]:
        """Retorna lista de origens permitidas"""
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Permite variáveis extras no .env sem erro


settings = Settings()
