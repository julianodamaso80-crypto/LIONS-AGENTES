"""
Nós do grafo LangGraph.
Cada função representa um nó que processa o estado.

🔥 VERSÃO FINAL CORRIGIDA:
- Limpeza de Reasoning no histórico (Evita erro 400)
- Debug de Tokens (Loga usage_metadata)
- Janela Deslizante (Performance)
- Injeção de Agent ID nas Tools
"""

import asyncio
import json
import logging
import time
from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from .state import AgentState
from .utils import extract_text_from_content, sanitize_ai_message
from .context import build_task_context

logger = logging.getLogger(__name__)

from app.core.constants import AGENT_CONTEXT_WINDOW_SIZE


def sanitize_history(messages: list) -> list:
    """
    Sanitiza o histórico para compatibilidade com todos os providers (OpenAI, Gemini, Anthropic).
    
    Corrige:
    1. ToolMessages órfãs (sem AIMessage com tool_calls correspondente)
    2. AIMessages com tool_calls órfãos (sem ToolMessages correspondentes)
       → Gemini exige que tool_calls sejam imediatamente seguidos por ToolMessages
    3. Mensagens AI consecutivas (Gemini rejeita)
    """
    if not messages:
        return messages

    # === PASSO 1: Coletar todos os tool_call_ids e tool_response_ids ===
    all_tool_call_ids = set()
    all_tool_response_ids = set()

    for msg in messages:
        if isinstance(msg, AIMessage) or (hasattr(msg, "type") and msg.type == "ai"):
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    tc_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
                    if tc_id:
                        all_tool_call_ids.add(tc_id)

        elif isinstance(msg, ToolMessage) or (hasattr(msg, "type") and msg.type == "tool"):
            tool_call_id = getattr(msg, "tool_call_id", None)
            if tool_call_id:
                all_tool_response_ids.add(tool_call_id)

    # IDs com par completo (AIMessage + ToolMessage)
    paired_ids = all_tool_call_ids & all_tool_response_ids
    # IDs de tool_calls que NÃO têm ToolMessage correspondente
    orphan_call_ids = all_tool_call_ids - all_tool_response_ids

    # === PASSO 2: Filtrar mensagens ===
    sanitized = []
    for msg in messages:
        if isinstance(msg, AIMessage) or (hasattr(msg, "type") and msg.type == "ai"):
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                # Verificar se TODOS os tool_calls têm ToolMessages correspondentes
                msg_call_ids = set()
                for tc in msg.tool_calls:
                    tc_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
                    if tc_id:
                        msg_call_ids.add(tc_id)

                if msg_call_ids.issubset(paired_ids):
                    # Todos os tool_calls têm respostas — manter intacto
                    sanitized.append(msg)
                else:
                    # Remover tool_calls órfãos — manter apenas o texto
                    text_content = extract_text_from_content(msg.content) if msg.content else ""
                    if text_content.strip():
                        sanitized.append(AIMessage(content=text_content))
                        logger.debug(
                            f"[sanitize_history] AIMessage com tool_calls órfãos convertida para texto"
                        )
                    else:
                        logger.debug(
                            f"[sanitize_history] AIMessage com tool_calls órfãos removida (sem texto)"
                        )
            else:
                sanitized.append(msg)

        elif isinstance(msg, ToolMessage) or (hasattr(msg, "type") and msg.type == "tool"):
            tool_call_id = getattr(msg, "tool_call_id", None)
            if tool_call_id in paired_ids:
                sanitized.append(msg)
            else:
                logger.debug(
                    f"[sanitize_history] ToolMessage órfã removida (tool_call_id={tool_call_id})"
                )

        else:
            sanitized.append(msg)

    # === PASSO 3: Merge de AIMessages consecutivas (Gemini não aceita) ===
    final = []
    for msg in sanitized:
        if (
            final
            and isinstance(msg, AIMessage)
            and isinstance(final[-1], AIMessage)
            and not (hasattr(final[-1], "tool_calls") and final[-1].tool_calls)
            and not (hasattr(msg, "tool_calls") and msg.tool_calls)
        ):
            # Merge texto de AIMessages consecutivas sem tool_calls
            prev_text = extract_text_from_content(final[-1].content)
            curr_text = extract_text_from_content(msg.content)
            merged = f"{prev_text}\n{curr_text}".strip()
            final[-1] = AIMessage(content=merged)
            logger.debug("[sanitize_history] Merged consecutive AIMessages")
        else:
            final.append(msg)

    return final


