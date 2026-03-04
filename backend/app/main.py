"""
FastAPI Main Application
"""

import os

import sentry_sdk
from dotenv import load_dotenv

load_dotenv()

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    send_default_pii=False,  # Never send personal data (LGPD/GDPR compliance)
    traces_sample_rate=0.1
    if os.getenv("ENV") == "production"
    else 1.0,  # 10% in prod, 100% in dev
    environment=os.getenv("ENV", "development"),
)

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.agents.graph import close_async_postgres_pool
from app.api import chat_router
from app.api.agent_config import router as agent_config_router
from app.api.documents import router as documents_router
from app.api.webhook import router as webhook_router
from app.core import settings
from app.core.database import create_async_supabase_client
from app.tasks.buffer_processor import shutdown_buffer_scheduler, start_buffer_scheduler

# Configurar logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


# Lifespan manager for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage app lifespan: startup and shutdown"""

    # === STARTUP ===

    # 0. LangSmith Observability (if configured)
    from app.core.langsmith_setup import configure_langsmith
    langsmith_enabled = configure_langsmith()
    if langsmith_enabled:
        logger.info("[STARTUP] ✅ LangSmith tracing enabled")

    # 1. Inicializar cliente Supabase Async (non-blocking)
    logger.info("[STARTUP] Initializing Async Supabase Client...")
    app.state.supabase_async = await create_async_supabase_client()
    logger.info("[STARTUP] ✅ Async Supabase Client ready")

    # 2. Preload pricing cache (evita cold start no primeiro request)
    logger.info("[STARTUP] Preloading LLM pricing cache...")
    try:
        from app.services.usage_service import preload_pricing_cache
        count = preload_pricing_cache()
        logger.info(f"[STARTUP] ✅ Pricing cache loaded: {count} models")
    except Exception as e:
        logger.warning(f"[STARTUP] ⚠️ Pricing cache preload failed (will use fallback): {e}")

    # 3. Iniciar scheduler do WhatsApp Buffer
    logger.info("[STARTUP] Starting WhatsApp Buffer Scheduler...")
    start_buffer_scheduler()

    yield

    # === SHUTDOWN ===
    logger.info("[SHUTDOWN] Stopping WhatsApp Buffer Scheduler...")
    shutdown_buffer_scheduler()

    logger.info("[SHUTDOWN] Closing PostgreSQL Connection Pool...")
    await close_async_postgres_pool()


# Criar app FastAPI com lifespan
# Docs desabilitados em produção (DEBUG=false)
debug_mode = os.getenv("DEBUG", "false").lower() == "true"

app = FastAPI(
    title="Agent Smith V2 API",
    description="Backend FastAPI com LangChain para o Agent Smith",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan,
    docs_url="/docs" if debug_mode else None,
    redoc_url="/redoc" if debug_mode else None,
    openapi_url="/openapi.json" if debug_mode else None,
)

# Rate Limiting
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.rate_limit import limiter

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Trust proxy headers (Railway) - necessary for HTTPS redirects
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar rotas
app.include_router(chat_router, tags=["Chat"])
app.include_router(documents_router, tags=["Documents"])
app.include_router(agent_config_router, prefix="/api/agent", tags=["Agent Config"])
from app.api.agents import router as agents_router
from app.api.billing import router as billing_router
from app.api.billing_admin import router as billing_admin_router
from app.api.mcp import router as mcp_router
from app.api.plans import router as plans_router
from app.api.pricing import router as pricing_router
from app.api.stripe_checkout import router as stripe_checkout_router
from app.api.stripe_webhooks import router as stripe_webhooks_router

app.include_router(agents_router, prefix="/api/agents", tags=["Agents (Multi-Agent)"])
app.include_router(webhook_router, tags=["Webhook"])
app.include_router(pricing_router, tags=["Admin Pricing"])
app.include_router(plans_router, tags=["Admin Plans"])
app.include_router(billing_router, tags=["Billing (Owner)"])
app.include_router(billing_admin_router, tags=["Admin Billing"])
app.include_router(stripe_webhooks_router, prefix="/api/webhooks", tags=["Stripe Webhooks"])
app.include_router(stripe_checkout_router, prefix="/api/billing", tags=["Stripe Checkout"])
app.include_router(mcp_router, prefix="/api/mcp", tags=["MCP Integrations"])

# === UCP (Universal Commerce Protocol) ===
from app.api.ucp import router as ucp_router

app.include_router(ucp_router, prefix="/api", tags=["UCP Commerce"])

# === Sanitization (Document Sanitizer) ===
from app.api.sanitization import router as sanitization_router

app.include_router(sanitization_router, prefix="/api/sanitization", tags=["Sanitization"])


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Agent Smith - LangChain API",
        "version": "1.0.0",
    }


@app.get("/robots.txt")
async def robots_txt():
    """Block search engine crawlers from indexing the API"""
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse("User-agent: *\nDisallow: /\n")


@app.get("/health")
async def health_check(request: Request):
    """Health check detalhado - verifica conexão real com ambos os clientes"""
    from datetime import datetime

    from fastapi.responses import JSONResponse

    from app.core.database import get_supabase_client

    health_status = {
        "status": "healthy",
        "database_sync": "unknown",
        "database_async": "unknown",
        "langchain": "initialized",
        "timestamp": datetime.utcnow().isoformat(),
    }

    # 1. Verificar cliente async (primary - non-blocking)
    try:
        db = request.app.state.supabase_async
        await db.client.table("companies").select("id").limit(1).execute()
        health_status["database_async"] = "connected"
    except Exception as e:
        health_status["database_async"] = f"error: {str(e)}"
        logger.error(f"[HEALTH] Async database check failed: {e}")

    # 2. Verificar cliente sync (backward compat)
    try:
        supabase = get_supabase_client()
        supabase.client.table("companies").select("id").limit(1).execute()
        health_status["database_sync"] = "connected"
    except Exception as e:
        health_status["status"] = "unhealthy"
        health_status["database_sync"] = "disconnected"
        health_status["error"] = str(e)
        logger.error(f"[HEALTH] Sync database check failed: {e}")

    # Retornar 503 se unhealthy (load balancers dependem disso)
    if health_status["status"] == "unhealthy":
        return JSONResponse(status_code=503, content=health_status)

    return health_status


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting server on {settings.HOST}:{settings.PORT}")
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
