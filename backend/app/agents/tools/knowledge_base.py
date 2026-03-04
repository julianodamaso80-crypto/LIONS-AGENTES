"""
Knowledge Base Tool - Busca informações nos documentos da empresa.
Encapsula o RAG existente como uma Tool do LangGraph.

🔥 VERSÃO CORRIGIDA: agent_id recebido como parâmetro em _run() (não mais fixo no __init__)
Isso garante isolamento multi-agente - cada busca usa o agent_id correto.
"""

import logging
from typing import Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from ...services.search_service import get_search_service

logger = logging.getLogger(__name__)


class KnowledgeBaseInput(BaseModel):
    """Input schema para a KnowledgeBaseTool."""

    query: str = Field(
        description="A pergunta ou termo de busca para encontrar nos documentos da empresa"
    )


class KnowledgeBaseTool(BaseTool):
    """
    Ferramenta para buscar informações na base de conhecimento da empresa.

    Use esta ferramenta quando o usuário perguntar sobre:
    - Políticas da empresa
    - Documentos internos
    - Procedimentos e processos
    - FAQ e informações específicas da empresa
    - Qualquer informação que possa estar nos documentos carregados

    🔥 MULTI-AGENT:
    - agent_id é passado em runtime pelo tool_node (não mais fixo)
    - Isso permite isolamento correto entre agentes
    - Cada agente só vê seus próprios documentos
    """

    name: str = "knowledge_base_search"
    description: str = """
    Busca informações na base de conhecimento (documentos) da empresa.
    Use quando precisar encontrar informações específicas sobre a empresa,
    suas políticas, procedimentos, produtos ou serviços.
    Retorna trechos relevantes dos documentos que podem responder à pergunta.
    """
    args_schema: Type[BaseModel] = KnowledgeBaseInput

    # Configuração injetada (apenas company_id é fixo no __init__)
    company_id: str = ""
    collection_name: Optional[str] = None  # Para benchmarks/collections customizadas

    # 🔥 NOTA: agent_id NÃO é mais atributo da classe
    # Será recebido como parâmetro em _run()

    class Config:
        arbitrary_types_allowed = True

    def __init__(
        self,
        company_id: str,
        agent_id: Optional[str] = None,  # Mantido para compatibilidade, mas IGNORADO
        collection_name: Optional[str] = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.company_id = company_id
        self.collection_name = collection_name

        # 🔥 AVISO: agent_id do __init__ é ignorado - será passado em runtime
        if agent_id:
            logger.debug(
                f"[RAG Tool] agent_id={agent_id} passado no __init__ (será sobrescrito em runtime)"
            )

        logger.info(
            f"[RAG Tool] Inicializada | company={company_id} | collection={collection_name}"
        )

    def _run(
        self,
        query: str,
        agent_id: Optional[str] = None,  # 🔥 Injetado pelo tool_node
        is_hyde_enabled: bool = True,    # 🔥 NOVO: Controla busca profunda
        **kwargs,
    ) -> dict:
        """
        Executa a busca usando o SearchService (Cascade RAG).

        🔥 CORREÇÃO: agent_id agora é parâmetro, não atributo fixo.
        O tool_node extrai do state e passa aqui.

        Args:
            query: Pergunta do usuário
            agent_id: ID do agente para filtro (injetado pelo tool_node)
            is_hyde_enabled: Se True, ativa HyDE para buscas complexas (mais lento)

        Returns:
            Dict com resultados da busca
        """
        try:
            logger.info(
                f"[RAG Tool] 🔍 Buscando: '{query}' | company={self.company_id} | agent={agent_id} | hyde={is_hyde_enabled}"
            )

            # Delega para o SearchService
            search_service = get_search_service()
            result = search_service.smart_search(
                company_id=self.company_id,
                query=query,
                agent_id=agent_id,
                is_hyde_enabled=is_hyde_enabled,  # 🔥 Passa config de HyDE
            )

            # Log do resultado
            if result.get("found"):
                strategy = result.get("strategy", "unknown")
                max_score = result.get("max_score", 0)
                search_time = result.get("search_time_ms", 0)
                chunks_count = len(result.get("chunks", []))
                logger.info(
                    f"[RAG Tool] ✅ Encontrado via {strategy} | "
                    f"Score: {max_score:.3f} | Chunks: {chunks_count} | "
                    f"{search_time}ms | agent={agent_id}"
                )
            else:
                logger.warning(
                    f"[RAG Tool] ❌ Nenhum resultado encontrado para agent={agent_id}"
                )

            # Adiciona agent_id no resultado para debug
            result["agent_id"] = agent_id

            return result

        except Exception as e:
            logger.error(f"[RAG Tool] Erro na busca: {e}", exc_info=True)
            return {
                "content": "",
                "chunks": [],
                "found": False,
                "error": str(e),
                "agent_id": agent_id,
            }

    async def _arun(self, query: str, agent_id: Optional[str] = None, is_hyde_enabled: bool = True, **kwargs) -> dict:
        """Versão assíncrona - por enquanto chama a síncrona."""
        return self._run(query, agent_id=agent_id, is_hyde_enabled=is_hyde_enabled, **kwargs)
