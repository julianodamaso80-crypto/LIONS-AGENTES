"""
SubAgent Tool — Executa um SubAgente especialista como uma Tool LangChain.

O SubAgent roda como um ReAct loop efêmero (sem StateGraph, sem Checkpoint, sem Pool).
Acessa RAG, MCP e HTTP Tools via service singletons — mesma infraestrutura do agente principal.

Billing: O LLMFactory injeta CostCallbackHandler com o agent_id do subagent,
garantindo que cada chamada LLM seja logada no usage_service automaticamente.
O retorno JSON também inclui tokens_used para agregação no conversation_logs.

Observabilidade: LangSmith recebe child runs automaticamente via LangChain callbacks.
"""

import asyncio
import concurrent.futures
import json
import logging
import time
from typing import Any, Dict, List, Optional, Type

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# =========================================================
# Defaults (overridden by agent_delegations config)
# =========================================================
DEFAULT_MAX_ITERATIONS = 5
DEFAULT_TIMEOUT_SECONDS = 30

# Tools que NUNCA devem ser dadas ao SubAgent
EXCLUDED_TOOL_TYPES = {
    "request_human_agent",       # Só orquestrador pode escalar
    "store_product_search",      # Retorna JSON p/ carrossel (renderiza no front)
    "ucp_checkout",              # Checkout direto (renderiza no front)
}


# =========================================================
# Input Schema
# =========================================================
class DelegateToSubagentInput(BaseModel):
    """Schema de entrada para delegação ao SubAgent."""

    task_description: str = Field(
        description="Descrição clara da tarefa para o especialista resolver"
    )
    subagent_id: str = Field(
        description="ID do subagente especialista para delegar"
    )


