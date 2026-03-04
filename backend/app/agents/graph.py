"""
Grafo do Agente LangGraph.
Monta o StateGraph com os nós e arestas.
"""

import asyncio
import json
import logging
from datetime import datetime
from functools import partial
from typing import Any, Dict, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from app.core.prompts import (
    build_composite_prompt,
    expand_http_tool_variables,
    expand_mcp_tool_variables,
    expand_subagent_variables,
)
from app.core.utils import get_api_key_for_provider
from app.factories.llm_factory import LLMFactory
from app.services.agent_service import AgentService
from app.services.memory_service import MemoryService

from .nodes import agent_node, log_node, should_continue, tool_node
from .state import AgentState
from .tools import HumanHandoffTool, KnowledgeBaseTool, MCPToolFactory, WebSearchTool

logger = logging.getLogger(__name__)

# === ASYNC POOL SINGLETON ===
# Pool is created once and reused. Checkpointer instances are lightweight.
_async_postgres_pool = None
_checkpointer_init_attempted = False


async def get_async_postgres_checkpointer():
    """
    Returns an AsyncPostgresSaver using a global AsyncConnectionPool.

    CRITICAL: Uses prepare_threshold=None for Supabase PgBouncer compatibility.
    The pool is opened lazily on first use.
    """
    global _async_postgres_pool, _checkpointer_init_attempted

    from langgraph.checkpoint.memory import MemorySaver

    from app.core import settings

    db_url = settings.SUPABASE_DB_URL

    if not db_url:
        logger.warning("[Checkpoint] DB_URL ausente, usando MemorySaver")
        return MemorySaver()

    # Check pool health
    if _async_postgres_pool is not None:
        try:
            if hasattr(_async_postgres_pool, "closed") and _async_postgres_pool.closed:
                logger.warning("[Checkpoint] Async pool encontrado FECHADO. Descartando...")
                _async_postgres_pool = None
                _checkpointer_init_attempted = False
        except Exception:
            logger.warning("[Checkpoint] Async pool em estado inconsistente. Descartando...")
            _async_postgres_pool = None
            _checkpointer_init_attempted = False

    # Create pool if needed
    if _async_postgres_pool is None:
        if _checkpointer_init_attempted:
            logger.debug("[Checkpoint] Init já tentado anteriormente, retornando MemorySaver")
            return MemorySaver()

        _checkpointer_init_attempted = True

        try:
            from psycopg.rows import dict_row
            from psycopg_pool import AsyncConnectionPool

            # CRÍTICO: prepare_threshold=None para Supabase Transaction Mode (PgBouncer)
            connection_kwargs = {
                "autocommit": True,
                "prepare_threshold": None,  # OBRIGATÓRIO para PgBouncer
                "row_factory": dict_row,
            }

            logger.info("[Checkpoint] 🔌 Criando novo AsyncConnectionPool...")
            _async_postgres_pool = AsyncConnectionPool(
                conninfo=db_url,
                min_size=5,
                max_size=20,
                max_lifetime=300,  # Recicla conexões após 5 min para evitar SSL EOF do servidor
                max_idle=60,       # Fecha conexões ociosas após 1 min
                open=False,  # Abrimos explicitamente abaixo
                kwargs=connection_kwargs,
                check=AsyncConnectionPool.check_connection,  # 🔒 Testa conexões antes de entregar
            )

            # Open the pool
            await _async_postgres_pool.open()
            logger.info("[Checkpoint] ✅ AsyncConnectionPool aberto (min=5, max=20)")

        except Exception as e:
            # Log seguro: Mostra o tipo do erro mas esconde os detalhes que podem ter a senha
            logger.error(f"[Checkpoint] ❌ Erro fatal ao criar AsyncPool: {type(e).__name__}")
            _async_postgres_pool = None
            return MemorySaver()

    # Create and setup the async saver
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        checkpointer = AsyncPostgresSaver(_async_postgres_pool)

        # Setup tables (idempotent - IF NOT EXISTS)
        await checkpointer.setup()

        return checkpointer

    except Exception as e:
        logger.error(f"[Checkpoint] Erro ao instanciar AsyncPostgresSaver: {e}")
        return MemorySaver()


