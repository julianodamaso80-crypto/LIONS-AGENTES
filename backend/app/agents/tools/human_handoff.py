"""
Human Handoff Tool - Permite ao agente solicitar atendimento humano.
Atualiza o status da conversa para HUMAN_REQUESTED.
"""

import logging
from typing import Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class HumanHandoffInput(BaseModel):
    """Input schema para a HumanHandoffTool."""

    reason: Optional[str] = Field(
        default=None,
        description="Motivo opcional para solicitar atendimento humano. "
        "Exemplo: 'Cliente deseja falar com um especialista' ou "
        "'Questão fora do escopo do agente'.",
    )


class HumanHandoffTool(BaseTool):
    """
    Ferramenta para solicitar transferência para atendimento humano.

    Use esta ferramenta quando:
    - O usuário pedir explicitamente para falar com um humano
    - A questão estiver fora do escopo do agente
    - O problema for muito complexo para resolver automaticamente
    - O usuário demonstrar frustração e precisar de atenção especial

    IMPORTANTE: Após chamar esta ferramenta, informe o usuário que
    um atendente foi solicitado e entrará em contato em breve.
    """

    name: str = "request_human_agent"
    description: str = """
    Solicita a transferência da conversa para um atendente humano.
    Use quando o usuário pedir para falar com uma pessoa real,
    quando a questão for muito complexa, ou quando estiver fora do seu escopo.
    Opcionalmente, informe o motivo da transferência.
    """
    args_schema: Type[BaseModel] = HumanHandoffInput

    # Supabase client injetado
    supabase_client: object = None

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, supabase_client, **kwargs):
        super().__init__(**kwargs)
        self.supabase_client = supabase_client
        logger.info("[HumanHandoff] Tool inicializada")

    def _run(
        self, reason: Optional[str] = None, session_id: Optional[str] = None, **kwargs
    ) -> str:
        """
        Executa a solicitação de atendimento humano.

        Args:
            reason: Motivo da solicitação (opcional)
            session_id: ID da sessão (injetado pelo tool_node)

        Returns:
            Mensagem de confirmação para o usuário
        """
        try:
            logger.info(
                f"[HumanHandoff] 🔔 Solicitando humano | session={session_id} | reason={reason}"
            )

            if not session_id:
                logger.error("[HumanHandoff] ❌ session_id não fornecido!")
                return "Erro interno: não foi possível identificar a conversa."

            if not self.supabase_client:
                logger.error("[HumanHandoff] ❌ supabase_client não configurado!")
                return "Erro interno: serviço de banco de dados indisponível."

            # Atualiza o status da conversa para HUMAN_REQUESTED
            update_data = {"status": "HUMAN_REQUESTED"}

            # Se tiver motivo, salva no campo específico
            if reason:
                update_data["human_handoff_reason"] = reason

            # Buscar e atualizar a conversa pelo session_id
            result = (
                self.supabase_client.table("conversations")
                .update(update_data)
                .eq("session_id", session_id)
                .execute()
            )

            if result.data and len(result.data) > 0:
                logger.info(
                    f"[HumanHandoff] ✅ Status atualizado para HUMAN_REQUESTED | conversation_id={result.data[0].get('id')}"
                )
                return (
                    "Um especialista foi solicitado e entrará na conversa em breve. "
                    "Por favor, aguarde alguns instantes enquanto conectamos você a um atendente."
                )
            else:
                # Conversa não encontrada, pode ser nova - tentar criar
                logger.warning(
                    f"[HumanHandoff] ⚠️ Conversa não encontrada para session_id={session_id}"
                )
                return (
                    "Um atendente foi solicitado. "
                    "Em breve você será atendido por um de nossos especialistas."
                )

        except Exception as e:
            logger.error(
                f"[HumanHandoff] ❌ Erro ao solicitar humano: {e}", exc_info=True
            )
            return (
                "Sua solicitação foi registrada. "
                "Um atendente entrará em contato em breve."
            )

    async def _arun(
        self, reason: Optional[str] = None, session_id: Optional[str] = None, **kwargs
    ) -> str:
        """Versão assíncrona - chama a síncrona."""
        return self._run(reason=reason, session_id=session_id, **kwargs)