def build_system_prompt(company_config: dict, rag_context: str = None) -> str:
    """
    Monta o system prompt baseado na config da empresa.
    """
    base_prompt = (
        company_config.get("agent_system_prompt")
        or """
Você é um assistente inteligente e prestativo.
Seja profissional, claro e objetivo nas suas respostas.
Se não souber a resposta, diga que não sabe.
Sempre responda em português brasileiro.
"""
    )

    company_name = company_config.get("company_name", "")
    if company_name:
        base_prompt += f"\n\nVocê está atendendo a empresa: {company_name}."

    base_prompt += """

🔍 FERRAMENTA DISPONÍVEL - BUSCA NA BASE DE CONHECIMENTO:
Você tem acesso à ferramenta 'knowledge_base_search' que busca informações nos documentos da empresa.

QUANDO USAR:
- Sempre que o usuário perguntar sobre a empresa, produtos, serviços, processos, políticas
- Quando o usuário mencionar nomes específicos (produtos, projetos, pessoas, departamentos)
- Quando precisar de informações específicas que podem estar documentadas
- SEMPRE use esta ferramenta ANTES de responder perguntas sobre a empresa

COMO USAR:
- Passe a pergunta do usuário como query
- Exemplo: se o usuário perguntar "O que é Flux Pay?", use knowledge_base_search(query="Flux Pay")
- A ferramenta retorna trechos relevantes dos documentos

IMPORTANTE: Use SEMPRE que possível! Não responda "não sei" sem antes buscar nos documentos.
"""

    if rag_context:
        base_prompt += f"""

=== CONTEXTO DOS DOCUMENTOS DA EMPRESA ===
{rag_context}
=== FIM DO CONTEXTO ===

INSTRUÇÕES IMPORTANTES:
- Use as informações acima para responder às perguntas do usuário
- Se a resposta estiver nos documentos, baseie-se neles
- Se não encontrar nos documentos, responda com seu conhecimento geral
- Seja preciso e cite os documentos quando relevante
"""

    return base_prompt


from langchain_core.runnables import RunnableConfig


