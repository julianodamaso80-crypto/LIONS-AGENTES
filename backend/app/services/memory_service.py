"""
MemoryService - Advanced Memory System for Agent Smith V2

ARCHITECTURE:
3-Layer Memory System:
1. Working Memory (LangGraph Checkpointer) - Current session messages
2. Summarization Layer (This service + gpt-4o-mini) - Extract facts & summaries
3. Long-Term Memory (PostgreSQL) - Persistent user profiles & session summaries

RESPONSIBILITIES:
- Load memory settings (global or per-company)
- Detect summarization triggers (message_count, session_end, inactivity)
- Extract durable facts about users (LLM-powered)
- Generate episodic session summaries (LLM-powered)
- Manage race conditions with locks and debounce
- Build memory context for prompt injection

COST OPTIMIZATION:
- ALWAYS uses gpt-4o-mini for summarization (~95% cheaper than gpt-4o)
- Estimated cost: ~$0.0003 per summarization trigger
"""

import asyncio
import inspect
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI

from app.core.callbacks.cost_callback import CostCallbackHandler
from app.core.config import settings as app_settings

logger = logging.getLogger(__name__)

from app.core.constants import (
    DEFAULT_MEMORY_SETTINGS,
    MEMORY_CONTEXT_MAX_FACTS,
    MEMORY_CONTEXT_MAX_PENDING_ITEMS,
    MEMORY_CONTEXT_MAX_SUMMARIES,
    MEMORY_MAX_CHARS_PER_FACT,
    MEMORY_MAX_FACTS_PER_USER,
    MEMORY_SUMMARY_PREVIEW_MAX_CHARS,
    MEMORY_SUMMARY_USER_FACTS_LIMIT,
)

# Default model for memory tasks (CHEAP!)
DEFAULT_MEMORY_MODEL = DEFAULT_MEMORY_SETTINGS.get("memory_llm_model", "gpt-4o-mini")


