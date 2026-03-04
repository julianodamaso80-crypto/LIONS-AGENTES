"""
Database - Cliente Supabase para operações multi-tenant
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import Request
from supabase._async.client import AsyncClient
from supabase._async.client import create_client as acreate_client

from supabase import Client, create_client

from .config import settings

# Import ConversationMetrics para logging
try:
    from app.models.conversation_log import ConversationMetrics
except ImportError:
    ConversationMetrics = None

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Cliente Supabase com suporte a multi-tenancy"""

    def __init__(self):
        """Inicializa cliente Supabase com service role key"""
        self.client: Client = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_KEY,  # SERVICE ROLE KEY
        )
        logger.info(f"Supabase client initialized: {settings.SUPABASE_URL}")

    def get_company(self, company_id: str) -> Optional[Dict[str, Any]]:
        """Busca informações de uma company"""
        try:
            response = (
                self.client.table("companies")
                .select("*")
                .eq("id", company_id)
                .maybe_single()
                .execute()
            )

            return response.data
        except Exception as e:
            logger.error(f"Error fetching company {company_id}: {str(e)}")
            return None

    def get_conversation_history(
        self, session_id: str, company_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Busca histórico de conversas ISOLADO POR COMPANY
        🔥 CORREÇÃO: Usa .limit(1) ao invés de .maybe_single() para evitar erro 406
        """
        try:
            # 1. Buscar conversation com ISOLAMENTO por company
            conversation_response = (
                self.client.table("conversations")
                .select("id")
                .eq("session_id", session_id)
                .eq("company_id", company_id)
                .limit(1)
                .execute()
            )

            # Se a lista estiver vazia ou nula
            if not conversation_response.data or len(conversation_response.data) == 0:
                logger.info(
                    f"No conversation found for session {session_id}, company {company_id}"
                )
                return []

            # Pega o primeiro item da lista
            conversation_id = conversation_response.data[0]["id"]

            # 2. Buscar mensagens da conversation
            messages_response = (
                self.client.table("messages")
                .select("role, content, type, created_at")
                .eq("conversation_id", conversation_id)
                .order("created_at", desc=False)
                .limit(limit)
                .execute()
            )

            logger.info(
                f"Fetched {len(messages_response.data)} messages for "
                f"session {session_id}, company {company_id}"
            )

            return messages_response.data

        except Exception as e:
            logger.error(
                f"Error fetching conversation history for session {session_id}, "
                f"company {company_id}: {str(e)}"
            )
            # Retorna lista vazia em caso de erro para não travar o chat
            return []

    def save_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        message_type: str = "text",
        audio_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Salva mensagem no banco"""
        try:
            response = (
                self.client.table("messages")
                .insert(
                    {
                        "conversation_id": conversation_id,
                        "role": role,
                        "content": content,
                        "type": message_type,
                        "audio_url": audio_url,
                    }
                )
                .execute()
            )

            logger.info(f"Message saved to conversation {conversation_id}")
            return response.data[0] if response.data else None

        except Exception as e:
            logger.error(f"Error saving message: {str(e)}")
            return None

    def validate_company_access(self, company_id: str) -> bool:
        """Valida se uma company existe e está ativa"""
        try:
            company = self.get_company(company_id)
            if not company:
                logger.warning(f"Company {company_id} not found")
                return False
            if company.get("status") not in ["active", "trial"]:
                return False
            return True
        except Exception as e:
            logger.error(f"Error validating company access: {str(e)}")
            return False

    def log_conversation(
        self,
        company_id: str,
        user_id: str,
        session_id: str,
        user_question: str,
        assistant_response: str,
        llm_provider: str,
        llm_model: str,
        llm_temperature: float,
        metrics: Optional["ConversationMetrics"] = None,
    ) -> bool:
        """Registra log detalhado"""
        try:
            log_data = {
                "company_id": company_id,
                "user_id": user_id,
                "session_id": session_id,
                "user_question": user_question,
                "assistant_response": assistant_response,
                "llm_provider": llm_provider,
                "llm_model": llm_model,
                "llm_temperature": llm_temperature,
                "status": "success",
            }
            if metrics:
                log_data.update(
                    {
                        "tokens_input": metrics.tokens_input,
                        "tokens_output": metrics.tokens_output,
                        "tokens_total": metrics.tokens_total,
                        "rag_chunks": metrics.to_chunks_jsonb()
                        if metrics.rag_chunks
                        else None,
                        "rag_chunks_count": len(metrics.rag_chunks)
                        if metrics.rag_chunks
                        else 0,
                        "response_time_ms": metrics.response_time_ms,
                        "rag_search_time_ms": metrics.rag_search_time_ms,
                    }
                )
            self.client.table("conversation_logs").insert(log_data).execute()
            return True
        except Exception as e:
            logger.error(f"Error logging conversation: {e}", exc_info=True)
            return False


# Singleton instance
_supabase_client: Optional[SupabaseClient] = None


def get_supabase_client() -> SupabaseClient:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = SupabaseClient()
    return _supabase_client


# ─────────────────────────────────────────────────────────────────────────────
# ASYNC CLIENT - FastAPI Native Support (Non-blocking)
# ─────────────────────────────────────────────────────────────────────────────


class AsyncSupabaseClient:
    """
    Cliente Supabase 100% assíncrono.
    Usar com FastAPI Dependency Injection via get_async_db().

    Benefícios:
    - Não bloqueia event loop do FastAPI
    - Suporta 1000+ requests simultâneos
    - Performance otimizada para async/await
    """

    def __init__(self, client: AsyncClient):
        self._client = client
        logger.info("[DB] AsyncSupabaseClient initialized")

    @property
    def client(self) -> AsyncClient:
        """Acesso direto ao client para queries customizadas"""
        return self._client

    async def get_company(self, company_id: str) -> Optional[Dict[str, Any]]:
        """Busca informações de uma company"""
        try:
            response = (
                await self._client.table("companies")
                .select("*")
                .eq("id", company_id)
                .maybe_single()
                .execute()
            )
            return response.data
        except Exception as e:
            logger.error(f"[DB] Error fetching company {company_id}: {e}")
            return None

    async def get_conversation_history(
        self, session_id: str, company_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Busca histórico de conversas isolado por company"""
        try:
            # 1. Buscar conversation com isolamento por company
            conv_response = (
                await self._client.table("conversations")
                .select("id")
                .eq("session_id", session_id)
                .eq("company_id", company_id)
                .limit(1)
                .execute()
            )

            if not conv_response.data or len(conv_response.data) == 0:
                logger.info(f"[DB] No conversation found for session {session_id}")
                return []

            conversation_id = conv_response.data[0]["id"]

            # 2. Buscar mensagens da conversation
            messages_response = (
                await self._client.table("messages")
                .select("role, content, type, created_at")
                .eq("conversation_id", conversation_id)
                .order("created_at", desc=False)
                .limit(limit)
                .execute()
            )

            logger.info(
                f"[DB] Fetched {len(messages_response.data)} messages for session {session_id}"
            )
            return messages_response.data or []

        except Exception as e:
            logger.error(f"[DB] Error fetching conversation history: {e}")
            return []

    async def save_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        message_type: str = "text",
        audio_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Salva mensagem no banco"""
        try:
            response = (
                await self._client.table("messages")
                .insert(
                    {
                        "conversation_id": conversation_id,
                        "role": role,
                        "content": content,
                        "type": message_type,
                        "audio_url": audio_url,
                    }
                )
                .execute()
            )
            logger.info(f"[DB] Message saved to conversation {conversation_id}")
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"[DB] Error saving message: {e}")
            return None

    async def validate_company_access(self, company_id: str) -> bool:
        """Valida se uma company existe e está ativa"""
        company = await self.get_company(company_id)
        if not company:
            logger.warning(f"[DB] Company {company_id} not found")
            return False
        return company.get("status") in ["active", "trial"]

    async def log_conversation(
        self,
        company_id: str,
        user_id: str,
        session_id: str,
        user_question: str,
        assistant_response: str,
        llm_provider: str,
        llm_model: str,
        llm_temperature: float,
        metrics: Optional["ConversationMetrics"] = None,
    ) -> bool:
        """Registra log detalhado de conversa"""
        try:
            log_data = {
                "company_id": company_id,
                "user_id": user_id,
                "session_id": session_id,
                "user_question": user_question,
                "assistant_response": assistant_response,
                "llm_provider": llm_provider,
                "llm_model": llm_model,
                "llm_temperature": llm_temperature,
                "status": "success",
            }
            if metrics:
                log_data.update(
                    {
                        "tokens_input": metrics.tokens_input,
                        "tokens_output": metrics.tokens_output,
                        "tokens_total": metrics.tokens_total,
                        "rag_chunks": metrics.to_chunks_jsonb()
                        if metrics.rag_chunks
                        else None,
                        "rag_chunks_count": len(metrics.rag_chunks)
                        if metrics.rag_chunks
                        else 0,
                        "response_time_ms": metrics.response_time_ms,
                        "rag_search_time_ms": metrics.rag_search_time_ms,
                    }
                )
            await self._client.table("conversation_logs").insert(log_data).execute()
            return True
        except Exception as e:
            logger.error(f"[DB] Error logging conversation: {e}")
            return False


# Factory para criar cliente async (usar no lifespan do FastAPI)
async def create_async_supabase_client() -> AsyncSupabaseClient:
    """
    Factory para criar instância do cliente async.
    Chamar no startup do FastAPI (lifespan).
    """
    client = await acreate_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return AsyncSupabaseClient(client)


# Dependency Injection para FastAPI
def get_async_db(request: Request) -> AsyncSupabaseClient:
    """
    Dependency para injetar o client async nos endpoints.

    Uso:
        @router.post("/chat")
        async def chat(db: AsyncSupabaseClient = Depends(get_async_db)):
            company = await db.get_company(company_id)
    """
    return request.app.state.supabase_async