async def close_async_postgres_pool():
    """
    Fecha o pool de conexões async e limpa referências globais.
    """
    global _async_postgres_pool, _checkpointer_init_attempted

    if _async_postgres_pool:
        try:
            await _async_postgres_pool.close()
            logger.info("[Checkpoint] AsyncConnectionPool fechado com sucesso")
        except Exception as e:
            logger.error(f"[Checkpoint] Erro ao fechar async pool: {e}")
        finally:
            _async_postgres_pool = None
            _checkpointer_init_attempted = False
  # Permite recriação imediata





# Removed in favor of LLMFactory


async def create_agent_graph(
    company_config: Dict[str, Any],
    api_key: str,
    qdrant_service,
    supabase_client,
    company_id: str,
    agent_data: Optional[Dict[str, Any]] = None,
    enable_logging: bool = True,
):
    """
    Cria o grafo do agente com as tools configuradas (ASYNC).

    Args:
        company_config: Configuração da empresa (provider, model, etc)
        api_key: API key descriptografada do LLM
        qdrant_service: Instância do QdrantService para RAG
        supabase_client: Cliente Supabase para logging
        company_id: ID da empresa (para RAG)
        enable_logging: Se deve salvar logs no final

    Returns:
        Grafo compilado pronto para .ainvoke() ou .astream_events()
    """
    logger.info(f"[Graph] Criando grafo async para company {company_id}")

    # Get agent_id early for cost tracking
    agent_id = agent_data.get("id") if agent_data else None

    # === 1. Identificar Provider e Key (Correção 401 Anthropic) ===
    # 1. Identificar qual provedor o Agente está configurado para usar
    # (Default para openai se não definido)
    provider = "openai"
    if agent_data and agent_data.get("llm_provider"):
        provider = agent_data.get("llm_provider")
    elif company_config.get("llm_provider"):
        provider = company_config.get("llm_provider")

    # === SELEÇÃO DE CHAVE: FORÇAR USO DE VARIÁVEL DE AMBIENTE ===
    selected_api_key = get_api_key_for_provider(provider)

    # 3. Criar o LLM do Agente com a chave correta
    llm = LLMFactory.create_llm(
        company_config=company_config,
        agent_data=agent_data,
        api_key=selected_api_key, # <--- Usando a chave selecionada
        company_id=company_id,
        agent_id=agent_id
    )

    # === 2. Cria as Tools ===
    # agent_id já foi definido acima
    collection_name = agent_data.get("collection_name") if agent_data else None

    kb_tool = KnowledgeBaseTool(
        company_id=company_id, agent_id=agent_id, collection_name=collection_name
    )

    # Web Search Tool (Tavily) - Controlado por flag do agente ou da empresa
    allow_web_search = False
    if agent_data:
        allow_web_search = agent_data.get("allow_web_search", False)
    else:
        allow_web_search = company_config.get("allow_web_search", False)

    web_search_tool = WebSearchTool() if allow_web_search else None

    # Human Handoff Tool - Controlado por tools_config do agente
    tools_config = agent_data.get("tools_config", {}) if agent_data else {}
    allow_human_handoff = tools_config.get("human_handoff", {}).get("enabled", False)

    # Unwrap para pegar o client real (tools usam .table() diretamente)
    real_supabase_client = getattr(supabase_client, 'client', supabase_client) if supabase_client else None

    human_handoff_tool = (
        HumanHandoffTool(supabase_client=real_supabase_client)
        if allow_human_handoff and real_supabase_client
        else None
    )

    if allow_human_handoff:
        logger.info(f"[Graph] 🔔 HumanHandoffTool habilitada para agente {agent_id}")

    # CSV Analytics Tool - Controlado por tools_config do agente
    from .tools.csv_analytics_tool import CSVAnalyticsTool

    csv_analytics_enabled = tools_config.get("csv_analytics", {}).get("enabled", False)
    csv_analytics_tool = CSVAnalyticsTool(company_id=company_id, agent_id=agent_id) if csv_analytics_enabled else None

    if csv_analytics_enabled:
        logger.info(f"[Graph] 📊 CSVAnalyticsTool habilitada para agente {agent_id}")

    # Lista de tools disponíveis
    tools = [kb_tool]
    if web_search_tool:
        tools.append(web_search_tool)
    if human_handoff_tool:
        tools.append(human_handoff_tool)
    if csv_analytics_tool:
        tools.append(csv_analytics_tool)

    # === HTTP TOOL ROUTER ===
    from .tools.http_request import HttpToolRouter

    raw_id = agent_data.get("id") if agent_data else None
    dynamic_agent_id = str(raw_id) if raw_id else None

    if dynamic_agent_id and supabase_client:
        # Unwrap para pegar o client real (HttpToolRouter usa .table() diretamente)
        real_client = getattr(supabase_client, 'client', supabase_client)
        http_router = HttpToolRouter(
            agent_id=dynamic_agent_id, supabase_client=real_client
        )
        tools.append(http_router)
        logger.info(
            f"[Graph] ✅ HttpToolRouter adicionado para agente {dynamic_agent_id}"
        )

    # === MCP TOOLS (Dinâmicas) ===
    if agent_id and supabase_client:
        try:
            from ..services.mcp_gateway_service import get_mcp_gateway

            gateway = get_mcp_gateway()
            mcp_tools_config = await gateway.get_agent_mcp_tools(str(agent_id))

            if mcp_tools_config:
                mcp_tools = MCPToolFactory.create_tools_for_agent(
                    agent_id=str(agent_id),
                    mcp_tools_config=mcp_tools_config
                )

                if mcp_tools:
                    tools.extend(mcp_tools)
                    logger.info(
                        f"[Graph] ✅ {len(mcp_tools)} MCP tools criadas: "
                        f"{[t.name for t in mcp_tools]}"
                    )
        except Exception as e:
            logger.error(f"[Graph] Erro ao criar MCP tools: {e}")

    # === UCP TOOLS (Commerce - Dinâmicas) ===
    if agent_id and supabase_client:
        try:
            from .tools.ucp_factory import UCPToolFactory

            # Factory agora carrega conexões internamente (async)
            ucp_tools = await UCPToolFactory.create_tools_for_agent(str(agent_id))

            if ucp_tools:
                tools.extend(ucp_tools)
                logger.info(
                    f"[Graph] ✅ {len(ucp_tools)} UCP tools criadas: "
                    f"{[t.name for t in ucp_tools]}"
                )
        except Exception as e:
            logger.error(f"[Graph] Erro ao criar UCP tools: {e}")

    # === SUBAGENT DELEGATION TOOLS ===
    if agent_id and supabase_client:
        logger.info(f"[Graph] 🔍 Buscando delegações para orchestrator {agent_id}...")
        try:
            from .tools.subagent_tool import SubAgentTool

            real_client = getattr(supabase_client, 'client', supabase_client)
            delegations_response = (
                real_client.table("agent_delegations")
                .select("subagent_id, task_description, max_context_chars, timeout_seconds, max_iterations")
                .eq("orchestrator_id", str(agent_id))
                .eq("is_active", True)
                .execute()
            )

            if delegations_response.data:
                # Carregar dados dos subagentes vinculados
                available_subagents = {}
                for delegation in delegations_response.data:
                    sub_id = delegation["subagent_id"]
                    try:
                        sub_response = (
                            real_client.table("agents")
                            .select("*")
                            .eq("id", sub_id)
                            .single()
                            .execute()
                        )
                        if sub_response.data:
                            available_subagents[sub_id] = {
                                "subagent_data": sub_response.data,
                                "task_description": delegation["task_description"],
                                "max_context_chars": delegation.get("max_context_chars", 2000),
                                "timeout_seconds": delegation.get("timeout_seconds", 30),
                                "max_iterations": delegation.get("max_iterations", 5),
                            }
                    except Exception as sub_err:
                        logger.error(f"[Graph] Erro ao carregar subagent {sub_id}: {sub_err}")

                if available_subagents:
                    subagent_tool = SubAgentTool(
                        available_subagents=available_subagents,
                        company_id=str(company_id),
                        company_config=company_config,
                        supabase_client=supabase_client,
                    )
                    tools.append(subagent_tool)
                    logger.info(
                        f"[Graph] 🤖 SubAgentTool criada com {len(available_subagents)} especialistas: "
                        f"{list(available_subagents.keys())}"
                    )
        except Exception as e:
            # Tabela pode não existir ainda (pré-migration)
            logger.warning(f"[Graph] ⚠️ SubAgent delegation ERRO: {e}")

    # Bind final (Standard + Dinâmicas)
    llm_with_tools = llm.bind_tools(tools)

    # === 3. Define os Nós ===
    agent_fn = partial(agent_node, llm_with_tools=llm_with_tools)
    tool_fn = partial(tool_node, tools=tools)
    log_fn = partial(log_node, supabase_client=supabase_client)

    # === 4. Monta o Grafo ===
    workflow = StateGraph(AgentState)

    workflow.add_node("agent", agent_fn)
    workflow.add_node("tools", tool_fn)

    if enable_logging:
        workflow.add_node("log", log_fn)

    # === 5. Define as Arestas ===
    workflow.add_edge(START, "agent")

    workflow.add_conditional_edges(
        "agent",
        should_continue,
        {"tools": "tools", "end": "log" if enable_logging else END},
    )

    workflow.add_edge("tools", "agent")

    if enable_logging:
        workflow.add_edge("log", END)

    # === 6. Compila com ASYNC Checkpointer ===
    checkpointer = await get_async_postgres_checkpointer()
    graph = workflow.compile(checkpointer=checkpointer)

    logger.info("[Graph] Grafo criado com sucesso (AsyncPostgresSaver ativo)")

    return graph