# =========================================================
# SubAgent Tool
# =========================================================
class SubAgentTool(BaseTool):
    """
    Tool que executa um SubAgente especialista dentro do grafo do Orquestrador.

    Funciona como uma "Super Tool": internamente cria um LLM, faz bind de
    um subset das tools do subagente, e executa um ReAct loop síncrono.

    SEM StateGraph, SEM checkpoint, SEM pool de conexões extra.
    """

    name: str = "delegate_to_subagent"
    description: str = ""  # Definido dinamicamente no __init__
    args_schema: Type[BaseModel] = DelegateToSubagentInput

    # Configuração injetada no __init__
    available_subagents: Dict[str, Dict[str, Any]] = {}
    company_id: str = ""
    company_config: Dict[str, Any] = {}
    supabase_client: Any = None

    class Config:
        arbitrary_types_allowed = True

    def __init__(
        self,
        available_subagents: Dict[str, Dict[str, Any]],
        company_id: str,
        company_config: Dict[str, Any],
        supabase_client: Any = None,
        **kwargs,
    ):
        """
        Args:
            available_subagents: Dict de {subagent_id: delegation_config}
                Cada delegation_config contém:
                - subagent_data: dict com config do agente (llm_model, system_prompt, etc)
                - task_description: string descrevendo especialidade
                - max_context_chars: int (default 2000)
                - timeout_seconds: int (default 30)
                - max_iterations: int (default 5)
            company_id: ID da empresa (multi-tenant)
            company_config: Config da empresa (provider, api_key, etc)
            supabase_client: Supabase client (para carregar HTTP tools do banco)
        """
        super().__init__(**kwargs)
        self.available_subagents = available_subagents
        self.company_id = company_id
        self.company_config = company_config
        self.supabase_client = supabase_client

        # Gerar description dinâmica com lista de especialistas
        specialists_desc = []
        for sub_id, sub_config in available_subagents.items():
            name = sub_config.get("subagent_data", {}).get("name", "Specialist")
            task = sub_config.get("task_description", "Tarefas especializadas")
            specialists_desc.append(f"  - {name} (ID: {sub_id}): {task}")

        specialists_list = "\n".join(specialists_desc)
        self.description = (
            "Delega uma tarefa para um subagente especialista. "
            "Use quando a tarefa exige conhecimento especializado que "
            "vai além do seu escopo direto.\n\n"
            "Especialistas disponíveis:\n"
            f"{specialists_list}"
        )

        logger.info(
            f"[SubAgent Tool] Inicializada com {len(available_subagents)} especialistas "
            f"para company={company_id}"
        )

    # =========================================================
    # Async Execution (preferred — runs in FastAPI's event loop)
    # =========================================================
    async def _arun(
        self,
        task_description: str,
        subagent_id: str,
        context: str = "",
        user_id: str = "",
        session_id: str = "",
        **kwargs,
    ) -> str:
        """
        Execução assíncrona — roda no MESMO event loop do FastAPI/LangGraph.
        Evita o bug 'bound to a different event loop' que ocorre sob carga
        quando ThreadPoolExecutor + new_event_loop mistura loops.

        LangGraph prefere _arun quando disponível.
        """
        if subagent_id not in self.available_subagents:
            return json.dumps({
                "response": f"Especialista '{subagent_id}' não encontrado. "
                            f"Disponíveis: {list(self.available_subagents.keys())}",
                "tokens_used": {"input": 0, "output": 0, "total": 0},
                "tools_used": [],
                "steps_log": {
                    "subagent_id": subagent_id,
                    "status": "error",
                    "error": "subagent_not_found"
                },
            }, ensure_ascii=False)

        delegation_config = self.available_subagents[subagent_id]
        timeout = delegation_config.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)

        try:
            return await asyncio.wait_for(
                self._run_react_loop(
                    task_description=task_description,
                    subagent_id=subagent_id,
                    context=context,
                    delegation_config=delegation_config,
                    user_id=user_id,
                    session_id=session_id,
                ),
                timeout=timeout,
            )

        except asyncio.TimeoutError:
            logger.warning(
                f"[SubAgent] ⏰ Timeout ({timeout}s) para subagent={subagent_id}"
            )
            return json.dumps({
                "response": "O especialista demorou demais para responder. "
                            "Por favor, tente reformular sua pergunta.",
                "tokens_used": {"input": 0, "output": 0, "total": 0},
                "tools_used": [],
                "steps_log": {
                    "subagent_id": subagent_id,
                    "status": "timeout",
                    "timeout_seconds": timeout,
                },
            }, ensure_ascii=False)

        except Exception as e:
            logger.error(f"[SubAgent] ❌ Erro _arun: {e}", exc_info=True)
            return json.dumps({
                "response": "Erro interno ao consultar especialista. A operação não pôde ser concluída.",
                "tokens_used": {"input": 0, "output": 0, "total": 0},
                "tools_used": [],
                "steps_log": {
                    "subagent_id": subagent_id,
                    "status": "error",
                    "error": str(e),
                },
            }, ensure_ascii=False)

    # =========================================================
    # Sync Fallback (only if called from non-async context)
    # =========================================================
    def _run(
        self,
        task_description: str,
        subagent_id: str,
        context: str = "",
        user_id: str = "",
        session_id: str = "",
        **kwargs,
    ) -> str:
        """
        Fallback síncrono — só usado se chamado de contexto não-async.
        Usa ThreadPoolExecutor + new_event_loop (pode dar bug de loop sob carga).
        Prefira _arun via LangGraph.
        """
        if subagent_id not in self.available_subagents:
            return json.dumps({
                "response": f"Especialista '{subagent_id}' não encontrado. "
                            f"Disponíveis: {list(self.available_subagents.keys())}",
                "tokens_used": {"input": 0, "output": 0, "total": 0},
                "tools_used": [],
                "steps_log": {
                    "subagent_id": subagent_id,
                    "status": "error",
                    "error": "subagent_not_found"
                },
            }, ensure_ascii=False)

        delegation_config = self.available_subagents[subagent_id]
        timeout = delegation_config.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    self._run_in_new_loop,
                    task_description=task_description,
                    subagent_id=subagent_id,
                    context=context,
                    delegation_config=delegation_config,
                    user_id=user_id,
                    session_id=session_id,
                )
                return future.result(timeout=timeout)

        except concurrent.futures.TimeoutError:
            logger.warning(
                f"[SubAgent] ⏰ Timeout ({timeout}s) para subagent={subagent_id}"
            )
            return json.dumps({
                "response": "O especialista demorou demais para responder. "
                            "Por favor, tente reformular sua pergunta.",
                "tokens_used": {"input": 0, "output": 0, "total": 0},
                "tools_used": [],
                "steps_log": {
                    "subagent_id": subagent_id,
                    "status": "timeout",
                    "timeout_seconds": timeout,
                },
            }, ensure_ascii=False)

        except Exception as e:
            logger.error(f"[SubAgent] ❌ Erro Thread: {e}", exc_info=True)
            return json.dumps({
                "response": "Erro interno ao consultar especialista. A operação não pôde ser concluída.",
                "tokens_used": {"input": 0, "output": 0, "total": 0},
                "tools_used": [],
                "steps_log": {
                    "subagent_id": subagent_id,
                    "status": "error",
                    "error": str(e),
                },
            }, ensure_ascii=False)

    def _run_in_new_loop(self, **kwargs) -> str:
        """Executa em novo event loop (fallback sync)."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._run_react_loop(**kwargs))
        finally:
            loop.close()

    # =========================================================
    # ReAct Loop (Async)
    # =========================================================
    async def _run_react_loop(
        self,
        task_description: str,
        subagent_id: str,
        context: str,
        delegation_config: Dict[str, Any],
        user_id: str = "",
        session_id: str = "",
    ) -> str:
        """
        Loop ReAct assíncrono — cria LLM, bind tools, executa iterações.

        Returns:
            JSON string com {response, tokens_used, tools_used, steps_log}
        """
        start_time = time.time()
        subagent_data = delegation_config.get("subagent_data", {})
        max_iterations = delegation_config.get("max_iterations", DEFAULT_MAX_ITERATIONS)

        subagent_name = subagent_data.get("agent_name", "Specialist")
        logger.info(
            f"[SubAgent] 🚀 Iniciando '{subagent_name}' | "
            f"task='{task_description[:80]}' | max_iter={max_iterations}"
        )

        # Tracking
        total_input_tokens = 0
        total_output_tokens = 0
        tools_used = []
        steps = []
        rag_chunks = []  # RAG chunks para logging
        search_strategy = None
        retrieval_score = None

        try:
            # === 1. Criar LLM do SubAgent ===
            from app.factories.llm_factory import LLMFactory

            llm = LLMFactory.create_llm(
                company_config=self.company_config,
                agent_data=subagent_data,
                api_key=self._resolve_api_key(subagent_data),
                company_id=self.company_id,
                agent_id=subagent_id,  # CostCallback usa este ID
            )

            # === 2. Montar Tools do SubAgent ===
            subagent_tools = self._build_subagent_tools(subagent_data, subagent_id)

            if subagent_tools:
                llm_with_tools = llm.bind_tools(subagent_tools)
                tool_map = {t.name: t for t in subagent_tools}
            else:
                llm_with_tools = llm
                tool_map = {}

            # === 3. Montar mensagens iniciais ===
            system_prompt = subagent_data.get(
                "agent_system_prompt",
                f"Você é um especialista. Responda de forma concisa e precisa."
            )
            # Instruir SubAgent a NÃO retornar JSON cru para carrosséis
            system_prompt += (
                "\n\nIMPORTANTE: Você é um subagente. Suas respostas serão processadas "
                "por um agente orquestrador antes de chegar ao usuário. "
                "Responda SEMPRE em texto claro e estruturado, NUNCA retorne JSON cru."
            )

            messages: list = [
                SystemMessage(content=system_prompt),
            ]

            # Injetar contexto se disponível
            task_msg = f"Tarefa: {task_description}"
            if context:
                task_msg = f"Contexto:\n{context}\n\n{task_msg}"
            messages.append(HumanMessage(content=task_msg))

            # === 4. ReAct Loop ===
            for iteration in range(1, max_iterations + 1):
                logger.info(f"[SubAgent] 🔄 Iteração {iteration}/{max_iterations}")
                steps.append({"type": "llm_call", "iteration": iteration})

                # Invocar LLM
                response = await llm_with_tools.ainvoke(messages)
                messages.append(response)

                # Extrair tokens (se disponível via usage_metadata)
                usage_meta = getattr(response, "usage_metadata", None)
                if usage_meta:
                    iter_input = usage_meta.get("input_tokens", 0)
                    iter_output = usage_meta.get("output_tokens", 0)
                    total_input_tokens += iter_input
                    total_output_tokens += iter_output

                # Sem tool calls → resposta final
                if not getattr(response, "tool_calls", None):
                    final_text = self._extract_text(response.content)
                    steps.append({
                        "type": "final_response",
                        "iteration": iteration,
                        "length": len(final_text),
                    })
                    logger.info(
                        f"[SubAgent] ✅ '{subagent_name}' respondeu em {iteration} iterações | "
                        f"{len(final_text)} chars"
                    )
                    break

                # Executar tool calls
                for tc in response.tool_calls:
                    tc_name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
                    tc_args = tc.get("args", {}) if isinstance(tc, dict) else getattr(tc, "args", {})
                    tc_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)

                    logger.info(f"[SubAgent] 🔧 Tool call: {tc_name}")
                    steps.append({
                        "type": "tool_call",
                        "tool": tc_name,
                        "args_keys": list(tc_args.keys()),
                    })

                    if tc_name in tool_map:
                        tool = tool_map[tc_name]
                        try:
                            # Injetar agent_id para KnowledgeBaseTool
                            if tc_name == "knowledge_base_search":
                                tc_args = {**tc_args, "agent_id": subagent_id}

                            # Tenta _arun (async) se disponível, senão _run via executor
                            # _run_react_loop é SEMPRE async, então get_running_loop() é seguro
                            if hasattr(tool, '_arun'):
                                try:
                                    result = await tool._arun(**tc_args)
                                except NotImplementedError:
                                    result = await asyncio.get_running_loop().run_in_executor(
                                        None, lambda t=tool, a=tc_args: t._run(**a)
                                    )
                            else:
                                result = await asyncio.get_running_loop().run_in_executor(
                                    None, lambda t=tool, a=tc_args: t._run(**a)
                                )
                            tools_used.append(tc_name)

                            # Capturar RAG chunks e metadata do knowledge_base_search
                            if tc_name == "knowledge_base_search" and isinstance(result, dict):
                                if result.get("chunks"):
                                    rag_chunks.extend(result["chunks"])
                                if result.get("strategy"):
                                    search_strategy = result["strategy"]
                                if result.get("max_score") is not None:
                                    retrieval_score = float(result["max_score"])

                            # Extrair info para steps_log
                            result_preview = str(result)[:200] if result else ""
                            steps.append({
                                "type": "tool_result",
                                "tool": tc_name,
                                "success": True,
                                "result_preview": result_preview,
                            })

                        except Exception as tool_err:
                            logger.error(f"[SubAgent] Tool error {tc_name}: {tool_err}")
                            result = "Erro interno na ferramenta. A operação não pôde ser concluída."
                            steps.append({
                                "type": "tool_result",
                                "tool": tc_name,
                                "success": False,
                                "error": str(tool_err),
                            })
                    else:
                        result = f"Ferramenta '{tc_name}' não disponível."
                        steps.append({
                            "type": "tool_result",
                            "tool": tc_name,
                            "success": False,
                            "error": "tool_not_found",
                        })

                    messages.append(ToolMessage(
                        content=str(result),
                        tool_call_id=tc_id or f"tc_{iteration}",
                        name=tc_name or "unknown",
                    ))

            else:
                # Loop esgotou iterações sem resposta final
                final_text = self._extract_text(messages[-1].content) if messages else ""
                if not final_text:
                    final_text = "O especialista não conseguiu concluir a análise no tempo disponível."
                steps.append({"type": "max_iterations_reached"})
                logger.warning(
                    f"[SubAgent] ⚠️ '{subagent_name}' atingiu {max_iterations} iterações"
                )

            latency_ms = int((time.time() - start_time) * 1000)

            # Salvar log separado do SubAgent no conversation_logs
            # Via executor para não bloquear event loop (insert sync no Supabase)
            await asyncio.get_running_loop().run_in_executor(
                None,
                lambda: self._save_subagent_log(
                    subagent_id=subagent_id,
                    subagent_data=subagent_data,
                    user_id=user_id,
                    session_id=session_id,
                    task_description=task_description,
                    final_response=final_text,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    tools_used=tools_used,
                    rag_chunks=rag_chunks,
                    latency_ms=latency_ms,
                    search_strategy=search_strategy,
                    retrieval_score=retrieval_score,
                    status="success",
                ),
            )

            return json.dumps({
                "response": final_text,
                "tokens_used": {
                    "input": total_input_tokens,
                    "output": total_output_tokens,
                    "total": total_input_tokens + total_output_tokens,
                },
                "tools_used": tools_used,
                "steps_log": {
                    "subagent_id": subagent_id,
                    "subagent_name": subagent_name,
                    "task": task_description,
                    "steps": steps,
                    "tokens_used": {
                        "input": total_input_tokens,
                        "output": total_output_tokens,
                        "total": total_input_tokens + total_output_tokens,
                    },
                    "latency_ms": latency_ms,
                    "status": "success",
                },
            }, ensure_ascii=False)

        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            logger.error(f"[SubAgent] ❌ Erro no ReAct loop: {e}", exc_info=True)

            # Salvar log com status error (via executor para não bloquear)
            await asyncio.get_running_loop().run_in_executor(
                None,
                lambda: self._save_subagent_log(
                    subagent_id=subagent_id,
                    subagent_data=subagent_data,
                    user_id=user_id,
                    session_id=session_id,
                    task_description=task_description,
                    final_response=f"Erro: {str(e)}",
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    tools_used=tools_used,
                    rag_chunks=rag_chunks,
                    latency_ms=latency_ms,
                    search_strategy=search_strategy,
                    retrieval_score=retrieval_score,
                    status="error",
                ),
            )

            return json.dumps({
                "response": "Erro interno ao consultar especialista. A operação não pôde ser concluída.",
                "tokens_used": {
                    "input": total_input_tokens,
                    "output": total_output_tokens,
                    "total": total_input_tokens + total_output_tokens,
                },
                "tools_used": tools_used,
                "steps_log": {
                    "subagent_id": subagent_id,
                    "subagent_name": subagent_name,
                    "task": task_description,
                    "steps": steps,
                    "tokens_used": {
                        "input": total_input_tokens,
                        "output": total_output_tokens,
                        "total": total_input_tokens + total_output_tokens,
                    },
                    "latency_ms": latency_ms,
                    "status": "error",
                    "error": str(e),
                },
            }, ensure_ascii=False)

    # =========================================================
    # Helpers
    # =========================================================
    def _resolve_api_key(self, subagent_data: dict) -> str:
        """
        Resolve API key usando o padrão do projeto (os.getenv via get_api_key_for_provider).
        """
        from app.core.utils import get_api_key_for_provider
        provider = subagent_data.get("llm_provider") or "openai"
        return get_api_key_for_provider(provider)

    def _save_subagent_log(
        self,
        subagent_id: str,
        subagent_data: dict,
        user_id: str,
        session_id: str,
        task_description: str,
        final_response: str,
        total_input_tokens: int,
        total_output_tokens: int,
        tools_used: list,
        rag_chunks: list,
        latency_ms: int,
        search_strategy: str | None = None,
        retrieval_score: float | None = None,
        status: str = "success",
    ):
        """
        Salva log do SubAgent na tabela conversation_logs — mesma estrutura do log_node.
        Executa dentro do ThreadPoolExecutor (IO-bound, não bloqueia orquestrador).
        """
        if not self.supabase_client:
            logger.warning("[SubAgent Log] ⚠️ Sem supabase_client, skip log")
            return

        try:
            # Provider/model do SubAgent (Priority: Agent > Company > Default)
            llm_provider = (
                subagent_data.get("llm_provider")
                or self.company_config.get("llm_provider")
                or "openai"
            )
            llm_model = (
                subagent_data.get("llm_model")
                or self.company_config.get("llm_model")
                or "gpt-4-turbo"
            )
            llm_temperature = (
                subagent_data.get("llm_temperature")
                or self.company_config.get("llm_temperature")
                or 0.7
            )

            log_data = {
                "company_id": self.company_id,
                "user_id": user_id or None,
                "session_id": session_id or None,
                "agent_id": subagent_id,
                "user_question": task_description,
                "assistant_response": str(final_response),
                "rag_chunks": rag_chunks,
                "rag_chunks_count": len(rag_chunks),
                "tokens_input": total_input_tokens,
                "tokens_output": total_output_tokens,
                "tokens_total": total_input_tokens + total_output_tokens,
                "llm_provider": llm_provider,
                "llm_model": llm_model,
                "llm_temperature": float(llm_temperature),
                "response_time_ms": latency_ms,
                "rag_search_time_ms": 0,
                "search_strategy": search_strategy,
                "retrieval_score": retrieval_score,
                "status": status,
            }

            real_client = getattr(self.supabase_client, 'client', self.supabase_client)
            real_client.table("conversation_logs").insert(log_data).execute()
            logger.info(
                f"[SubAgent Log] ✅ conversation_log salvo para subagent={subagent_id} | "
                f"tokens={total_input_tokens + total_output_tokens} | "
                f"rag_chunks={len(rag_chunks)}"
            )

        except Exception as e:
            logger.error(f"[SubAgent Log] ❌ Erro ao salvar log: {e}")

    def _build_subagent_tools(
        self,
        subagent_data: dict,
        subagent_id: str,
    ) -> List[BaseTool]:
        """
        Instancia tools para o SubAgent.
        Reutiliza as mesmas classes/singletons do agente principal.

        EXCLUI: UCP/Storefront (carrossel), HumanHandoff, vision tools.
        """
        tools: List[BaseTool] = []

        try:
            # === Knowledge Base (RAG) ===
            # KB é SEMPRE disponibilizada (mesmo sem collection_name explícito),
            # seguindo o padrão do graph.py principal (linhas 202-206).
            # O KnowledgeBaseTool busca na collection da empresa automaticamente.
            from .knowledge_base import KnowledgeBaseTool

            collection_name = subagent_data.get("collection_name")
            kb_tool = KnowledgeBaseTool(
                company_id=self.company_id,
                agent_id=subagent_id,
                collection_name=collection_name,
            )
            tools.append(kb_tool)
            logger.info(f"[SubAgent Tools] ✅ KnowledgeBase para {subagent_id}")

            # === Web Search ===
            # Usa flag real do model AgentBase: allow_web_search
            if subagent_data.get("allow_web_search", False):
                from .web_search import WebSearchTool

                tools.append(WebSearchTool())
                logger.info(f"[SubAgent Tools] ✅ WebSearch para {subagent_id}")

            # === MCP Tools ===
            # Carrega MCP tools do banco (tabela agent_mcp_tools)
            if self.supabase_client:
                try:
                    real_client = getattr(self.supabase_client, 'client', self.supabase_client)
                    mcp_response = (
                        real_client.table("agent_mcp_tools")
                        .select("*")
                        .eq("agent_id", subagent_id)
                        .eq("is_enabled", True)
                        .execute()
                    )
                    if mcp_response.data:
                        from .mcp_factory import MCPToolFactory

                        mcp_tools = MCPToolFactory.create_tools_for_agent(
                            agent_id=subagent_id,
                            mcp_tools_config=mcp_response.data,
                        )
                        if mcp_tools:
                            tools.extend(mcp_tools)
                            logger.info(f"[SubAgent Tools] ✅ {len(mcp_tools)} MCP tools para {subagent_id}")
                except Exception as mcp_err:
                    logger.warning(f"[SubAgent Tools] ⚠️ Erro ao carregar MCP tools: {mcp_err}")

            # === HTTP Tools ===
            # Carrega HttpToolRouter do banco (mesmo padrão do graph.py)
            if self.supabase_client:
                from .http_request import HttpToolRouter

                real_client = getattr(self.supabase_client, 'client', self.supabase_client)
                http_router = HttpToolRouter(
                    agent_id=subagent_id,
                    supabase_client=real_client,
                )
                tools.append(http_router)
                logger.info(f"[SubAgent Tools] ✅ HttpToolRouter para {subagent_id}")

            # === CSV Analytics ===
            if subagent_data.get("tools_config", {}).get("csv_analytics", {}).get("enabled", False):
                from .csv_analytics_tool import CSVAnalyticsTool

                tools.append(CSVAnalyticsTool(
                    company_id=self.company_id,
                    agent_id=subagent_id,
                ))
                logger.info(f"[SubAgent Tools] ✅ CSVAnalytics para {subagent_id}")

        except Exception as e:
            logger.error(f"[SubAgent Tools] Erro ao montar tools: {e}", exc_info=True)

        # Filtrar tools excluídas por segurança
        tools = [t for t in tools if t.name not in EXCLUDED_TOOL_TYPES]

        logger.info(
            f"[SubAgent Tools] Total: {len(tools)} tools para subagent={subagent_id}"
        )
        return tools

    def _extract_text(self, content) -> str:
        """Extrai texto limpo do content (pode ser string ou lista de blocos)."""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    text_parts.append(block)
            return "".join(text_parts)
        return str(content) if content else ""