async def agent_node(state: AgentState, config: RunnableConfig, llm_with_tools) -> dict:
    """
    Nó do Agente - Decide se usa uma tool ou responde diretamente.
    INCLUI CORREÇÃO PARA ERRO DE REASONING (OpenAI 400).

    Aceita 'config' para propagar callbacks de streaming.
    """
    logger.info("[Agent Node] Processando...")

    # === ✂️ JANELA DESLIZANTE (SLIDING WINDOW) ===
    # Mantém apenas as últimas 15 mensagens para o contexto imediato
    all_messages = state["messages"]
    JANELA_CONTEXTO = AGENT_CONTEXT_WINDOW_SIZE

    if len(all_messages) > JANELA_CONTEXTO:
        messages_to_process = all_messages[-JANELA_CONTEXTO:]
        logger.info(
            f"[Agent Node] Trimming ativo: Enviando {len(messages_to_process)} msgs (de um total de {len(all_messages)})"
        )
    else:
        messages_to_process = all_messages

    # === 🛡️ SANITIZAÇÃO PÓS-TRIMMING ===
    # Remove ToolMessages órfãs que perderam suas AIMessages com tool_calls
    messages_to_process = sanitize_history(messages_to_process)
    logger.debug(f"[Agent Node] Após sanitização: {len(messages_to_process)} msgs")

    # === Preparação do System Prompt ===
    system_prompt = state.get("system_prompt")
    static_prompt = state.get("static_prompt")  # Parte cacheável
    dynamic_context = state.get("dynamic_context", "")  # Parte dinâmica

    if not system_prompt:
        # Fallback se não vier no state
        company_config = state["company_config"]
        agent_data = state.get("agent_data")

        if agent_data and agent_data.get("agent_system_prompt"):
            company_config["agent_system_prompt"] = agent_data["agent_system_prompt"]

        rag_context = state.get("rag_context", "")
        system_prompt = build_system_prompt(company_config, rag_context)
        static_prompt = system_prompt  # Sem separação no fallback

    # === 🔥 ANTHROPIC PROMPT CACHING ===
    # Detecta provider para ativar cache (economia de até 90% em inputs repetidos)
    agent_data = state.get("agent_data") or {}
    company_config = state.get("company_config") or {}
    llm_provider = agent_data.get("llm_provider") or company_config.get("llm_provider") or "openai"

    if llm_provider == "anthropic" and static_prompt:
        # Anthropic: 2 blocos - estático (cacheado) + dinâmico (não cacheado)
        content_blocks = [
            {
                "type": "text",
                "text": static_prompt,
                "cache_control": {"type": "ephemeral"}  # TTL 5 minutos
            }
        ]
        # Adiciona contexto dinâmico SEM cache (memória pode mudar)
        if dynamic_context:
            content_blocks.append({
                "type": "text",
                "text": dynamic_context
                # SEM cache_control - muda a cada request
            })
        system_message = SystemMessage(content=content_blocks)
        logger.info(f"[Agent Node] 🔥 Anthropic cache: static={len(static_prompt)} chars (~{len(static_prompt)//4} tokens), dynamic={len(dynamic_context)} chars")
    else:
        # OpenAI/Google: Content simples (cache automático na OpenAI)
        system_message = SystemMessage(content=system_prompt)

    llm_messages = [system_message]

    # === 🔥 Identificar ToolMessages da rodada ATUAL (para compressão) ===
    pending_tool_call_ids = set()
    for msg in reversed(messages_to_process):
        if isinstance(msg, AIMessage) or (hasattr(msg, "type") and msg.type == "ai"):
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    if isinstance(tc, dict):
                        pending_tool_call_ids.add(tc.get("id"))
                    else:
                        pending_tool_call_ids.add(getattr(tc, "id", None))
            break

    # === 🛡️ Montagem do Histórico BLINDADA (Sanitização) ===
    for msg in messages_to_process:
        if isinstance(msg, HumanMessage):
            llm_messages.append(msg)

        elif isinstance(msg, AIMessage):
            # Sanitiza removendo blocos de reasoning (evita erro 400 da OpenAI)
            llm_messages.append(sanitize_ai_message(msg))

        elif isinstance(msg, ToolMessage):
            # Lógica de compressão de tools antigas
            if msg.tool_call_id in pending_tool_call_ids:
                if msg.name == "knowledge_base_search":
                    try:
                        # Tenta limpar JSON de search para economizar tokens
                        result_dict = json.loads(msg.content)
                        readable_content = result_dict.get("content", msg.content)
                    except Exception:
                        readable_content = msg.content

                    llm_messages.append(
                        ToolMessage(
                            content=readable_content,
                            tool_call_id=msg.tool_call_id,
                            name=msg.name,
                        )
                    )
                else:
                    llm_messages.append(msg)
            else:
                # Comprime tools antigas
                llm_messages.append(
                    ToolMessage(
                        content="[🔍 RAG: Conteúdo bruto removido para otimização. As informações relevantes já constam na resposta anterior da Assistente.]",
                        tool_call_id=msg.tool_call_id,
                        name=msg.name,
                    )
                )

        # Fallback para tipos genéricos
        elif hasattr(msg, "type"):
            if msg.type == "human":
                llm_messages.append(HumanMessage(content=msg.content))
            elif msg.type == "ai":
                llm_messages.append(AIMessage(content=str(msg.content)))  # Força string
            elif msg.type == "tool":
                # Aplica compressão simples
                llm_messages.append(
                    ToolMessage(
                        content="[Conteúdo Otimizado]",
                        tool_call_id=getattr(msg, "tool_call_id", ""),
                        name=getattr(msg, "name", ""),
                    )
                )

    logger.info(f"[Agent Node] Enviando {len(llm_messages)} mensagens ao LLM")

    start_time = time.time()
    # Executa o LLM (com streaming ativo nas configs)
    response = await llm_with_tools.ainvoke(llm_messages, config=config)
    response_time = int((time.time() - start_time) * 1000)

    logger.info(f"[Agent Node] LLM respondeu em {response_time}ms")

    # 🔴 CORREÇÃO: Extração de Tokens
    usage = getattr(response, "usage_metadata", {}) or {}
    input_tokens = usage.get("input_tokens", 0)
    output_tokens = usage.get("output_tokens", 0)
    total_tokens = usage.get("total_tokens", 0)

    # Nota: Normalização de tokens Anthropic foi removida (desnecessária desde Claude 4.5, Dec/2025)

    # Log para validação
    if total_tokens > 0:
        logger.info(f"[Agent Node] 💰 Tokens Capturados: In={input_tokens}, Out={output_tokens}, Total={total_tokens}")
    else:
        logger.warning("[Agent Node] ⚠️ Tokens ainda não encontrados (verifique stream_options).")

    return {
        "messages": [response],
        "rag_chunks": state.get("rag_chunks", []),
        "tools_used": state.get("tools_used", []),
        # Acumula manualmente (sem reducer no AgentState)
        # O initial_state reseta para 0, então só soma dentro desta execução
        "llm_response_time_ms": state.get("llm_response_time_ms", 0) + response_time,
        "tokens_input": state.get("tokens_input", 0) + input_tokens,
        "tokens_output": state.get("tokens_output", 0) + output_tokens,
        "tokens_total": state.get("tokens_total", 0) + total_tokens
    }