async def _build_initial_state(
    user_message: str,
    company_id: str,
    user_id: str,
    session_id: str,
    company_config: Dict[str, Any],
    options: Dict[str, Any] = None,
    supabase_client=None,
    agent_id: str = None,
) -> tuple:
    """
    Constrói o estado inicial.
    AUTH SIMPLIFICADA: Usa chaves globais do ambiente (.env).
    """
    # === 1. RECUPERAR DADOS DO AGENTE ===
    real_agent_data = None
    system_prompt_source = None

    if agent_id:
        try:
            agent_service = AgentService()
            # AgentService agora retorna objeto simples (sem chaves)
            agent_response = agent_service.get_agent_by_id(agent_id)

            if agent_response:
                real_agent_data = agent_response.model_dump()
                logger.info(f"[Graph] Agente carregado: {real_agent_data.get('name')}")

                system_prompt_source = real_agent_data.get("agent_system_prompt")
                pass  # llm_provider is used later by create_agent_graph, not here
        except Exception as e:
            logger.error(f"[Graph] Erro ao carregar agente: {e}")

    # NOTE: LLM creation removed - it was dead code.
    # The graph already creates its own LLM in create_agent_graph() with proper callbacks.
    # This function only builds the initial STATE, not the LLM.

    # === MEMORY SYSTEM V2 (ASYNC) ===
    memory_context = ""
    if supabase_client:
        try:
            real_client = supabase_client.client if hasattr(supabase_client, "client") else supabase_client
            memory_service = MemoryService(real_client)
            memory_context = await memory_service.build_memory_context_async(
                user_id=user_id,
                company_id=company_id,
                current_query=user_message,
                max_facts=10,
                max_summaries=3,
                agent_id=agent_id,
            )
            if memory_context:
                logger.info(f"[Memory] 🧠 Contexto carregado: {len(memory_context)} chars.")
        except Exception as e:
            logger.error(f"[Memory] ❌ Erro ao carregar contexto: {e}")

    # === PROMPT CONSTRUCTION ===
    base_instructions = (
        system_prompt_source
        or company_config.get("agent_instructions")
        or "Seja um assistente útil."
    )

    # === HTTP TOOLS ===
    allowed_http_tools = []
    if agent_id and supabase_client:
        try:
            real_client = supabase_client.client if hasattr(supabase_client, "client") else supabase_client
            response = (
                real_client.table("agent_http_tools")
                .select("name, description, method, parameters")
                .eq("agent_id", str(agent_id))
                .eq("is_active", True)
                .execute()
            )
            http_tools = response.data or []
            if http_tools:
                base_instructions, allowed_http_tools = expand_http_tool_variables(
                    base_instructions, http_tools
                )
        except Exception:
            pass

    # === MCP TOOLS ===
    allowed_mcp_tools = []
    if agent_id and supabase_client:
        try:
            from ..services.mcp_gateway_service import get_mcp_gateway
            gateway = get_mcp_gateway()
            mcp_tools = await gateway.get_agent_mcp_tools(str(agent_id))

            if mcp_tools:
                base_instructions, allowed_mcp_tools = expand_mcp_tool_variables(
                    base_instructions, mcp_tools
                )
                logger.info(f"[Graph] MCP tools mencionadas no prompt: {allowed_mcp_tools}")
        except Exception as e:
            logger.error(f"[Graph] Erro ao carregar MCP tools: {e}")

    # === SUBAGENT DELEGATION PROMPT EXPANSION ===
    # Otimizado: usa IN query para buscar todos os subagents de uma vez
    if agent_id and supabase_client:
        try:
            real_client = supabase_client.client if hasattr(supabase_client, "client") else supabase_client
            delegations_response = (
                real_client.table("agent_delegations")
                .select("subagent_id, task_description")
                .eq("orchestrator_id", str(agent_id))
                .eq("is_active", True)
                .execute()
            )
            if delegations_response.data:
                # Buscar TODOS os subagentes em uma única query (em vez de N queries individuais)
                sub_ids = [d["subagent_id"] for d in delegations_response.data]
                sub_agents_response = (
                    real_client.table("agents")
                    .select("id, name")
                    .in_("id", sub_ids)
                    .execute()
                )
                sub_agents_map = {
                    str(s["id"]): s for s in (sub_agents_response.data or [])
                }

                delegations_with_data = []
                for d in delegations_response.data:
                    sub_data = sub_agents_map.get(d["subagent_id"])
                    if sub_data:
                        delegations_with_data.append({
                            "subagent_data": sub_data,
                            "subagent_id": d["subagent_id"],
                            "task_description": d["task_description"],
                        })

                if delegations_with_data:
                    subagent_prompt = expand_subagent_variables(delegations_with_data)
                    base_instructions += subagent_prompt
                    logger.info(
                        f"[Graph] 🤖 Prompt expandido com {len(delegations_with_data)} especialistas"
                    )
        except Exception as e:
            logger.warning(f"[Graph] ⚠️ SubAgent prompt expansion ERRO: {e}")

    # === UCP INSTRUCTIONS ===
    # Verifica se o agente tem UCP ativo e injeta as regras
    if agent_id and supabase_client:
        try:
            real_client = supabase_client.client if hasattr(supabase_client, "client") else supabase_client
            # Check for active UCP connections
            response = (
                real_client.table("ucp_connections")
                .select("id")
                .eq("agent_id", str(agent_id))
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            if response.data:
                 base_instructions += '''

## 🛒 SISTEMA DE COMMERCE (UCP)

Você tem ferramentas de e-commerce que retornam JSON estruturado (type: 'ucp_product_list' etc).

### REGRAS OBRIGATÓRIAS PARA PRODUTOS:

1. **NUNCA DESCREVA PRODUTOS EM TEXTO**
   - ❌ ERRADO: "Encontrei uma camiseta por R$49,90..."
   - ✅ CERTO: Copiar o JSON da ferramenta

2. **COPIE O JSON EXATAMENTE** como recebido da ferramenta da mesmíssima forma.

3. **NÃO USE** bullet points, numeração ou Markdown para listar produtos.

4. **NÃO COLOQUE** o JSON em code blocks (```).

### FORMATO CORRETO DA RESPOSTA:

Encontrei alguns produtos:

{"type": "ucp_product_list", "provider": "storefront_mcp", "products": [...]}

### POR QUE ISSO É IMPORTANTE:

O Frontend tem um Carrossel visual que renderiza o JSON automaticamente.
Se você descrever em texto, o usuário VÊ UMA LISTA FEIA EM VEZ DO CARROSSEL BONITO.
'''
        except Exception as e:
            logger.error(f"[Graph] Error checking UCP instructions: {e}")

    # Prompt ESTÁTICO (instruções + tools) - será cacheado
    static_prompt = build_composite_prompt(base_instructions)

    # Prompt DINÂMICO (memória) - NÃO será cacheado
    dynamic_context = ""
    if memory_context:
        dynamic_context = f"\n\n=== 🧠 MEMÓRIA ===\n{memory_context}\n=== FIM DA MEMÓRIA ==="

    options = options or {}
    allow_web = False
    if real_agent_data:
        allow_web = real_agent_data.get("allow_web_search", False)
    else:
        allow_web = company_config.get("allow_web_search", False)

    if options.get("web_search") and not allow_web:
        options["web_search"] = False
    elif options.get("web_search"):
        dynamic_context += "\n\n🌐 MODO WEB ATIVO: Use a tool 'web_search'."

    # Prompt completo para uso geral
    composite_prompt = static_prompt + dynamic_context

    messages = [SystemMessage(content=composite_prompt), HumanMessage(content=user_message)]

    initial_state = {
        "messages": messages,
        "company_id": company_id,
        "user_id": user_id,
        "session_id": session_id,
        "company_config": company_config,
        "agent_data": real_agent_data,
        "system_prompt": composite_prompt,
        "static_prompt": static_prompt,      # 🔥 NEW: Parte cacheável
        "dynamic_context": dynamic_context,  # 🔥 NEW: Parte dinâmica
        "rag_context": "",
        "rag_chunks": [],
        "tools_used": [],
        "llm_response_time_ms": 0,
        "tokens_input": 0,
        "tokens_output": 0,
        "tokens_total": 0,
        "final_response": None,
        "allowed_http_tools": allowed_http_tools,
        "internal_steps": [],  # SubAgent delegation logs
    }

    config = {"configurable": {"thread_id": f"{company_id}:{session_id}"}}

    return initial_state, config, real_agent_data


async def invoke_agent(
    graph,
    user_message: str,
    company_id: str,
    user_id: str,
    session_id: str,
    company_config: Dict[str, Any],
    options: Dict[str, Any] = None,
    channel: str = "web",
    supabase_client=None,
    agent_id: str = None,
    async_supabase_client=None,  # NEW: AsyncClient for non-blocking memory operations
) -> Dict[str, Any]:
    """
    Execute the agent graph asynchronously.

    Uses _build_initial_state helper for state initialization,
    then runs graph.ainvoke() for async execution.
    """
    # Build state (now async)
    initial_state, config, real_agent_data = await _build_initial_state(
        user_message,
        company_id,
        user_id,
        session_id,
        company_config,
        options,
        supabase_client,
        agent_id,
    )

    # === LANGSMITH TRACING (Multi-Tenant) ===
    # Injeta metadados para isolamento por company/agent no dashboard
    from app.core.langsmith_setup import get_langsmith_config, is_langsmith_enabled

    if is_langsmith_enabled():
        ls_config = get_langsmith_config(
            company_id=company_id,
            agent_id=agent_id,
            user_id=user_id,
            session_id=session_id,
            channel=channel,
        )
        config["metadata"] = ls_config["metadata"]
        config["tags"] = ls_config["tags"]
        config["run_name"] = ls_config["run_name"]
        logger.debug(f"[LangSmith] Trace configurado: {ls_config['run_name']}")

    logger.info(
        f"[Agent] Invoking graph async for thread {config['configurable']['thread_id']} with agent {agent_id or 'DEFAULT'}"
    )

    # Execute graph asynchronously (now using AsyncPostgresSaver)
    result = await graph.ainvoke(initial_state, config)

    # Extrai resposta final
    final_response = result.get("final_response", "")
    logger.info(
        f"[Agent] final_response no state: {final_response[:100] if final_response else 'VAZIO'}"
    )

    # Se não veio no state, busca na última mensagem
    if not final_response:
        from langchain_core.messages import AIMessage

        for msg in reversed(result.get("messages", [])):
            logger.debug(
                f"[Agent] Checando mensagem: type={type(msg).__name__}, hasContent={hasattr(msg, 'content')}"
            )
            if isinstance(msg, AIMessage):
                content = getattr(msg, "content", None)
                if content:
                    # 🔥 FIX: Tratamento para conteúdo em lista (Reasoning Models)
                    # Modelos como o1, o3 e GPT-5 com reasoning retornam lista de blocos
                    if isinstance(content, list):
                        text_parts = []
                        for block in content:
                            # Pega apenas blocos de texto, ignora 'reasoning'
                            if isinstance(block, dict) and block.get("type") == "text":
                                text_parts.append(block.get("text", ""))
                            elif isinstance(block, str):
                                text_parts.append(block)
                        final_response = "".join(text_parts)
                    else:
                        # Conteúdo normal (string)
                        final_response = str(content)

                    if final_response.strip():
                        logger.info(
                            f"[Agent] Encontrada resposta final: {final_response[:100]}..."
                        )
                        break

    # Garante que seja string para evitar erro no Pydantic
    if not isinstance(final_response, str):
        final_response = str(final_response) if final_response else ""

    logger.info(
        f"[Agent] Resposta final extraída: {final_response[:100] if final_response else 'VAZIO!!!'}"
    )

    # === MEMORY SYSTEM V2 - SUMMARIZATION TRIGGER (REFATORADO ASYNC) ===
    # Verifica se deve agendar sumarização (totalmente ASYNC/NON-BLOCKING)
    if supabase_client or async_supabase_client:
        try:
            # Prioriza o cliente async se existir, senão usa o sync
            client_to_use = async_supabase_client if async_supabase_client else supabase_client
            memory_service = MemoryService(client_to_use)

            # ✅ CORREÇÃO: Usar get_memory_settings_async com agent_id
            # Isso garante que não bloqueamos o loop, independente do cliente
            settings = await memory_service.get_memory_settings_async(agent_id)

            # Conta APENAS mensagens do usuário (HumanMessage), não AI/System
            all_messages = result.get("messages", [])
            human_messages_count = sum(
                1 for m in all_messages if isinstance(m, HumanMessage)
            )

            logger.info(
                f"[Memory] Trigger check: mode={settings.get('web_summarization_mode')}, "
                f"threshold={settings.get('web_message_threshold')}, "
                f"human_messages={human_messages_count}, channel={channel}"
            )

            should_trigger = memory_service.should_summarize(
                settings=settings,
                channel=channel,
                messages_count=human_messages_count,
                last_message_at=datetime.now(),
                session_ended=False,
            )

            logger.info(f"[Memory] Should summarize: {should_trigger}")

            if should_trigger:
                # ✅ CORREÇÃO: Sempre usar schedule_summarization_async
                # O MemoryService agora sabe lidar com clients sync/async internamente
                await memory_service.schedule_summarization_async(
                    session_id=session_id,
                    user_id=user_id,
                    company_id=company_id,
                    messages=result.get("messages", []),
                    channel=channel,
                    settings=settings,
                    agent_id=agent_id,
                )
                logger.info(
                    f"[Memory] Summarization scheduled async for session {session_id}"
                )

        except Exception as e:
            logger.error(f"[Memory] Error scheduling summarization: {e}", exc_info=True)

    return {
        "response": final_response,
        "tools_used": result.get("tools_used", []),
        "rag_chunks": result.get("rag_chunks", []),
        "tokens_total": result.get("tokens_total", 0),
        "response_time_ms": result.get("llm_response_time_ms", 0),
    }


async def stream_agent(
    graph,
    user_message: str,
    company_id: str,
    user_id: str,
    session_id: str,
    company_config: Dict[str, Any],
    options: Dict[str, Any] = None,
    supabase_client=None,
    agent_id: str = None,
    async_supabase_client=None,  # <--- ADICIONADO: Suporte Async
):
    """
    Stream agent responses token-by-token using SSE.
    Includes robust fallback and ASYNC MEMORY SUMMARIZATION.
    """
    # Build initial state directly (now async)
    initial_state, config, real_agent_data = await _build_initial_state(
        user_message,
        company_id,
        user_id,
        session_id,
        company_config,
        options,
        supabase_client,
        agent_id,
    )

    # Contexto para canal (usado na memória e LangSmith)
    channel = "web"

    # === LANGSMITH TRACING (Multi-Tenant) ===
    # Injeta metadados para isolamento por company/agent no dashboard
    from app.core.langsmith_setup import get_langsmith_config, is_langsmith_enabled

    if is_langsmith_enabled():
        ls_config = get_langsmith_config(
            company_id=company_id,
            agent_id=agent_id,
            user_id=user_id,
            session_id=session_id,
            channel=channel,
        )
        config["metadata"] = ls_config["metadata"]
        config["tags"] = ls_config["tags"]
        config["run_name"] = ls_config["run_name"]
        logger.debug(f"[LangSmith] Stream trace configurado: {ls_config['run_name']}")

    logger.info(f"[Stream] Iniciando astream_events para thread {company_id}:{session_id}")

    has_streamed = False

    try:
        # === RETRY LOOP PARA RESILIÊNCIA DE CONEXÃO ===
        # Supabase/PgBouncer pode fechar conexões inativas. Tentamos até 3x.
        from psycopg import OperationalError as PsycopgOperationalError

        max_retries = 3

        for attempt in range(max_retries):
            try:
                # Loop de Eventos
                async for event in graph.astream_events(initial_state, config, version="v1"):
                    kind = event["event"]
                    name = event.get("name", "")
                    data = event.get("data", {})

                    # --- Streaming Token por Token ---
                    # Filtra por langgraph_node: só streama tokens do nó "agent" (orquestrador).
                    # Tokens do SubAgent (que rodam no nó "tools") são ignorados.
                    if kind == "on_chat_model_stream":
                        event_node = event.get("metadata", {}).get("langgraph_node")
                        if event_node != "agent":
                            continue
                        chunk = data.get("chunk")
                        content = None

                        if hasattr(chunk, "content"):
                            content = chunk.content
                        elif isinstance(chunk, dict):
                            content = chunk.get("content")
                        elif isinstance(chunk, str):
                            content = chunk

                        if content:
                            text_to_yield = ""
                            if isinstance(content, list):
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        text_to_yield += block.get("text", "")
                                    elif isinstance(block, str):
                                        text_to_yield += block
                            elif isinstance(content, str):
                                text_to_yield = content

                            if text_to_yield:
                                yield text_to_yield
                                has_streamed = True

                    # --- Fallback no Fim do Agente ---
                    elif kind == "on_chain_end" and name == "agent" and not has_streamed:
                        output = data.get("output")
                        final_text = ""
                        if isinstance(output, dict) and "messages" in output:
                            msgs = output["messages"]
                            if isinstance(msgs, list) and len(msgs) > 0:
                                last_msg = msgs[-1]
                                final_text = getattr(last_msg, "content", str(last_msg))
                            elif hasattr(msgs, "content"):
                                final_text = msgs.content
                        elif hasattr(output, "content"):
                            final_text = output.content

                        if final_text:
                            if isinstance(final_text, list):
                                text_parts = []
                                for block in final_text:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        text_parts.append(block.get("text", ""))
                                    elif isinstance(block, str):
                                        text_parts.append(block)
                                final_text = "".join(text_parts)

                            if final_text:
                                logger.info(f"[Stream] ⚠️ Fallback Node 'agent': Enviando {len(final_text)} chars.")
                                yield final_text
                                has_streamed = True

                # Stream completado com sucesso
                break

            except (PsycopgOperationalError, Exception) as retry_error:
                error_str = str(retry_error).lower()
                is_connection_error = any(kw in error_str for kw in ["closed", "connection", "consuming input failed", "server closed"])

                if is_connection_error and attempt < max_retries - 1:
                    logger.warning(f"[Stream] ⚠️ Conexão DB perdida (tentativa {attempt + 1}/{max_retries}): {type(retry_error).__name__}")
                    await asyncio.sleep(1)  # Backoff antes de retry
                    continue
                else:
                    # Erro não recuperável ou tentativas esgotadas
                    logger.error(f"[Stream] ❌ Erro após {attempt + 1} tentativas: {retry_error}")
                    raise  # Re-raise para o except externo

        # === 🚀 MEMORY SYSTEM V2 - SUMMARIZATION TRIGGER (ADICIONADO) ===
        # Executado APÓS o fim do stream, não bloqueia a resposta visual
        if supabase_client or async_supabase_client:
            try:
                # 1. Recuperar estado atualizado do grafo para contar mensagens
                final_state = await graph.aget_state(config)
                all_messages = final_state.values.get("messages", [])

                # 2. Configurar Memory Service
                client_to_use = async_supabase_client if async_supabase_client else supabase_client
                memory_service = MemoryService(client_to_use)

                # 3. Ler settings Async por agent_id
                settings = await memory_service.get_memory_settings_async(agent_id)

                # 4. Contar mensagens Humanas
                human_messages_count = sum(
                    1 for m in all_messages if isinstance(m, HumanMessage)
                )

                logger.info(
                    f"[Stream Memory] Trigger check: msgs={human_messages_count}, threshold={settings.get('web_message_threshold', 20)}"
                )

                should_trigger = memory_service.should_summarize(
                    settings=settings,
                    channel=channel,
                    messages_count=human_messages_count,
                    last_message_at=datetime.now(),
                    session_ended=False,
                )

                if should_trigger:
                    await memory_service.schedule_summarization_async(
                        session_id=session_id,
                        user_id=user_id,
                        company_id=company_id,
                        messages=all_messages,
                        channel=channel,
                        settings=settings,
                        agent_id=agent_id,
                    )
                    logger.info(
                        f"[Stream Memory] ✅ Summarization scheduled async for session {session_id}"
                    )

            except Exception as e:
                logger.error(f"[Stream Memory] Error in background trigger: {e}")

    except Exception as e:
        logger.error(f"[Stream] Error during streaming: {e}", exc_info=True)
        yield "\n\n[Erro interno no servidor durante a geração da resposta.]"

