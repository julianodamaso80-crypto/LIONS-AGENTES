"""
Serviço LangChain - Chat com IA com Multi-Tenancy e RAG + LangGraph
ADAPTADO PARA MULTI-AGENTES (Versão Final Estável)
"""

import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from cachetools import LRUCache
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Pool error handling for hot-reload recovery
try:
    from psycopg_pool import PoolClosed
except ImportError:
    PoolClosed = Exception  # Fallback if psycopg_pool not installed

try:
    from psycopg import OperationalError
except ImportError:
    OperationalError = Exception  # Fallback

# Services
from app.agents.guardrails import ScaleGuardrail  # [NEW] Guardrails Import

# Models
from app.models.conversation_log import ConversationMetrics, RAGChunk

from .document_service import get_document_service
from .encryption_service import get_encryption_service
from .qdrant_service import get_qdrant_service

# Pool reset for hot-reload recovery (async version)
# Note: close_async_postgres_pool is imported locally in recovery code

logger = logging.getLogger(__name__)

# ===== GRAPH CACHE - LRU Cache com limite para evitar OOM =====
_graphs_cache: LRUCache = LRUCache(maxsize=500)


async def get_or_create_graph(
    company_id: str,
    agent_id: str,
    agent_config: dict,
    api_key: str,
    qdrant_service,
    supabase_client,
    enable_logging: bool = True,
):
    """
    Retorna o grafo cacheado ou cria um novo se não existir (ASYNC).
    A chave inclui updated_at para invalidação automática quando a config muda.
    """
    global _graphs_cache

    # PEGAR O UPDATED_AT PARA INVALIDAÇÃO AUTOMÁTICA
    updated_at = agent_config.get("updated_at", "")
    if hasattr(updated_at, "isoformat"):
        updated_at = updated_at.isoformat()

    # 🔥 A chave agora inclui a data de atualização
    cache_key = f"{company_id}:{agent_id}:{updated_at}"

    # LRUCache gerencia automaticamente a evição; invalidação centralizada cuida de versões antigas
    if cache_key in _graphs_cache:
        logger.debug(f"[GRAPH CACHE] Reusing cached graph for key {cache_key}")
        return _graphs_cache[cache_key]

    logger.info(
        f"[GRAPH CACHE] Creating new graph for key {cache_key} (Model: {agent_config.get('llm_model')})"
    )

    # Criar novo grafo passando as configs do AGENTE (ASYNC)
    from app.agents import create_agent_graph

    graph = await create_agent_graph(
        company_config=agent_config,
        agent_data=agent_config,
        api_key=api_key,
        qdrant_service=qdrant_service,
        supabase_client=supabase_client,
        company_id=company_id,
        enable_logging=enable_logging,
    )

    _graphs_cache[cache_key] = graph
    logger.info(f"[GRAPH CACHE] Graph cached. Total cached: {len(_graphs_cache)}")

    return graph


# Função para invalidar cache de um agente específico (chamar quando tools mudam)
def invalidate_agent_graph_cache(company_id: str, agent_id: str):
    """
    Invalida o cache do grafo de um agente específico (todas as versões).
    Usa list() para evitar RuntimeError: dictionary changed size during iteration.
    """
    global _graphs_cache
    prefix = f"{company_id}:{agent_id}:"
    keys_to_remove = [k for k in list(_graphs_cache.keys()) if k.startswith(prefix)]
    for key in keys_to_remove:
        try:
            del _graphs_cache[key]
            logger.info(f"[GRAPH CACHE] Invalidated cache for {key}")
        except KeyError:
            pass  # Já foi removido por outra thread ou LRU eviction


SUPPORTED_PROVIDERS = {
    "openai": [
        "gpt-5.2",
        "gpt-5.2-pro",
        "gpt-5.2-chat-latest",
        "gpt-5.1",
        "gpt-4o",
        "gpt-4o-mini",
        "o1",
        "o1-mini",
        "o3-mini",
    ],
    "anthropic": [
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-sonnet-4-5-20250929",
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
    ],
    "google": [
        "gemini-3-pro-preview",
        "gemini-3-pro-preview-11-2025",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
    ],
    "openrouter": [],  # Populated dynamically via sync from OpenRouter API
}

DEFAULT_SYSTEM_PROMPT = """Você é o Agent Scale AI, um assistente inteligente e prestativo.
Seja profissional, claro e objetivo nas suas respostas.
Se não souber a resposta, diga que não sabe."""


