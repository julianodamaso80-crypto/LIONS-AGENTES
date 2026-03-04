"""
Estado compartilhado do Agente LangGraph.
Carrega contexto de negócio (multi-tenant) e métricas para logging.
"""

from typing import Annotated, Optional, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    Estado do agente que persiste durante toda a execução do grafo.
    """

    # === Mensagens (histórico da conversa) ===
    messages: Annotated[list, add_messages]

    # === Contexto Multi-Tenant ===
    company_id: str
    user_id: str
    session_id: str
    company_config: dict  # Config da empresa (provider, model, api_key, etc)
    agent_data: Optional[dict]  # Config do agente (nome, id, tools_config, etc)
    system_prompt: Optional[str]  # Prompt do sistema com memória injetada
    static_prompt: Optional[str]  # Parte estática do prompt (cacheável)
    dynamic_context: Optional[str]  # Parte dinâmica (memória, não cacheável)

    # === RAG Context ===
    rag_context: Optional[str]  # Contexto recuperado dos documentos
    rag_chunks: list[dict]  # Chunks usados com metadata para logging

    # === Métricas para Logging ===
    # IMPORTANTE: NÃO usar reducer aqui! O checkpoint persiste entre mensagens.
    # Acumulação manual no agent_node + reset via initial_state garante
    # que tokens sejam somados APENAS dentro de uma execução.
    tools_used: list[str]  # Lista de tools chamadas
    rag_search_time_ms: int  # Tempo da busca RAG
    llm_response_time_ms: int  # Tempo da resposta do LLM
    tokens_input: int  # Tokens de entrada
    tokens_output: int  # Tokens de saída
    tokens_total: int  # Total de tokens

    # === Controle ===
    should_continue: bool  # Se deve continuar o ciclo
    final_response: Optional[str]  # Resposta final para o usuário

    # === HTTP Tools ===
    allowed_http_tools: Optional[
        list[str]
    ]  # Lista de HTTP tools autorizadas via prompt

    # === SubAgent Delegation ===
    internal_steps: Optional[list[dict]]  # SubAgent execution logs (salvo em conversation_logs.internal_steps JSONB)
