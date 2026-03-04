"""
Context Slicing — Builds a lean payload for SubAgent execution.

Extracts relevant memory and conversation context from the orchestrator's
AgentState and truncates to a configurable limit.
"""

import logging
from typing import TYPE_CHECKING

from langchain_core.messages import HumanMessage

if TYPE_CHECKING:
    from .state import AgentState

logger = logging.getLogger(__name__)

DEFAULT_MAX_CONTEXT_CHARS = 2000
RECENT_MESSAGES_LIMIT = 3


def build_task_context(state: "AgentState", max_chars: int = DEFAULT_MAX_CONTEXT_CHARS) -> str:
    """
    Extrai contexto mínimo do estado do orquestrador para enviar ao SubAgent.

    Inclui:
    - Fatos e resumos da Memória V2 (já presentes em dynamic_context)
    - Últimas N mensagens do usuário (sem histórico completo)

    Args:
        state: AgentState do orquestrador
        max_chars: Limite de caracteres (configurável via agent_delegations)

    Returns:
        String formatada com contexto relevante
    """
    parts = []

    # 1. Contexto dinâmico (fatos + resumos da Memory V2, já injetados pelo _build_initial_state)
    dynamic_context = state.get("dynamic_context")
    if dynamic_context and dynamic_context.strip():
        parts.append("=== MEMÓRIA DO USUÁRIO ===")
        parts.append(dynamic_context.strip())

    # 2. Últimas mensagens humanas (contexto conversacional recente)
    human_msgs = [
        m for m in state.get("messages", [])
        if isinstance(m, HumanMessage) or (hasattr(m, "type") and m.type == "human")
    ]

    if human_msgs:
        recent = human_msgs[-RECENT_MESSAGES_LIMIT:]
        parts.append("=== MENSAGENS RECENTES DO USUÁRIO ===")
        for msg in recent:
            content = msg.content if hasattr(msg, "content") else str(msg)
            # Truncar mensagens individuais muito longas
            if len(content) > 500:
                content = content[:500] + "..."
            parts.append(f"- {content}")

    context = "\n".join(parts)

    # Truncar ao limite total
    if len(context) > max_chars:
        context = context[:max_chars - 3] + "..."
        logger.debug(f"[Context] Truncated to {max_chars} chars")

    logger.info(f"[Context] Built task context: {len(context)} chars")
    return context
