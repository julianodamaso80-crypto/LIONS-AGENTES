"""
Web Search Tool - Interface LangChain para busca na web.
"""

import logging
from typing import Any, Dict, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from ...services.tavily_service import get_tavily_service

logger = logging.getLogger(__name__)


class WebSearchInput(BaseModel):
    """Input para busca na web."""

    query: str = Field(
        description="A pergunta ou termo de busca para pesquisar na internet. "
        "Use para informações atuais, notícias, eventos recentes ou dados públicos."
    )


class WebSearchTool(BaseTool):
    """
    Ferramenta de busca na web usando Tavily AI.

    Use esta ferramenta quando precisar de:
    - Informações atuais ou recentes (notícias, eventos)
    - Dados públicos não disponíveis na base interna
    - Pesquisas sobre tópicos gerais

    NÃO use para:
    - Informações sobre a empresa (use knowledge_base_search)
    - Políticas internas ou documentos da empresa
    """

    name: str = "web_search"
    description: str = """
    Busca informações atuais e públicas na internet usando o Google/Bing via Tavily AI.
    Use para encontrar notícias recentes, eventos atuais, dados públicos ou informações gerais.
    NÃO use para informações internas da empresa - use 'knowledge_base_search' para isso.
    """
    args_schema: Type[BaseModel] = WebSearchInput

    class Config:
        arbitrary_types_allowed = True

    def _run(self, query: str) -> Dict[str, Any]:
        """Executa a busca na web."""
        logger.info(f"[WebSearchTool] Executando busca: '{query}'")

        try:
            service = get_tavily_service()
            result = service.search(query, max_results=3)

            logger.info("[WebSearchTool] Busca concluída")

            # Retorna dict estruturado (igual KnowledgeBaseTool)
            return {
                "content": result,
                "strategy": "web",  # Identificador de estratégia
                "found": True,
                "source": "tavily",
            }

        except Exception as e:
            logger.error(f"[WebSearchTool] Erro: {e}", exc_info=True)
            return {
                "content": f"Erro ao buscar na web: {str(e)}",
                "strategy": "web",
                "found": False,
                "error": str(e),
            }

    async def _arun(self, query: str) -> Dict[str, Any]:
        """Versão assíncrona - chama a síncrona por enquanto."""
        return self._run(query)