async def tool_node(state: AgentState, tools: list) -> dict:
    """
    Nó de Tools - Executa as tools chamadas pelo agente.
    Async para permitir chamadas _arun em tools que suportam (ex: SubAgentTool).
    """
    logger.info("[Tool Node] Executando tools...")

    messages = state["messages"]
    last_message = messages[-1]

    tool_results = []
    tools_used = state.get("tools_used", [])
    rag_chunks = state.get("rag_chunks", [])
    rag_search_time = state.get("rag_search_time_ms", 0)

    # Extrair agent_id do state
    agent_data = state.get("agent_data")
    raw_agent_id = agent_data.get("id") if agent_data else None
    agent_id = str(raw_agent_id) if raw_agent_id else None

    # 🔥 Extrair is_hyde_enabled (default True para retrocompatibilidade)
    is_hyde_enabled = agent_data.get("is_hyde_enabled", True) if agent_data else True

    tool_map = {tool.name: tool for tool in tools}

    # Tracking para SubAgent delegation
    delegation_tokens_input = 0
    delegation_tokens_output = 0
    delegation_tokens_total = 0
    internal_steps = state.get("internal_steps", []) or []

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        for tool_call in last_message.tool_calls:
            if isinstance(tool_call, dict):
                tool_name = tool_call.get("name")
                tool_args = tool_call.get("args", {})
                tool_call_id = tool_call.get("id")
            else:
                tool_name = getattr(tool_call, "name", None)
                tool_args = getattr(tool_call, "args", {})
                tool_call_id = getattr(tool_call, "id", None)

            logger.info(f"[Tool Node] Chamando: {tool_name}")

            if tool_name in tool_map:
                tool = tool_map[tool_name]

                try:
                    # Injeção de Dependências Dinâmicas (invisível para a LLM)
                    if tool_name == "knowledge_base_search":
                        # 🔥 Injeta agent_id E is_hyde_enabled
                        tool_args = {**tool_args, "agent_id": agent_id, "is_hyde_enabled": is_hyde_enabled}
                    elif tool_name == "csv_analytics":
                        # 🔥 Injeta agent_id para isolamento multi-tenant
                        tool_args = {**tool_args, "agent_id": agent_id}
                    elif tool_name == "request_human_agent":
                        session_id = state.get("session_id")
                        tool_args = {**tool_args, "session_id": session_id}
                    elif tool_name == "http_api":
                        allowed_http_tools = state.get("allowed_http_tools", [])
                        tool_args = {**tool_args, "allowed_tools": allowed_http_tools}
                    elif tool_name.startswith("shopify_") or tool_name.startswith("ucp_"):
                        # UCP tools: agent_id já está embutido na tool, mas garantimos aqui
                        tool_args = {**tool_args, "agent_id": agent_id}
                    elif tool_name == "delegate_to_subagent":
                        # 🤖 SubAgent: injeta contexto do orquestrador
                        delegation_config = None
                        sub_id = tool_args.get("subagent_id", "")
                        if hasattr(tool, "available_subagents"):
                            delegation_config = tool.available_subagents.get(sub_id, {})
                        max_context_chars = (
                            delegation_config.get("max_context_chars", 2000)
                            if delegation_config else 2000
                        )
                        tool_args = {
                            **tool_args,
                            "context": build_task_context(state, max_chars=max_context_chars),
                            "user_id": str(state.get("user_id", "")),
                            "session_id": str(state.get("session_id", "")),
                        }


                    # Executa a tool
                    if tool_name == "delegate_to_subagent" and hasattr(tool, '_arun'):
                        # SubAgent roda async para evitar bug de event loop
                        # (ThreadPoolExecutor + new_event_loop mistura loops sob carga)
                        result = await tool._arun(**tool_args)
                    else:
                        # Execução via executor para não bloquear o event loop do FastAPI
                        loop = asyncio.get_running_loop()
                        result = await loop.run_in_executor(
                            None, lambda: tool._run(**tool_args)
                        )
                    tools_used.append(tool_name)

                    # Processamento de Resultado
                    if tool_name == "knowledge_base_search":
                        if isinstance(result, dict):
                            if result.get("chunks"):
                                rag_chunks.extend(result["chunks"])
                            rag_search_time += result.get("search_time_ms", 0)
                            content = json.dumps(result)
                        else:
                            content = str(result)
                    elif tool_name == "delegate_to_subagent":
                        # 🤖 SubAgent: parseia JSON, agrega tokens, captura steps
                        try:
                            sub_result = json.loads(result) if isinstance(result, str) else result
                            sub_tokens = sub_result.get("tokens_used", {})
                            delegation_tokens_input += sub_tokens.get("input", 0)
                            delegation_tokens_output += sub_tokens.get("output", 0)
                            delegation_tokens_total += sub_tokens.get("total", 0)
                            # Captura trace para internal_steps (auditoria/debug)
                            steps_log = sub_result.get("steps_log")
                            if steps_log:
                                internal_steps.append(steps_log)
                            # Retorna texto limpo para o LLM do orquestrador
                            content = sub_result.get("response", str(result))
                        except (json.JSONDecodeError, AttributeError, TypeError) as parse_err:
                            logger.warning(f"[Tool Node] SubAgent JSON parse error: {parse_err}")
                            content = str(result)
                    else:
                        content = str(result)

                    tool_results.append(
                        ToolMessage(
                            content=content, tool_call_id=tool_call_id, name=tool_name
                        )
                    )

                except Exception as e:
                    logger.error(f"[Tool Node] Erro na tool {tool_name}: {e}")
                    tool_results.append(
                        ToolMessage(
                            content=f"Erro: {str(e)}",
                            tool_call_id=tool_call_id,
                            name=tool_name,
                        )
                    )

    return_dict = {
        "messages": tool_results,
        "tools_used": tools_used,
        "rag_chunks": rag_chunks,
        "rag_search_time_ms": rag_search_time,
    }

    # SubAgent tokens são logados separadamente no conversation_logs do SubAgent
    # (billing independente). Apenas log informativo.
    if delegation_tokens_total > 0:
        logger.info(
            f"[Tool Node] 🤖 SubAgent tokens (logados separadamente): "
            f"+{delegation_tokens_total} total"
        )

    # Persist internal_steps se houve delegação
    if internal_steps:
        return_dict["internal_steps"] = internal_steps

    return return_dict




