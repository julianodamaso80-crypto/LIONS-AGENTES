"""
Tavily Service - Busca na Web otimizada para LLMs.
"""

import logging

from tavily import TavilyClient

from ..core.config import settings

logger = logging.getLogger(__name__)


class TavilyService:
    """
    Serviço de Busca na Web usando Tavily AI (Otimizado para LLMs).
    """

    def __init__(self):
        self.api_key = settings.TAVILY_API_KEY
        self.client = None

        if self.api_key:
            try:
                self.client = TavilyClient(api_key=self.api_key)
                logger.info("✅ TavilyService inicializado com sucesso")
            except Exception as e:
                logger.error(f"❌ Erro ao inicializar Tavily: {e}")
        else:
            logger.warning("⚠️ TAVILY_API_KEY não configurada. Web search desativado.")

    def search(self, query: str, max_results: int = 3) -> str:
        """
        Executa busca na web e retorna contexto formatado para o LLM.

        Args:
            query: Pergunta ou termo de busca
            max_results: Número máximo de resultados (padrão: 3)

        Returns:
            String formatada com resultados ou mensagem de erro
        """
        if not self.client:
            return "❌ Erro: A busca na web não está configurada no sistema (TAVILY_API_KEY ausente)."

        try:
            logger.info(f"[WebSearch] Buscando: '{query}'")

            # search_depth="basic" para latência otimizada
            # search_depth="advanced" para resultados mais completos (mais lento)
            response = self.client.search(
                query=query,
                search_depth="basic",  # Configuração aprovada
                max_results=max_results,
            )

            results = response.get("results", [])

            if not results:
                logger.warning(f"[WebSearch] Nenhum resultado para: '{query}'")
                return (
                    "ℹ️ Nenhum resultado relevante encontrado na web para essa consulta."
                )

            # Formata para leitura fácil do LLM
            formatted = []
            for idx, res in enumerate(results, 1):
                title = res.get("title", "Sem título")
                content = res.get("content", "")
                url = res.get("url", "")

                formatted.append(
                    f"🌐 **Resultado {idx}:** [{title}]({url})\n"
                    f"**Conteúdo:** {content}\n"
                )

            final_output = "\n---\n\n".join(formatted)
            logger.info(f"[WebSearch] Retornou {len(results)} resultados")

            return final_output

        except Exception as e:
            logger.error(f"[WebSearch] Erro na busca: {e}", exc_info=True)
            return f"❌ Erro ao realizar busca na web: {str(e)}"


# Singleton
_tavily_service = None


def get_tavily_service():
    """Retorna instância singleton do TavilyService."""
    global _tavily_service
    if _tavily_service is None:
        _tavily_service = TavilyService()
    return _tavily_service