class LangChainService:
    """Serviço ÚNICO para processar mensagens com LangChain (Multi-Agent + RAG)"""

    def __init__(self, openai_api_key: str, supabase_client):
        self.default_openai_key = openai_api_key
        self.supabase = supabase_client
        self.encryption_service = get_encryption_service()

        self.embeddings = OpenAIEmbeddings(
            model="text-embedding-3-small", openai_api_key=openai_api_key
        )

        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200, length_function=len
        )

        self.qdrant = get_qdrant_service()
        self.document_service = get_document_service()

        logger.info("LangChain service initialized with Multi-Agent support")

    def _get_raw_agent(
        self, company_id: str, agent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Busca o agente "cru" direto do banco para ter acesso às chaves criptografadas.
        NÃO usa AgentService para evitar que as chaves sejam mascaradas.
        """
        try:
            query = (
                self.supabase.client.table("agents")
                .select("*")
                .eq("company_id", company_id)
                .eq("is_active", True)
            )

            if agent_id:
                query = query.eq("id", agent_id)

            # Ordena para garantir determinismo se for default
            result = query.order("created_at").limit(1).execute()

            if result.data and len(result.data) > 0:
                return result.data[0]

            return None
        except Exception as e:
            logger.error(f"Error fetching raw agent: {e}")
            return None

    def _analyze_image(
        self,
        image_url: str,
        vision_model: str,
        vision_api_key: str,
        company_id: str = None,
        agent_id: str = None
    ) -> str:
        try:
            # Callback para registrar custos de Vision
            callbacks = []
            if company_id:
                from app.core.callbacks.cost_callback import CostCallbackHandler
                callbacks.append(
                    CostCallbackHandler(
                        service_type="vision",
                        company_id=company_id,
                        agent_id=agent_id,
                        model_name=vision_model
                    )
                )

            if vision_model == "gpt-4o" or vision_model.startswith("gpt-"):
                llm = ChatOpenAI(
                    model=vision_model,
                    api_key=vision_api_key,
                    temperature=0.3,
                    callbacks=callbacks
                )
            elif vision_model and vision_model.startswith("claude"):
                llm = ChatAnthropic(
                    model=vision_model,
                    api_key=vision_api_key,
                    temperature=0.3,
                    callbacks=callbacks
                )
            else:
                return "[Modelo de visão não configurado ou suportado]"

            system_prompt = (
                "Descreva tecnicamente a imagem para um Agente de Suporte. Seja breve."
            )
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=[
                        {"type": "text", "text": "Descreva:"},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ]
                ),
            ]
            response = llm.invoke(messages)
            return response.content
        except Exception as e:
            logger.error(f"[VISION] Error: {e}")
            return "[Erro na análise de imagem]"

    async def process_message(
        self,
        user_message: str,
        company_id: str,
        user_id: str,
        session_id: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        rag_context: Optional[str] = None,
        collect_metrics: bool = True,
        options: Optional[Dict[str, bool]] = None,
        image_url: Optional[str] = None,
        channel: str = "web",
        agent_id: Optional[str] = None,
        async_supabase_client=None,  # NEW: For async memory operations
    ) -> Tuple[str, Optional[ConversationMetrics]]:
        metrics = (
            ConversationMetrics(start_time=time.time()) if collect_metrics else None
        )

        try:
            if not company_id:
                raise ValueError("company_id is required")

            # 1. Validar empresa
            company = self.supabase.get_company(company_id)
            if not company:
                raise ValueError(f"Company {company_id} not found")

            # 2. BUSCAR AGENTE (RAW)
            agent = self._get_raw_agent(company_id, agent_id)

            if not agent:
                logger.error(f"[CONFIG] No active agents found for company {company_id}")
                raise ValueError("CONFIG_REQUIRED: Nenhum Agente de IA encontrado.")

            # 3. Obter API Key do .env baseado no provider/modelo do agente
            from app.core.utils import get_api_key_for_provider

            llm_model = agent.get("llm_model", "")
            llm_provider = agent.get("llm_provider", "")

            # Usar função centralizada para obter API key
            try:
                api_key = get_api_key_for_provider(llm_provider, llm_model)
            except ValueError as e:
                logger.error(f"[CONFIG] {e}")
                raise

            # 3.5. GUARDRAILS CHECK
            # Verifica segurança antes de invocar qualquer LLM ou Tool
            security_settings = agent.get("security_settings", {})
            logger.info(f"[SECURITY] 🔍 Security enabled={security_settings.get('enabled', False)}")

            # Inicializa com o texto original
            final_message = user_message
            guardrail = None

            try:
                guardrail = ScaleGuardrail(agent_config=agent, company_id=company_id)
                is_blocked, block_reason, sanitized_text = await guardrail.validate_input(user_message)

                if is_blocked:
                    logger.warning(f"[SECURITY] 🛡️ Message BLOCKED: {block_reason}")
                    if metrics:
                        metrics.end_time = time.time()
                    return block_reason, metrics

                # 🔥 CORREÇÃO: Usa texto sanitizado (pode ter PII mascarado)
                final_message = sanitized_text
                logger.debug("[SECURITY] ✅ Message passed guardrail")

            except Exception as gr_error:
                logger.error(f"[SECURITY] ⚠️ Guardrail exception: {gr_error}", exc_info=True)

                # 🔥 CORREÇÃO: Fail-close se configurado (default: True)
                fail_close = getattr(guardrail, 'fail_close', True) if guardrail else True
                if fail_close:
                    if metrics:
                        metrics.end_time = time.time()
                    return "Erro temporário de segurança. Por favor, tente novamente.", metrics
                # Se fail_close=False, continua com texto original

            # 4. Histórico
            if not conversation_history:
                try:
                    conversation_history = self.supabase.get_conversation_history(
                        session_id=session_id, company_id=company_id, limit=20
                    )
                except Exception as e:
                    logger.error(f"[CHAT] Failed to fetch conversation history: {e}")
                    conversation_history = []  # Fallback para lista vazia

            # Garante que não é None (alguns erros retornam None ao invés de levantar exceção)
            if conversation_history is None:
                conversation_history = []

            # 5. Obter Grafo (Configurado com o Agente) - ASYNC
            graph = await get_or_create_graph(
                company_id=company_id,
                agent_id=agent.get("id"),
                agent_config=agent,
                api_key=api_key,
                qdrant_service=self.qdrant,
                supabase_client=self.supabase.client,
                enable_logging=True,
            )

            # 6. Vision - Usa final_message (já sanitizado)
            enriched_message = final_message
            if image_url:
                import os
                v_model = agent.get("vision_model")

                # === SELEÇÃO DE CHAVE VISION: USAR .env ===
                v_key = None
                if v_model:
                    if v_model == "gpt-4o" or v_model.startswith("gpt-"):
                        v_key = os.getenv("OPENAI_API_KEY")
                    elif v_model.startswith("claude"):
                        v_key = os.getenv("ANTHROPIC_API_KEY")
                    elif v_model.startswith("gemini"):
                        v_key = os.getenv("GOOGLE_API_KEY")

                if v_model and v_key:
                    try:
                        desc = self._analyze_image(
                            image_url,
                            v_model,
                            v_key,
                            company_id=company_id,
                            agent_id=agent.get("id")
                        )
                        enriched_message = (
                            f"{final_message}\n\n[CONTEXTO VISUAL]:\n{desc}"
                        )
                        logger.info(f"[VISION] ✅ Imagem analisada com sucesso usando {v_model}")
                    except Exception as e:
                        logger.error(f"[VISION] ❌ Erro ao analisar imagem: {e}")
                elif image_url and not v_model:
                    logger.warning("[VISION] ⚠️ vision_model não configurado no agente")
                elif image_url and not v_key:
                    logger.warning(f"[VISION] ⚠️ API Key não encontrada no .env para modelo {v_model}")

            # 7. Invocar Agente (LangGraph) - COM RETRY PARA POOL FECHADO
            from app.agents import invoke_agent

            try:
                result = await invoke_agent(
                    graph=graph,
                    user_message=enriched_message,
                    company_id=company_id,
                    user_id=user_id,
                    session_id=session_id,
                    company_config=agent,
                    options=options,
                    channel=channel,
                    supabase_client=self.supabase.client,
                    agent_id=agent.get("id"),
                    async_supabase_client=async_supabase_client,
                )
            except (PoolClosed, OperationalError, Exception) as e:
                # Detectar erro de pool fechado ou conexão perdida (SSL EOF)
                error_msg = str(e).lower()
                is_pool_error = (
                    isinstance(e, PoolClosed)
                    or isinstance(e, OperationalError)
                    or "pool" in error_msg
                    or "connection" in error_msg
                    or "ssl" in error_msg
                    or "eof" in error_msg
                )

                if is_pool_error:
                    logger.warning(
                        f"[LANGCHAIN] ♻️ Connection Pool closed. Resetting connection and retrying... Error: {e}"
                    )

                    # 1. Limpar cache global de grafos
                    global _graphs_cache
                    _graphs_cache.clear()
                    logger.info("[LANGCHAIN] 🗑️ Graph cache cleared")

                    # 2. 🔥 FORÇAR RESET DO POOL NO GRAPH.PY (Correção Crítica)
                    # Isso garante que o get_or_create_graph crie uma conexão nova
                    try:
                        from app.agents.graph import close_async_postgres_pool
                        await close_async_postgres_pool()
                        logger.info("[LANGCHAIN] 🔌 Async postgres pool reset")
                    except Exception as pool_err:
                        logger.warning(f"[LANGCHAIN] Error resetting pool: {pool_err}")

                    # 3. Recriar grafo (agora com pool novo) - ASYNC
                    graph = await get_or_create_graph(
                        company_id=company_id,
                        agent_id=agent.get("id"),
                        agent_config=agent,
                        api_key=api_key,
                        qdrant_service=self.qdrant,
                        supabase_client=self.supabase.client,
                        enable_logging=True,
                    )

                    # 4. Tentar novamente com novo grafo
                    result = await invoke_agent(
                        graph=graph,
                        user_message=enriched_message,
                        company_id=company_id,
                        user_id=user_id,
                        session_id=session_id,
                        company_config=agent,
                        options=options,
                        channel=channel,
                        supabase_client=self.supabase.client,
                        agent_id=agent.get("id"),
                        async_supabase_client=async_supabase_client,
                    )
                    logger.info("[LANGCHAIN] ✅ Retry successful after pool recovery")
                else:
                    raise e  # Outro erro, deixa subir

            response_text = result["response"]

            # 🔥 SAFETY: Garantir que response sempre seja string
            # Modelos de raciocínio (o1, o3, GPT-5) podem retornar lista de blocos
            if isinstance(response_text, list):
                text_parts = []
                for block in response_text:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif isinstance(block, str):
                        text_parts.append(block)
                response_text = "".join(text_parts)
            elif not isinstance(response_text, str):
                response_text = str(response_text) if response_text else ""

            if metrics:
                metrics.end_time = time.time()
                metrics.tokens_total = result.get("tokens_total", 0)

            return response_text, metrics

        except Exception as e:
            logger.error(f"[LANGCHAIN] Error: {str(e)}", exc_info=True)
            raise

    # ===== RAG METHODS (Mantidos para compatibilidade) =====

    def get_rag_context(
        self,
        query: str,
        company_id: str,
        top_k: int = 3,
        metrics: Optional[ConversationMetrics] = None,
    ):
        try:
            results = self.search_documents(query, company_id, top_k)
            if not results:
                return None, []

            context = "\n\n".join([f"[Trecho]\n{r.get('content')}" for r in results])
            rag_chunks = [
                RAGChunk(
                    content=r.get("content"),
                    document_id=r.get("document_id"),
                    score=r.get("score"),
                )
                for r in results
            ]
            return context, rag_chunks
        except Exception:
            return None, []

    def search_documents(
        self, query: str, company_id: str, top_k: int = 3, score_threshold: float = 0.4
    ) -> List[Dict[str, Any]]:
        try:
            query_embedding = self.embeddings.embed_query(query)
            return self.qdrant.search_similar(
                company_id=company_id,
                query_embedding=query_embedding,
                top_k=top_k,
                score_threshold=score_threshold,
            )
        except Exception as e:
            logger.error(f"[RAG] Error: {e}")
            return []

    def process_document(self, document_id: str, company_id: str, text: str) -> bool:
        try:
            self.document_service.update_document_status(document_id, "processing")
            chunks = self.text_splitter.split_text(text)
            if not chunks:
                raise ValueError("No chunks")

            embeddings = self.embeddings.embed_documents(chunks)

            self.qdrant.insert_embeddings(
                company_id=company_id,
                document_id=document_id,
                embeddings=embeddings,
                chunks=chunks,
                metadata={"processed_at": datetime.now().isoformat()},
            )

            self.document_service.update_document_status(
                document_id, "completed", chunks_count=len(chunks)
            )
            return True
        except Exception as e:
            logger.error(f"Doc process error: {e}")
            self.document_service.update_document_status(
                document_id, "failed", error_message=str(e)
            )
            return False


# ===== MÉTODOS AUXILIARES PARA API =====


def get_supported_providers() -> Dict[str, List[str]]:
    """Retorna providers e modelos suportados"""
    return SUPPORTED_PROVIDERS


def get_models_for_provider(provider: str) -> List[str]:
    """Retorna modelos disponíveis para um provider"""
    return SUPPORTED_PROVIDERS.get(provider, [])