def log_node(state: AgentState, supabase_client) -> dict:
    """
    Nó de Logging - Salva métricas na tabela conversation_logs.
    """
    logger.info("[Log Node] Salvando métricas...")

    try:
        user_question = ""
        for msg in reversed(state["messages"]):
            if isinstance(msg, HumanMessage) or (
                hasattr(msg, "type") and msg.type == "human"
            ):
                user_question = msg.content
                break

        final_response = state.get("final_response", "")
        # Tenta extrair da última mensagem se não estiver no state
        if not final_response:
            for msg in reversed(state["messages"]):
                if isinstance(msg, AIMessage) or (
                    hasattr(msg, "type") and msg.type == "ai"
                ):
                    final_response = extract_text_from_content(msg.content)
                    break

        rag_chunks = state.get("rag_chunks", [])

        # Tenta extrair métricas de busca das tool messages
        search_strategy = None
        retrieval_score = None
        for msg in state["messages"]:
            if hasattr(msg, "type") and msg.type == "tool":
                try:
                    c = json.loads(msg.content)
                    if isinstance(c, dict):
                        if "strategy" in c:
                            search_strategy = c["strategy"]
                        if "max_score" in c:
                            retrieval_score = float(c["max_score"])
                except Exception:
                    continue

        agent_data = state.get("agent_data") or {}
        agent_id = agent_data.get("id") if agent_data else None
        company_config = state.get("company_config") or {}

        # Priority: Agent > Company > Default
        llm_provider = agent_data.get("llm_provider") or company_config.get("llm_provider") or "openai"
        llm_model = agent_data.get("llm_model") or company_config.get("llm_model") or "gpt-4-turbo"
        llm_temperature = agent_data.get("llm_temperature") or company_config.get("llm_temperature") or 0.7

        # Convert UUIDs to strings for JSON serialization
        company_id_str = str(state["company_id"]) if state.get("company_id") else None
        user_id_str = str(state["user_id"]) if state.get("user_id") else None
        session_id_str = str(state["session_id"]) if state.get("session_id") else None

        log_data = {
            "company_id": company_id_str,
            "user_id": user_id_str,
            "session_id": session_id_str,
            "agent_id": str(agent_id) if agent_id else None,
            "user_question": user_question,
            "assistant_response": str(final_response),
            "rag_chunks": rag_chunks,
            "rag_chunks_count": len(rag_chunks),
            "tokens_input": state.get("tokens_input", 0),
            "tokens_output": state.get("tokens_output", 0),
            "tokens_total": state.get("tokens_total", 0),
            "llm_provider": llm_provider,
            "llm_model": llm_model,
            "llm_temperature": float(llm_temperature),
            "response_time_ms": state.get("llm_response_time_ms", 0),
            "rag_search_time_ms": state.get("rag_search_time_ms", 0),
            "search_strategy": search_strategy,
            "retrieval_score": retrieval_score,
            "status": "success",
        }

        # SubAgent delegation logs (se houve)
        internal_steps = state.get("internal_steps")
        if internal_steps:
            log_data["internal_steps"] = internal_steps

        # Unwrap: get real client if wrapper is passed
        real_client = supabase_client.client if hasattr(supabase_client, "client") else supabase_client
        real_client.table("conversation_logs").insert(log_data).execute()
        logger.info("[Log Node] Log salvo com sucesso")

    except Exception as e:
        logger.error(f"[Log Node] Erro ao salvar log: {e}")

    return {}


def should_continue(state: AgentState) -> Literal["tools", "end"]:
    """Função de roteamento"""
    messages = state["messages"]
    last_message = messages[-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        logger.info("[Router] Direcionando para TOOLS")
        return "tools"

    logger.info("[Router] Direcionando para END")
    return "end"