class MemoryService:
    """
    Central memory management service for Agent Smith v6.

    Key Features:
    - Configurable summarization triggers per company
    - Debounced processing to prevent race conditions
    - LLM-powered fact extraction and session summarization
    - Memory context building for prompt injection
    """

    def __init__(self, supabase_client, llm_factory=None):
        """
        Initialize MemoryService.

        Args:
            supabase_client: Supabase client for database operations (sync or async)
            llm_factory: Optional function (model_name) -> LLM instance
                        If None, creates OpenAI ChatOpenAI directly
        """
        self.supabase = supabase_client
        self.llm_factory = llm_factory
        self._debounce_tasks: Dict[
            str, asyncio.Task
        ] = {}  # session_id -> asyncio.Task (async)
    # ==========================================================================
    # HELPER: Safe Async Execution
    # ==========================================================================

    async def _safe_execute(self, query):
        """
        Helper para executar queries de forma agnóstica (Sync/Async).
        Correção: Verifica o tipo do método ANTES de executar para evitar dupla chamada.
        """
        execute_method = query.execute

        # Se o método for nativamente async (AsyncClient), aguarda direto
        if asyncio.iscoroutinefunction(execute_method) or inspect.iscoroutinefunction(execute_method):
            return await execute_method()

        # Se for sync (Client), joga para thread para não bloquear o loop
        return await asyncio.to_thread(execute_method)

    # ==========================================================================
    # CONFIGURATION
    # ==========================================================================

    def get_memory_settings(self, agent_id: str) -> Dict[str, Any]:
        """
        Load memory configuration for a specific agent.

        Args:
            agent_id: Agent UUID

        Returns:
            Dictionary with all memory settings
        """
        try:
            # Get agent-specific config
            result = (
                self.supabase.table("memory_settings")
                .select("*")
                .eq("agent_id", agent_id)
                .limit(1)
                .execute()
            )

            if result.data:
                return result.data[0]
        except Exception as e:
            logger.warning(
                f"[Memory] Error loading settings: {e}, using hardcoded defaults"
            )

        # Return centralized fallback settings
        return DEFAULT_MEMORY_SETTINGS

    async def get_memory_settings_async(self, agent_id: str) -> Dict[str, Any]:
        """
        Async version of get_memory_settings.
        Uses _safe_execute to avoid blocking the event loop.

        Args:
            agent_id: Agent UUID

        Returns:
            Dictionary with all memory settings
        """
        try:
            # Get agent-specific config
            query = (
                self.supabase.table("memory_settings")
                .select("*")
                .eq("agent_id", agent_id)
                .limit(1)
            )
            result = await self._safe_execute(query)

            if result.data:
                return result.data[0]
        except Exception as e:
            logger.warning(
                f"[Memory] Error loading settings async: {e}, using hardcoded defaults"
            )

        # Return centralized fallback settings
        return DEFAULT_MEMORY_SETTINGS

    async def clear_session_memory(self, thread_id: str) -> bool:
        """
        Clear LangGraph checkpoints for an expired session.

        This deletes all checkpoint data from the PostgreSQL tables used by
        AsyncPostgresSaver. Called when widget session TTL expires (24h).

        Args:
            thread_id: The thread_id used by LangGraph (format: "{company_id}:{session_id}")

        Returns:
            True if cleanup succeeded, False otherwise
        """
        try:
            from app.core.config import settings

            db_url = settings.SUPABASE_DB_URL
            if not db_url:
                logger.warning("[Memory] No DB_URL configured, cannot clear checkpoints")
                return False

            # Use psycopg directly for raw SQL (LangGraph tables aren't Supabase-managed)
            import psycopg

            async with await psycopg.AsyncConnection.connect(
                db_url,
                autocommit=True,
                prepare_threshold=None  # Required for PgBouncer/Supabase
            ) as conn:
                # Delete from both checkpoint tables
                await conn.execute(
                    "DELETE FROM checkpoint_writes WHERE thread_id = %s",
                    (thread_id,)
                )
                await conn.execute(
                    "DELETE FROM checkpoints WHERE thread_id = %s",
                    (thread_id,)
                )

                logger.info(f"[Memory] ✅ Cleared checkpoints for thread: {thread_id}")
                return True

        except Exception as e:
            logger.error(f"[Memory] ❌ Error clearing session memory: {e}")
            return False

    def _get_memory_llm(
        self, settings: Dict[str, Any], company_id: str = None, agent_id: str = None
    ):
        """
        Get LLM configured for memory tasks.
        ALWAYS uses cheap model (gpt-4o-mini by default).

        Args:
            settings: Memory settings dict
            company_id: Optional company UUID for cost tracking
            agent_id: Optional agent UUID for cost tracking

        Returns:
            LLM instance with cost tracking callback
        """
        model = settings.get("memory_llm_model", DEFAULT_MEMORY_MODEL)

        # Build callbacks for cost tracking
        callbacks = []
        if company_id:
            callbacks.append(
                CostCallbackHandler(
                    service_type="memory", company_id=company_id, agent_id=agent_id
                )
            )

        if self.llm_factory:
            return self.llm_factory(model)

        # Fallback: create OpenAI ChatOpenAI directly with explicit API key
        # (needed for background threads which don't inherit env vars)
        return ChatOpenAI(
            model=model,
            temperature=0.3,
            api_key=app_settings.OPENAI_API_KEY,
            callbacks=callbacks,
        )

    # ==========================================================================
    # RACE CONDITION CONTROL (LOCKS + DEBOUNCE)
    # ==========================================================================

    def _acquire_lock(self, session_id: str, company_id: str) -> bool:
        """
        Acquire lock atomically (Sync).
        Strategy: Update if free, or Insert if missing.
        """
        now = datetime.utcnow().isoformat()
        try:
            # 1. Tenta pegar um lock existente que esteja LIVRE (False)
            res = (
                self.supabase.table("memory_processing_locks")
                .update({
                    "is_processing": True,
                    "last_trigger_at": now,
                    "updated_at": now
                })
                .eq("session_id", session_id)
                .eq("company_id", company_id)
                .eq("is_processing", False) # O SEGREDO: Só atualiza se for False
                .execute()
            )

            # Se atualizou alguma linha, conseguimos o lock!
            if res.data and len(res.data) > 0:
                return True

            # 2. Se não atualizou, verifica se o registro existe
            check = (
                self.supabase.table("memory_processing_locks")
                .select("is_processing")
                .eq("session_id", session_id)
                .eq("company_id", company_id)
                .execute()
            )

            # Se existe e chegamos aqui, é porque is_processing já era True (Bloqueado)
            if check.data and len(check.data) > 0:
                return False

            # 3. Não existe -> Cria novo já travado
            try:
                insert_res = (
                    self.supabase.table("memory_processing_locks")
                    .insert({
                        "session_id": session_id,
                        "company_id": company_id,
                        "is_processing": True,
                        "last_trigger_at": now,
                        "updated_at": now,
                    })
                    .execute()
                )
                return True if insert_res.data else False
            except Exception:
                # Conflito no insert (alguém criou milissegundos antes)
                return False

        except Exception as e:
            logger.error(f"[Memory] Error acquiring lock: {e}")
            return False

    def _release_lock(self, session_id: str, company_id: str, messages_count: int):
        """
        Release processing lock after completion.

        Args:
            session_id: Session UUID
            company_id: Company UUID
            messages_count: Number of messages processed
        """
        try:
            self.supabase.table("memory_processing_locks").update(
                {
                    "is_processing": False,
                    "last_completed_at": datetime.utcnow().isoformat(),
                    "last_message_count": messages_count,
                    "scheduled_for": None,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ).eq("session_id", session_id).eq("company_id", company_id).execute()
        except Exception as e:
            logger.error(f"[Memory] Error releasing lock: {e}")

    def _is_locked(self, session_id: str, company_id: str) -> bool:
        """
        Check if session is currently being processed.

        Args:
            session_id: Session UUID
            company_id: Company UUID

        Returns:
            True if locked, False otherwise
        """
        try:
            result = (
                self.supabase.table("memory_processing_locks")
                .select("is_processing")
                .eq("session_id", session_id)
                .eq("company_id", company_id)
                .limit(1)
                .execute()
            )

            if result.data:
                return result.data[0].get("is_processing", False)
            return False
        except Exception:
            return False

    def _apply_sliding_window(
        self, messages: List[Dict[str, Any]], window_size: int
    ) -> Dict[str, Any]:
        """
        Separa mensagens para sumarização mantendo uma janela de contexto recente.

        Buffer lógico: Mantém últimas N mensagens raw, sumariza o resto.

        Args:
            messages: Lista completa de mensagens
            window_size: Tamanho da janela (ex: 50)

        Returns:
            {
                "to_summarize": [...],  # Mensagens antigas para sumarizar
                "keep_raw": [...]       # Últimas N mensagens (contexto recente)
            }
        """
        # Se temos menos mensagens que a janela, não faz nada
        if len(messages) <= window_size:
            return {"to_summarize": [], "keep_raw": messages}

        # Ponto de corte: Tudo que excede a janela (do início da lista) vai para resumo
        # Ex: 70 msgs total, window 50 -> cut_index = 20
        # to_summarize = 0 a 19 (20 msgs antigas)
        # keep_raw = 20 a 69 (50 msgs recentes)
        cut_index = len(messages) - window_size

        return {"to_summarize": messages[:cut_index], "keep_raw": messages[cut_index:]}

    # ==========================================================================
    # SUMMARIZATION TRIGGERS
    # ==========================================================================

    def should_summarize(
        self,
        settings: Dict[str, Any],
        channel: str,
        messages_count: int,
        last_message_at: datetime,
        session_ended: bool = False,
    ) -> bool:
        """
        Check if summarization should be triggered based on configuration.

        Args:
            settings: Memory settings dict
            channel: 'web' or 'whatsapp'
            messages_count: Total messages in session
            last_message_at: Timestamp of last message
            session_ended: True if session explicitly ended

        Returns:
            True if should summarize, False otherwise

        Note:
            This only checks the CONDITION. Debounce is handled in schedule_summarization().
        """
        # Web modes
        if channel == "web":
            mode = settings.get("web_summarization_mode", "session_end")

            logger.info(
                f"[Memory] Web trigger check: mode={mode}, messages={messages_count}, session_ended={session_ended}"
            )

            if mode == "session_end" and session_ended:
                return True

            if mode == "message_count":
                threshold = settings.get("web_message_threshold", 20)
                # Dispara quando atingir threshold E a cada threshold mensagens adicionais
                # Ex: threshold=10 -> dispara em 10, 20, 30... (não 11, 12...)
                should_trigger = (
                    messages_count >= threshold and messages_count % threshold == 0
                )
                logger.info(
                    f"[Memory] Web message_count: {messages_count} >= {threshold}? {messages_count >= threshold}, mod={messages_count % threshold}, trigger={should_trigger}"
                )
                return should_trigger

            if mode == "inactivity":
                timeout_min = settings.get("web_inactivity_timeout_min", 30)
                time_since_last = datetime.utcnow() - last_message_at
                return time_since_last > timedelta(minutes=timeout_min)

        # WhatsApp modes
        elif channel == "whatsapp":
            mode = settings.get("whatsapp_summarization_mode", "message_count")

            if mode == "message_count":
                threshold = settings.get("whatsapp_message_threshold", 50)
                if messages_count >= threshold:
                    logger.info(
                        f"[Memory] WhatsApp message_count mode: {messages_count} >= {threshold}"
                    )
                    return True

            elif mode == "sliding_window":
                # Buffer lógico: Só dispara quando atinge threshold, não janela
                # Ex: window=50, threshold=60 -> só sumariza quando tiver 60+
                window_size = settings.get("whatsapp_sliding_window_size", 50)
                threshold = settings.get("whatsapp_message_threshold", 50)

                if messages_count >= threshold:
                    logger.info(
                        f"[Memory] WhatsApp sliding_window mode: {messages_count} >= {threshold} (window={window_size})"
                    )
                    return True

            elif mode == "time_based":
                hours = settings.get("whatsapp_time_interval_hours", 24)
                elapsed = datetime.utcnow() - last_message_at
                if elapsed.total_seconds() >= (hours * 3600):
                    logger.info(
                        f"[Memory] WhatsApp time_based mode: {elapsed.total_seconds() / 3600:.1f}h >= {hours}h"
                    )
                    return True

        return False



    # ==========================================================================
    # MAIN PROCESSING
    # ==========================================================================

    def process_summarization(
        self,
        session_id: str,
        user_id: str,
        company_id: str,
        messages: List[Any],
        channel: str = "web",
        settings: Dict[str, Any] = None,
        agent_id: Optional[str] = None,
    ):
        """
        Process full summarization pipeline.

        Steps:
        1. Acquire lock (prevent duplicate processing)
        2. Extract user facts (if enabled)
        3. Generate session summary (if enabled)
        4. Persist to database
        5. Release lock

        Args:
            session_id: Session UUID
            user_id: User UUID
            company_id: Company UUID
            messages: List[Any] of LangChain messages
            channel: 'web' or 'whatsapp'
            settings: Optional memory settings
        """
        if settings is None:
            settings = self.get_memory_settings(agent_id)

        # Try to acquire lock
        if not self._acquire_lock(session_id, company_id):
            logger.warning(
                f"[Memory] Session {session_id} already processing, aborting"
            )
            return

        try:
            logger.info(f"[ Memory] Starting summarization for session {session_id}")

            # === SLIDING WINDOW LOGIC (WhatsApp) ===
            # Separa mensagens antigas (para sumarizar) de recentes (mantém raw)
            messages_to_process = messages  # Default (Web/Session End)

            if channel == "whatsapp":
                mode = settings.get("whatsapp_summarization_mode", "message_count")
                if mode == "sliding_window":
                    window_size = settings.get("whatsapp_sliding_window_size", 50)

                    window_data = self._apply_sliding_window(messages, window_size)

                    if not window_data["to_summarize"]:
                        logger.info(
                            "[Memory] Sliding window: Not enough messages to summarize yet."
                        )
                        self._release_lock(session_id, company_id, len(messages))
                        return  # Sai se não tiver buffer suficiente

                    messages_to_process = window_data["to_summarize"]
                    logger.info(
                        f"[Memory] Sliding window: Summarizing {len(messages_to_process)} old messages, keeping {len(window_data['keep_raw'])} recent."
                    )

            llm = self._get_memory_llm(
                settings, company_id=company_id, agent_id=agent_id
            )

            # Extract user facts
            if settings.get("extract_user_profile", True):
                existing_facts = self._get_existing_facts(
                    user_id, company_id, agent_id=agent_id
                )
                new_facts = self.extract_user_facts(
                    messages_to_process, existing_facts, llm
                )

                if new_facts:
                    # Passa settings e llm para evitar recriar e usar consolidação
                    self.save_user_memory(
                        user_id,
                        company_id,
                        new_facts,
                        settings=settings,
                        llm=llm,
                        agent_id=agent_id,
                    )
                    logger.info(
                        f"[Memory] Extracted {len(new_facts)} new facts for user {user_id} (agent: {agent_id})"
                    )

            # Generate session summary
            if settings.get("extract_session_summary", True):
                user_context = self.get_user_memory(
                    user_id, company_id, agent_id=agent_id
                )
                summary_data = self.generate_session_summary(
                    messages_to_process, user_context, llm
                )

                if summary_data:
                    self.save_session_summary(
                        session_id=session_id,
                        user_id=user_id,
                        company_id=company_id,
                        channel=channel,
                        summary_data=summary_data,
                        messages_count=len(messages_to_process),
                        agent_id=agent_id,
                    )
                    logger.info(f"[Memory] Saved summary for session {session_id}")

            logger.info(f"[Memory] Summarization completed for session {session_id}")

        except Exception as e:
            logger.error(f"[Memory] Error in summarization: {e}", exc_info=True)
        finally:
            self._release_lock(session_id, company_id, len(messages))

    # ==========================================================================
    # FACT EXTRACTION
    # ==========================================================================

    def _get_existing_facts(
        self, user_id: str, company_id: str, agent_id: Optional[str] = None
    ) -> List[str]:
        """
        Fetch existing facts for user (isolated by agent).

        Args:
            user_id: User UUID
            company_id: Company UUID
            agent_id: Agent UUID (for memory isolation)

        Returns:
            List of fact strings
        """
        try:
            query = (
                self.supabase.table("user_memories")
                .select("facts")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            result = query.limit(1).execute()

            if result.data:
                return result.data[0].get("facts", [])
            return []
        except Exception:
            return []

    def extract_user_facts(
        self, messages: List[Any], existing_facts: List[str] = None, llm=None
    ) -> List[str]:
        """
        Extract durable facts about user using LLM.

        Args:
            messages: List[Any] of LangChain messages
            existing_facts: Previously extracted facts (for dedup)
            llm: LLM instance (gpt-4o-mini)

        Returns:
            List of NEW facts (non-duplicated)
        """
        if not messages:
            return []

        existing_facts = existing_facts or []
        conversation_text = self._format_messages_for_prompt(messages)

        prompt = f"""Analise a conversa abaixo e extraia APENAS fatos DURÁVEIS e IMPORTANTES sobre o usuário.

EXTRAIA:
- Informações profissionais (cargo, empresa, departamento, projetos)
- Preferências de comunicação (formal/informal, respostas longas/curtas)
- Interesses e tópicos recorrentes
- Decisões tomadas que afetam o futuro
- Compromissos ou pendências mencionadas

NÃO EXTRAIA:
- Cumprimentos e small talk
- Perguntas genéricas sem contexto pessoal
- Informações já conhecidas/repetidas
- Opiniões momentâneas sem impacto duradouro

FATOS JÁ CONHECIDOS (evite duplicar ou contradizer sem necessidade):
{chr(10).join(f"- {f}" for f in existing_facts) if existing_facts else "(nenhum)"}

CONVERSA:
{conversation_text}

Responda APENAS com uma lista JSON de novos fatos (strings curtas e objetivas):
["fato 1", "fato 2", "fato 3"]

Se não houver fatos novos relevantes, responda: []"""

        try:
            response = llm.invoke(prompt)  # SYNC, não ainvoke
            content = response.content.strip()

            # Parse JSON
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            facts = json.loads(content)

            if isinstance(facts, list):
                return [f for f in facts if isinstance(f, str) and f.strip()]
            return []

        except Exception as e:
            logger.error(f"[Memory] Error extracting facts: {e}")
            return []

    # ==========================================================================
    # SUMMARY GENERATION
    # ==========================================================================

    def generate_session_summary(
        self, messages: List[Any], user_context: Dict[str, Any] = None, llm=None
    ) -> Optional[Dict[str, Any]]:
        """
        Generate structured session summary using LLM.

        Args:
            messages: List[Any] of LangChain messages
            user_context: User memory dict (for context)
            llm: LLM instance (gpt-4o-mini)

        Returns:
            Dict with {summary, topics, decisions, pending_items} or None
        """
        if not messages:
            return None

        conversation_text = self._format_messages_for_prompt(messages)

        user_context_text = ""
        if user_context and user_context.get("facts"):
            user_context_text = f"""
CONTEXTO DO USUÁRIO:
{chr(10).join(f"- {f}" for f in user_context.get("facts", [])[:MEMORY_SUMMARY_USER_FACTS_LIMIT])}
"""

        prompt = f"""Gere um resumo estruturado da conversa abaixo.
{user_context_text}
CONVERSA:
{conversation_text}

Responda em JSON com a seguinte estrutura:
{{
    "summary": "Resumo narrativo de 2-4 frases descrevendo o que foi discutido e concluído",
    "topics": ["tópico1", "tópico2"],
    "decisions": ["decisão tomada pelo usuário"],
    "pending_items": ["pendência ou follow-up necessário"]
}}

Se algum campo não se aplicar, use array vazio [].
Responda APENAS o JSON, sem texto adicional."""

        try:
            response = llm.invoke(prompt)  # SYNC, não ainvoke
            content = response.content.strip()

            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            return json.loads(content)

        except Exception as e:
            logger.error(f"[Memory] Error generating summary: {e}")
            return None

    # ==========================================================================
    # MEMORY CONSOLIDATION (LLM-POWERED)
    # ==========================================================================

    def _consolidate_facts(
        self, current_facts: List[str], new_facts: List[str], llm
    ) -> List[str]:
        """
        Usa o LLM para fundir fatos antigos e novos, removendo obsoletos e duplicados.

        Args:
            current_facts: Lista de fatos existentes
            new_facts: Lista de novos fatos extraídos
            llm: LLM instance (gpt-4o-mini)

        Returns:
            Lista consolidada de fatos únicos e relevantes (máximo 8)
        """
        # Se não houver fatos antigos, retorna os novos sem gastar LLM
        if not current_facts:
            return new_facts[:8]  # Limita já na entrada

        # Se não houver novos fatos, mantém os antigos
        if not new_facts:
            return current_facts[:8]

        # Prompt de Engenharia de Memória (Otimizado)
        prompt = f"""Você é um Gerente de Memória de uma IA.
Sua função é manter a lista de fatos sobre o usuário ATUALIZADA, CONCISA e SEM DUPLICATAS.

FATOS ANTIGOS (memória existente):
{json.dumps(current_facts, ensure_ascii=False)}

NOVOS FATOS (extraídos da conversa AGORA):
{json.dumps(new_facts, ensure_ascii=False)}

REGRAS DE DISTRIBUIÇÃO (OBRIGATÓRIO):
- MÁXIMO 8 fatos no total
- ATÉ 6 fatos de IDENTIDADE (nome, cargo, empresa, preferências pessoais como hobbies, gostos)
- MÍNIMO 2 fatos de CONTEXTO ATUAL (projetos, ferramentas, tópicos que está trabalhando AGORA)

INSTRUÇÕES:
1. Os NOVOS FATOS representam o contexto ATUAL do usuário.
2. Se um FATO ANTIGO de contexto não tem mais relação com os temas atuais, REMOVA-O.
   Exemplo: Se antes falava de "Make.com" e agora só fala de "N8N", remova o fato do Make.com.
3. Fatos de IDENTIDADE são permanentes (nome, cargo, hobbies) - só remova se contraditos.
4. PRIORIZE os 2 fatos de contexto mais recentes/relevantes da conversa atual.
5. Se houver contradição, o NOVO fato prevalece.
6. SEJA CONCISO: Cada fato deve ter no máximo 15 palavras.

Retorne APENAS uma lista JSON de strings: ["fato 1", "fato 2"]"""

        try:
            response = llm.invoke(prompt)
            content = response.content.strip()

            # Limpeza básica de markdown json
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            consolidated = json.loads(content)

            if isinstance(consolidated, list):
                # === CAMADA DE SEGURANÇA: Truncação ===
                MAX_CHARS = MEMORY_MAX_CHARS_PER_FACT
                MAX_FACTS = MEMORY_MAX_FACTS_PER_USER

                sanitized_facts = []
                for fact in consolidated[:MAX_FACTS]:
                    fact_str = str(fact).strip()
                    if len(fact_str) > MAX_CHARS:
                        fact_str = fact_str[: MAX_CHARS - 3] + "..."
                    if fact_str:
                        sanitized_facts.append(fact_str)

                logger.info(
                    f"[Memory] Consolidation: {len(current_facts)} old + {len(new_facts)} new -> {len(sanitized_facts)} final"
                )
                return sanitized_facts

            return new_facts[:8]  # Fallback se o JSON falhar

        except Exception as e:
            logger.error(f"[Memory] Erro na consolidação: {e}")
            # Fallback seguro: pega mais recentes, remove duplicatas
            combined = list(
                dict.fromkeys(new_facts + current_facts)
            )  # Remove duplicatas mantendo ordem
            return combined[:8]

    # ==========================================================================
    # PERSISTENCE
    # ==========================================================================

    def save_user_memory(
        self,
        user_id: str,
        company_id: str,
        new_facts: List[str],
        settings: Dict[str, Any] = None,
        llm=None,
        agent_id: Optional[str] = None,
    ):
        """
        Save/update user memory facts with LLM Consolidation (isolated by agent).

        Instead of just appending, uses LLM to merge old and new facts,
        removing duplicates and obsolete information.

        Args:
            user_id: User UUID
            company_id: Company UUID
            new_facts: List of new fact strings
            settings: Memory settings (optional, will fetch if None)
            llm: LLM instance (optional, will create if None)
            agent_id: Agent UUID (for memory isolation)
        """
        try:
            # Fetch existing record (filtered by agent_id)
            query = (
                self.supabase.table("user_memories")
                .select("id, facts")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            existing = query.limit(1).execute()

            if existing.data:
                # UPDATE: Consolida o antigo com o novo usando LLM
                current_facts = existing.data[0].get("facts", [])

                # Prepara o LLM para consolidação (se não foi passado)
                if llm is None:
                    if settings is None:
                        settings = self.get_memory_settings(agent_id)
                    llm = self._get_memory_llm(settings, company_id=company_id)

                # CHAMA A NOVA LÓGICA DE CONSOLIDAÇÃO
                updated_facts = self._consolidate_facts(current_facts, new_facts, llm)

                self.supabase.table("user_memories").update(
                    {
                        "facts": updated_facts,
                        "facts_count": len(updated_facts),
                        "last_extraction_at": datetime.utcnow().isoformat(),
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", existing.data[0]["id"]).execute()

                logger.info(
                    f"[Memory] Updated user memory: {len(updated_facts)} consolidated facts (agent: {agent_id})"
                )
            else:
                # INSERT: Cria novo registro isolado por agente
                insert_data = {
                    "user_id": user_id,
                    "company_id": company_id,
                    "facts": new_facts,
                    "facts_count": len(new_facts),
                    "last_extraction_at": datetime.utcnow().isoformat(),
                }

                if agent_id:
                    insert_data["agent_id"] = agent_id

                self.supabase.table("user_memories").insert(insert_data).execute()

                logger.info(
                    f"[Memory] Created new user memory with {len(new_facts)} facts (agent: {agent_id})"
                )

        except Exception as e:
            logger.error(f"[Memory] Error saving user memory: {e}")

    def save_session_summary(
        self,
        session_id: str,
        user_id: str,
        company_id: str,
        channel: str,
        summary_data: Dict[str, Any],
        messages_count: int,
        agent_id: Optional[str] = None,
    ):
        """
        Save session summary to database.

        Args:
            session_id: Session UUID
            user_id: User UUID
            company_id: Company UUID
            channel: 'web' or 'whatsapp'
            summary_data: Dict[str, Any] with summary, topics, decisions, pending_items
            messages_count: Number of messages in session
        """
        try:
            self.supabase.table("session_summaries").insert(
                {
                    "session_id": session_id,
                    "user_id": user_id,
                    "company_id": company_id,
                    "channel": channel,
                    "summary": summary_data.get("summary", ""),
                    "topics": summary_data.get("topics", []),
                    "decisions": summary_data.get("decisions", []),
                    "pending_items": summary_data.get("pending_items", []),
                    "messages_count": messages_count,
                    "ended_at": datetime.utcnow().isoformat(),
                    "agent_id": agent_id,
                }
            ).execute()
        except Exception as e:
            logger.error(f"[Memory] Error saving session summary: {e}")

    # ==========================================================================
    # RETRIEVAL (For prompt injection)
    # ==========================================================================

    def get_user_memory(
        self, user_id: str, company_id: str, agent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch user memory profile (isolated by agent).

        Args:
            user_id: User UUID
            company_id: Company UUID
            agent_id: Agent UUID (for memory isolation)

        Returns:
            User memory dict or empty dict
        """
        try:
            query = (
                self.supabase.table("user_memories")
                .select("*")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            result = query.limit(1).execute()

            if result.data:
                return result.data[0]
            return {}
        except Exception:
            return {}

    def get_recent_summaries(
        self,
        user_id: str,
        company_id: str,
        limit: int = 5,
        agent_id: Optional[str] = None,
    ) -> List[Dict]:
        """
        Fetch recent session summaries.

        Args:
            user_id: User UUID
            company_id: Company UUID
            limit: Max summaries to return

        Returns:
            List of summary dicts
        """
        try:
            query = (
                self.supabase.table("session_summaries")
                .select("*")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            result = query.order("created_at", desc=True).limit(limit).execute()

            return result.data or []
        except Exception:
            return []

    def build_memory_context(
        self,
        user_id: str,
        company_id: str,
        current_query: str = None,
        max_facts: int = MEMORY_CONTEXT_MAX_FACTS,
        max_summaries: int = MEMORY_CONTEXT_MAX_SUMMARIES,
        agent_id: Optional[str] = None,
    ) -> str:
        """
        Build memory context string for prompt injection.

        Combines: user facts + recent summaries + pending items

        Args:
            user_id: User UUID
            company_id: Company UUID
            current_query: Current user question (for future rerank)
            max_facts: Max facts to include
            max_summaries: Max summaries to include

        Returns:
            Formatted memory context string

        NOTE FOR FUTURE:
            When current_query is provided, we can use rerank_service
            to order facts by relevance instead of just taking last N.
        """
        user_mem = self.get_user_memory(user_id, company_id, agent_id=agent_id)
        summaries = self.get_recent_summaries(
            user_id, company_id, limit=max_summaries, agent_id=agent_id
        )

        context_parts = []

        # === USER FACTS ===
        if user_mem and user_mem.get("facts"):
            facts = user_mem["facts"]

            # TODO FUTURE: Rerank by relevance to current_query
            # For now, take last N (most recent)
            selected_facts = facts[-max_facts:] if len(facts) > max_facts else facts

            context_parts.append("**Sobre este usuário:**")
            for fact in selected_facts:
                context_parts.append(f"- {fact}")

        # === PREVIOUS CONVERSATIONS ===
        if summaries:
            context_parts.append("\n**Conversas anteriores relevantes:**")
            for s in summaries:
                # Format date
                created = s.get("created_at", "")
                if created:
                    try:
                        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        date_str = dt.strftime("%d/%m")
                    except Exception:
                        date_str = "?"
                else:
                    date_str = "?"

                summary_text = s.get("summary", "")[:MEMORY_SUMMARY_PREVIEW_MAX_CHARS]
                context_parts.append(f"- {date_str}: {summary_text}")

        # === PENDING ITEMS ===
        all_pending = []
        for s in summaries:
            all_pending.extend(s.get("pending_items", []))

        if all_pending:
            context_parts.append("\n**Pendências identificadas:**")
            for p in all_pending[:MEMORY_CONTEXT_MAX_PENDING_ITEMS]:
                context_parts.append(f"- {p}")

        return "\n".join(context_parts) if context_parts else ""

    # ==========================================================================
    # ASYNC CONTEXT LOADING METHODS
    # ==========================================================================

    async def get_user_memory_async(
        self, user_id: str, company_id: str, agent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch user memory profile (ASYNC).
        Hybrid implementation: Handles both Sync Client (via thread) and Async Client.
        """
        try:
            query = (
                self.supabase.table("user_memories")
                .select("*")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            # CORREÇÃO: Usar _safe_execute
            result = await self._safe_execute(query.limit(1))

            if result.data:
                return result.data[0]
            return {}

        except Exception as e:
            logger.error(f"[Memory] ❌ Falha ao buscar user_memories: {e}")
            return {}

    async def get_recent_summaries_async(
        self,
        user_id: str,
        company_id: str,
        limit: int = 5,
        agent_id: Optional[str] = None,
    ) -> List[Dict]:
        """Fetch recent session summaries (ASYNC via Thread)."""
        try:
            query = (
                self.supabase.table("session_summaries")
                .select("*")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            # CORREÇÃO: Executa o cliente síncrono em uma thread
            result = await self._safe_execute(query.order("created_at", desc=True).limit(limit))

            return result.data or []
        except Exception as e:
            logger.error(f"[Memory] ❌ Falha ao buscar session_summaries: {e}")
            return []

    async def build_memory_context_async(
        self,
        user_id: str,
        company_id: str,
        current_query: str = None,
        max_facts: int = MEMORY_CONTEXT_MAX_FACTS,
        max_summaries: int = MEMORY_CONTEXT_MAX_SUMMARIES,
        agent_id: Optional[str] = None,
    ) -> str:
        """
        Build memory context string for prompt injection (ASYNC version).
        Combines: user facts + recent summaries + pending items
        """
        # Execute queries in parallel for performance
        user_mem, summaries = await asyncio.gather(
            self.get_user_memory_async(user_id, company_id, agent_id=agent_id),
            self.get_recent_summaries_async(user_id, company_id, limit=max_summaries, agent_id=agent_id)
        )

        context_parts = []

        # === USER FACTS ===
        if user_mem and user_mem.get("facts"):
            facts = user_mem["facts"]
            selected_facts = facts[-max_facts:] if len(facts) > max_facts else facts

            context_parts.append("**Sobre este usuário:**")
            for fact in selected_facts:
                context_parts.append(f"- {fact}")

        # === PREVIOUS CONVERSATIONS ===
        if summaries:
            context_parts.append("\n**Conversas anteriores relevantes:**")
            for s in summaries:
                created = s.get("created_at", "")
                date_str = "?"
                if created:
                    try:
                        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        date_str = dt.strftime("%d/%m")
                    except Exception:
                        pass

                summary_text = s.get("summary", "")[:MEMORY_SUMMARY_PREVIEW_MAX_CHARS]
                context_parts.append(f"- {date_str}: {summary_text}")

        # === PENDING ITEMS ===
        all_pending = []
        for s in summaries:
            all_pending.extend(s.get("pending_items", []))

        if all_pending:
            context_parts.append("\n**Pendências identificadas:**")
            for p in all_pending[:MEMORY_CONTEXT_MAX_PENDING_ITEMS]:
                context_parts.append(f"- {p}")

        return "\n".join(context_parts) if context_parts else ""

    # ==========================================================================
    # HELPERS
    # ==========================================================================

    def _format_messages_for_prompt(self, messages: List[Any]) -> str:
        """
        Format LangChain messages to readable text.

        Args:
            messages: List[Any] of LangChain message objects

        Returns:
            Formatted conversation string
        """
        lines = []
        for msg in messages:
            if hasattr(msg, "type"):
                role = msg.type  # 'human', 'ai', 'system'
            elif hasattr(msg, "role"):
                role = msg.role
            else:
                role = "unknown"

            content = getattr(msg, "content", str(msg))

            if role in ["human", "user"]:
                lines.append(f"Usuário: {content}")
            elif role in ["ai", "assistant"]:
                lines.append(f"Assistente: {content}")
            # Ignore system messages

        return "\n".join(lines)

    # ==========================================================================
    # ASYNC METHODS - 100% Non-blocking (FastAPI Event Loop Compatible)
    # ==========================================================================

    async def schedule_summarization_async(
        self,
        session_id: str,
        user_id: str,
        company_id: str,
        messages: List[Any],
        channel: str,
        settings: Dict[str, Any] = None,
        agent_id: Optional[str] = None,
    ):
        """
        Schedule summarization with DEBOUNCE using asyncio.create_task.

        If a task is already scheduled for this session, cancel it and reschedule.
        This prevents 5 rapid messages from triggering 5 summarizations.

        ASYNC VERSION - Uses asyncio instead of threading.Timer
        """
        if settings is None:
            settings = await self.get_memory_settings_async(agent_id)

        debounce_seconds = settings.get("debounce_seconds", 10)
        task_key = f"{company_id}:{session_id}"

        # Cancel previous task if exists
        if task_key in self._debounce_tasks:
            old_task = self._debounce_tasks[task_key]
            old_task.cancel()
            logger.debug(f"[Memory] Debounce: cancelled previous task for {task_key}")

        async def _debounced_summarization():
            try:
                await asyncio.sleep(debounce_seconds)
                logger.info(
                    f"[Memory] Debounce complete, starting summarization for {task_key}"
                )
                await self.process_summarization_async(
                    session_id=session_id,
                    user_id=user_id,
                    company_id=company_id,
                    messages=messages,
                    channel=channel,
                    settings=settings,
                    agent_id=agent_id,
                )
            except asyncio.CancelledError:
                logger.debug(f"[Memory] Task cancelled for {task_key}")
            except Exception as e:
                logger.error(
                    f"[Memory] Error in async summarization: {e}", exc_info=True
                )
            finally:
                self._debounce_tasks.pop(task_key, None)

        # Create new task
        task = asyncio.create_task(_debounced_summarization())
        self._debounce_tasks[task_key] = task

        logger.info(
            f"[Memory] Scheduled async summarization for {task_key} in {debounce_seconds}s"
        )

    async def _acquire_lock_async(self, session_id: str, company_id: str) -> bool:
        """
        Acquire lock atomically (Async/Hybrid).
        """
        now = datetime.utcnow().isoformat()
        try:
            # 1. Tenta pegar lock livre
            query_update = (
                self.supabase.table("memory_processing_locks")
                .update({
                    "is_processing": True,
                    "last_trigger_at": now,
                    "updated_at": now
                })
                .eq("session_id", session_id)
                .eq("company_id", company_id)
                .eq("is_processing", False)
            )
            res = await self._safe_execute(query_update)

            if res.data and len(res.data) > 0:
                return True

            # 2. Verifica existência
            query_check = (
                self.supabase.table("memory_processing_locks")
                .select("is_processing")
                .eq("session_id", session_id)
                .eq("company_id", company_id)
            )
            check = await self._safe_execute(query_check)

            if check.data and len(check.data) > 0:
                return False # Já existe e está travado

            # 3. Cria novo
            try:
                query_insert = (
                    self.supabase.table("memory_processing_locks")
                    .insert({
                        "session_id": session_id,
                        "company_id": company_id,
                        "is_processing": True,
                        "last_trigger_at": now,
                        "updated_at": now,
                    })
                )
                insert_res = await self._safe_execute(query_insert)
                return True if insert_res.data else False
            except Exception:
                return False

        except Exception as e:
            logger.error(f"[Memory] Error acquiring lock async: {e}")
            return False

    async def _release_lock_async(
        self, session_id: str, company_id: str, messages_count: int
    ):
        """Release processing lock after completion (ASYNC)."""
        try:
            await self._safe_execute(
                self.supabase.table("memory_processing_locks")
                .update(
                    {
                        "is_processing": False,
                        "last_completed_at": datetime.utcnow().isoformat(),
                        "last_message_count": messages_count,
                        "scheduled_for": None,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                )
                .eq("session_id", session_id)
                .eq("company_id", company_id)
            )
        except Exception as e:
            logger.error(f"[Memory] Error releasing lock async: {e}")

    async def _get_existing_facts_async(
        self, user_id: str, company_id: str, agent_id: Optional[str] = None
    ) -> List[str]:
        """Fetch existing facts for user (ASYNC, isolated by agent)."""
        try:
            query = (
                self.supabase.table("user_memories")
                .select("facts")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            result = await self._safe_execute(query.limit(1))

            if result.data:
                return result.data[0].get("facts", [])
            return []
        except Exception:
            return []

    async def extract_user_facts_async(
        self, messages: List[Any], existing_facts: List[str] = None, llm=None
    ) -> List[str]:
        """
        Extract durable facts about user using LLM (ASYNC with ainvoke).
        """
        if not messages:
            return []

        existing_facts = existing_facts or []
        conversation_text = self._format_messages_for_prompt(messages)

        prompt = f"""Analise a conversa abaixo e extraia APENAS fatos DURÁVEIS e IMPORTANTES sobre o usuário.

EXTRAIA:
- Informações profissionais (cargo, empresa, departamento, projetos)
- Preferências de comunicação (formal/informal, respostas longas/curtas)
- Interesses e tópicos recorrentes
- Decisões tomadas que afetam o futuro
- Compromissos ou pendências mencionadas

NÃO EXTRAIA:
- Cumprimentos e small talk
- Perguntas genéricas sem contexto pessoal
- Informações já conhecidas/repetidas
- Opiniões momentâneas sem impacto duradouro

FATOS JÁ CONHECIDOS (evite duplicar ou contradizer sem necessidade):
{chr(10).join(f"- {f}" for f in existing_facts) if existing_facts else "(nenhum)"}

CONVERSA:
{conversation_text}

Responda APENAS com uma lista JSON de novos fatos (strings curtas e objetivas):
["fato 1", "fato 2", "fato 3"]

Se não houver fatos novos relevantes, responda: []"""

        try:
            response = await llm.ainvoke(prompt)  # ASYNC!
            content = response.content.strip()

            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            facts = json.loads(content)

            if isinstance(facts, list):
                return [f for f in facts if isinstance(f, str) and f.strip()]
            return []

        except Exception as e:
            logger.error(f"[Memory] Error extracting facts async: {e}")
            return []

    async def generate_session_summary_async(
        self, messages: List[Any], user_context: Dict[str, Any] = None, llm=None
    ) -> Optional[Dict[str, Any]]:
        """
        Generate structured session summary using LLM (ASYNC with ainvoke).
        """
        if not messages:
            return None

        conversation_text = self._format_messages_for_prompt(messages)

        user_context_text = ""
        if user_context and user_context.get("facts"):
            user_context_text = f"""
CONTEXTO DO USUÁRIO:
{chr(10).join(f"- {f}" for f in user_context.get("facts", [])[:5])}
"""

        prompt = f"""Gere um resumo estruturado da conversa abaixo.
{user_context_text}
CONVERSA:
{conversation_text}

Responda em JSON com a seguinte estrutura:
{{
    "summary": "Resumo narrativo de 2-4 frases descrevendo o que foi discutido e concluído",
    "topics": ["tópico1", "tópico2"],
    "decisions": ["decisão tomada pelo usuário"],
    "pending_items": ["pendência ou follow-up necessário"]
}}

Se algum campo não se aplicar, use array vazio [].
Responda APENAS o JSON, sem texto adicional."""

        try:
            response = await llm.ainvoke(prompt)  # ASYNC!
            content = response.content.strip()

            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            return json.loads(content)

        except Exception as e:
            logger.error(f"[Memory] Error generating summary async: {e}")
            return None

    async def _consolidate_facts_async(
        self, current_facts: List[str], new_facts: List[str], llm
    ) -> List[str]:
        """
        Use LLM to merge old and new facts (ASYNC with ainvoke).
        """
        if not current_facts:
            return new_facts[:8]

        if not new_facts:
            return current_facts[:8]

        prompt = f"""Você é um Gerente de Memória de uma IA.
Sua função é manter a lista de fatos sobre o usuário ATUALIZADA, CONCISA e SEM DUPLICATAS.

FATOS ANTIGOS (memória existente):
{json.dumps(current_facts, ensure_ascii=False)}

NOVOS FATOS (extraídos da conversa AGORA):
{json.dumps(new_facts, ensure_ascii=False)}

REGRAS DE DISTRIBUIÇÃO (OBRIGATÓRIO):
- MÁXIMO 8 fatos no total
- ATÉ 6 fatos de IDENTIDADE (nome, cargo, empresa, preferências pessoais como hobbies, gostos)
- MÍNIMO 2 fatos de CONTEXTO ATUAL (projetos, ferramentas, tópicos que está trabalhando AGORA)

INSTRUÇÕES:
1. Os NOVOS FATOS representam o contexto ATUAL do usuário.
2. Se um FATO ANTIGO de contexto não tem mais relação com os temas atuais, REMOVA-O.
3. Fatos de IDENTIDADE são permanentes (nome, cargo, hobbies) - só remova se contraditos.
4. PRIORIZE os 2 fatos de contexto mais recentes/relevantes da conversa atual.
5. Se houver contradição, o NOVO fato prevalece.
6. SEJA CONCISO: Cada fato deve ter no máximo 15 palavras.

Retorne APENAS uma lista JSON de strings: ["fato 1", "fato 2"]"""

        try:
            response = await llm.ainvoke(prompt)  # ASYNC!
            content = response.content.strip()

            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            consolidated = json.loads(content)

            if isinstance(consolidated, list):
                MAX_CHARS = 150
                MAX_FACTS = 8

                sanitized_facts = []
                for fact in consolidated[:MAX_FACTS]:
                    fact_str = str(fact).strip()
                    if len(fact_str) > MAX_CHARS:
                        fact_str = fact_str[: MAX_CHARS - 3] + "..."
                    if fact_str:
                        sanitized_facts.append(fact_str)

                logger.info(
                    f"[Memory] Async consolidation: {len(current_facts)} old + {len(new_facts)} new -> {len(sanitized_facts)} final"
                )
                return sanitized_facts

            return new_facts[:8]

        except Exception as e:
            logger.error(f"[Memory] Error in async consolidation: {e}")
            combined = list(dict.fromkeys(new_facts + current_facts))
            return combined[:8]

    async def save_user_memory_async(
        self,
        user_id: str,
        company_id: str,
        new_facts: List[str],
        settings: Dict[str, Any] = None,
        llm=None,
        agent_id: Optional[str] = None,
    ):
        """Save/update user memory facts with LLM Consolidation (ASYNC)."""
        try:
            query = (
                self.supabase.table("user_memories")
                .select("id, facts")
                .eq("user_id", user_id)
                .eq("company_id", company_id)
            )

            if agent_id:
                query = query.eq("agent_id", agent_id)

            # CORREÇÃO: Usar _safe_execute na leitura
            existing = await self._safe_execute(query.limit(1))

            if existing.data:
                current_facts = existing.data[0].get("facts", [])

                if llm is None:
                    if settings is None:
                        settings = await self.get_memory_settings_async(agent_id)
                    llm = self._get_memory_llm(settings, company_id=company_id)

                updated_facts = await self._consolidate_facts_async(
                    current_facts, new_facts, llm
                )

                # CORREÇÃO: Usar _safe_execute no update
                update_query = (
                    self.supabase.table("user_memories")
                    .update({
                        "facts": updated_facts,
                        "facts_count": len(updated_facts),
                        "last_extraction_at": datetime.utcnow().isoformat(),
                        "updated_at": datetime.utcnow().isoformat(),
                    })
                    .eq("id", existing.data[0]["id"])
                )
                await self._safe_execute(update_query)

                logger.info(
                    f"[Memory] Async: Updated user memory with {len(updated_facts)} consolidated facts (agent: {agent_id})"
                )
            else:
                insert_data = {
                    "user_id": user_id,
                    "company_id": company_id,
                    "facts": new_facts,
                    "facts_count": len(new_facts),
                    "last_extraction_at": datetime.utcnow().isoformat(),
                }

                if agent_id:
                    insert_data["agent_id"] = agent_id
                # CORREÇÃO: Usar _safe_execute no insert
                insert_query = self.supabase.table("user_memories").insert(insert_data)
                await self._safe_execute(insert_query)

                logger.info(
                    f"[Memory] Async: Created new user memory with {len(new_facts)} facts (agent: {agent_id})"
                )

        except Exception as e:
            logger.error(f"[Memory] Error saving user memory async: {e}")

    async def save_session_summary_async(
        self,
        session_id: str,
        user_id: str,
        company_id: str,
        channel: str,
        summary_data: Dict[str, Any],
        messages_count: int,
        agent_id: Optional[str] = None,
    ):
        """Save session summary to database (ASYNC)."""
        try:
            await (
                self.supabase.table("session_summaries")
                .insert(
                    {
                        "session_id": session_id,
                        "user_id": user_id,
                        "company_id": company_id,
                        "channel": channel,
                        "summary": summary_data.get("summary", ""),
                        "topics": summary_data.get("topics", []),
                        "decisions": summary_data.get("decisions", []),
                        "pending_items": summary_data.get("pending_items", []),
                        "messages_count": messages_count,
                        "ended_at": datetime.utcnow().isoformat(),
                        "agent_id": agent_id,
                    }
                )
                .execute()
            )
        except Exception as e:
            logger.error(f"[Memory] Error saving session summary async: {e}")

    # NOTE: get_user_memory_async is now defined once above (line ~1114) with hybrid Sync/Async support

    async def process_summarization_async(
        self,
        session_id: str,
        user_id: str,
        company_id: str,
        messages: List[Any],
        channel: str = "web",
        settings: Dict[str, Any] = None,
        agent_id: Optional[str] = None,
    ):
        """
        Process full summarization pipeline (ASYNC).

        Steps:
        1. Acquire lock (prevent duplicate processing)
        2. Extract user facts (if enabled)
        3. Generate session summary (if enabled)
        4. Persist to database
        5. Release lock
        """
        if settings is None:
            settings = await self.get_memory_settings_async(agent_id)

        if not await self._acquire_lock_async(session_id, company_id):
            logger.warning(
                f"[Memory] Session {session_id} already processing, aborting"
            )
            return

        try:
            logger.info(
                f"[Memory] Starting async summarization for session {session_id}"
            )

            # === SLIDING WINDOW LOGIC (WhatsApp) ===
            messages_to_process = messages

            if channel == "whatsapp":
                mode = settings.get("whatsapp_summarization_mode", "message_count")
                if mode == "sliding_window":
                    window_size = settings.get("whatsapp_sliding_window_size", 50)

                    window_data = self._apply_sliding_window(messages, window_size)

                    if not window_data["to_summarize"]:
                        logger.info(
                            "[Memory] Sliding window: Not enough messages to summarize yet."
                        )
                        await self._release_lock_async(
                            session_id, company_id, len(messages)
                        )
                        return

                    messages_to_process = window_data["to_summarize"]
                    logger.info(
                        f"[Memory] Sliding window: Summarizing {len(messages_to_process)} old messages"
                    )

            llm = self._get_memory_llm(
                settings, company_id=company_id, agent_id=agent_id
            )

            # Extract user facts
            if settings.get("extract_user_profile", True):
                existing_facts = await self._get_existing_facts_async(
                    user_id, company_id, agent_id=agent_id
                )
                new_facts = await self.extract_user_facts_async(
                    messages_to_process, existing_facts, llm
                )

                if new_facts:
                    await self.save_user_memory_async(
                        user_id,
                        company_id,
                        new_facts,
                        settings=settings,
                        llm=llm,
                        agent_id=agent_id,
                    )
                    logger.info(
                        f"[Memory] Async: Extracted {len(new_facts)} new facts for user {user_id}"
                    )

            # Generate session summary
            if settings.get("extract_session_summary", True):
                user_context = await self.get_user_memory_async(
                    user_id, company_id, agent_id=agent_id
                )
                summary_data = await self.generate_session_summary_async(
                    messages_to_process, user_context, llm
                )

                if summary_data:
                    await self.save_session_summary_async(
                        session_id=session_id,
                        user_id=user_id,
                        company_id=company_id,
                        channel=channel,
                        summary_data=summary_data,
                        messages_count=len(messages_to_process),
                        agent_id=agent_id,
                    )
                    logger.info(
                        f"[Memory] Async: Saved summary for session {session_id}"
                    )

            logger.info(
                f"[Memory] Async summarization completed for session {session_id}"
            )

        except Exception as e:
            logger.error(f"[Memory] Error in async summarization: {e}", exc_info=True)
        finally:
            await self._release_lock_async(session_id, company_id, len(messages))
