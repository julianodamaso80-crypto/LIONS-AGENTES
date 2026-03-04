"""
CSV Analytics Tool - Análise estruturada de dados tabulares.
Permite ordenação, filtros e rankings em dados de CSVs.

🔥 Seguindo padrão da KnowledgeBaseTool:
- company_id no __init__
- agent_id injetado em _run() (runtime)
"""

import logging
from typing import Any, Dict, Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from ...services.qdrant_service import get_qdrant_service

logger = logging.getLogger(__name__)


class CSVAnalyticsInput(BaseModel):
    """Input schema para CSVAnalyticsTool."""

    filter_column: Optional[str] = Field(
        None,
        description="Nome da coluna para filtrar (ex: 'Categoria', 'Status')"
    )
    filter_value: Optional[str] = Field(
        None,
        description="Valor exato para filtro (ex: 'Vestidos', 'Ativo')"
    )
    sort_column: Optional[str] = Field(
        None,
        description="Nome da coluna para ordenar (ex: 'Vendas', 'Preço', 'Data')"
    )
    sort_order: str = Field(
        "desc",
        description="'asc' para crescente, 'desc' para decrescente"
    )
    limit: int = Field(
        10,
        description="Número máximo de resultados (1-20)"
    )


class CSVAnalyticsTool(BaseTool):
    """
    Ferramenta para análise estruturada de dados de CSVs/tabelas.
    
    Use esta ferramenta EXCLUSIVAMENTE para:
    - Ordenar dados (ex: "top 5 produtos mais vendidos")
    - Filtrar por valor exato (ex: "produtos da categoria Vestidos")  
    - Rankings e contagens
    
    NÃO use para perguntas descritivas ou buscas por significado.
    Para essas, use knowledge_base_search.
    
    🔥 MULTI-AGENT:
    - agent_id é passado em runtime pelo tool_node
    - Cada agente só vê seus próprios dados
    """

    name: str = "csv_analytics"
    description: str = ""  # Preenchida dinamicamente no __init__
    args_schema: Type[BaseModel] = CSVAnalyticsInput

    # Configuração
    company_id: str = ""
    _csv_columns: list = []  # Cache das colunas descobertas

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, company_id: str, agent_id: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.company_id = company_id

        # Descobrir colunas do CSV automaticamente
        columns = self._discover_columns(company_id, agent_id) if agent_id else []
        self._csv_columns = columns

        # Montar description dinâmica
        base_desc = (
            "Analisa dados estruturados de tabelas/CSVs. "
            "Use para: rankings, ordenação, filtros por categoria, encontrar maiores/menores valores. "
            'Exemplo: "Quais os 5 produtos mais vendidos?" ou "Liste itens da categoria X". '
            "NÃO use para perguntas descritivas - use knowledge_base_search para isso."
        )
        if columns:
            cols_str = ", ".join(columns)
            self.description = f"{base_desc}\nColunas disponíveis para sort_column e filter_column: [{cols_str}]"
            logger.info(f"[CSV Analytics] Inicializada | company={company_id} | colunas={columns}")
        else:
            self.description = base_desc
            logger.info(f"[CSV Analytics] Inicializada | company={company_id} | sem colunas CSV detectadas")

    def _discover_columns(self, company_id: str, agent_id: str) -> list:
        """Busca um sample do Qdrant para descobrir nomes das colunas do CSV."""
        try:
            qdrant = get_qdrant_service()
            sample = qdrant.scroll_by_payload(
                company_id=company_id,
                agent_id=agent_id,
                file_type="csv",
                limit=1,  # só precisa de 1 item pra descobrir as colunas
            )
            if sample:
                meta = sample[0].get("metadata", {})
                # Filtrar campos internos
                internal_keys = {"file_type", "chunk_type", "row_index", "document_id",
                                 "source", "ingestion_strategy", "agent_id",
                                 "filename", "document_name", "safety_split", "split_part"}
                return [k for k in meta.keys() if k not in internal_keys]
        except Exception as e:
            logger.warning(f"[CSV Analytics] Erro ao descobrir colunas: {e}")
        return []


    def _run(
        self,
        filter_column: Optional[str] = None,
        filter_value: Optional[str] = None,
        sort_column: Optional[str] = None,
        sort_order: str = "desc",
        limit: int = 10,
        agent_id: Optional[str] = None,  # 🔥 Injetado pelo tool_node
        **kwargs,
    ) -> str:
        """
        Executa busca estruturada em dados CSV.
        
        Args:
            filter_column: Coluna para filtrar
            filter_value: Valor para filtrar
            sort_column: Coluna para ordenar
            sort_order: 'asc' ou 'desc'
            limit: Máximo de resultados
            agent_id: ID do agente (injetado pelo runtime)
            
        Returns:
            String formatada com resultados
        """
        if not agent_id:
            return "Erro: agent_id não fornecido pelo sistema."

        logger.info(
            f"[CSV Analytics] 🔍 Buscando | company={self.company_id} | "
            f"agent={agent_id} | filter={filter_column}={filter_value} | "
            f"sort={sort_column} {sort_order} | limit={limit}"
        )

        try:
            qdrant = get_qdrant_service()

            # Preparar filtros de metadados
            metadata_filters = {}
            if filter_column and filter_value:
                # ⚠️ Qdrant não suporta chaves com espaços em filtros
                # Se a coluna tiver espaços, retorna erro amigável
                if " " in filter_column:
                    return (
                        f"Erro: Filtro por coluna '{filter_column}' não suportado. "
                        f"Para buscar um produto específico, use a ferramenta knowledge_base_search "
                        f"ao invés de csv_analytics. Esta ferramenta é melhor para rankings e ordenação."
                    )
                metadata_filters[filter_column] = filter_value

            # Buscar dados (limite maior para permitir ordenação em memória)
            raw_items = qdrant.scroll_by_payload(
                company_id=self.company_id,
                agent_id=agent_id,
                file_type="csv",
                metadata_filters=metadata_filters,
                limit=500,  # Busca mais para permitir ordenação correta
            )

            if not raw_items:
                return "Nenhum dado CSV encontrado com esses filtros."


            # Ordenação em memória (se especificada)
            if sort_column:
                # Resolver nome real da coluna (case-insensitive + strip)
                sample_meta = raw_items[0].get("metadata", {}) if raw_items else {}
                available_cols = list(sample_meta.keys())
                resolved_col = None

                # Match exato
                if sort_column in sample_meta:
                    resolved_col = sort_column
                else:
                    # Match case-insensitive
                    sort_lower = sort_column.strip().lower()
                    for col in available_cols:
                        if col.strip().lower() == sort_lower:
                            resolved_col = col
                            break

                if not resolved_col:
                    logger.warning(
                        f"[CSV Analytics] ⚠️ Coluna '{sort_column}' não encontrada. "
                        f"Colunas disponíveis: {available_cols}"
                    )
                else:
                    logger.info(f"[CSV Analytics] Ordenando por '{resolved_col}' ({sort_order})")

                    def get_sort_val(item: Dict[str, Any]):
                        val = item.get("metadata", {}).get(resolved_col, 0)
                        # Tenta converter para float (limpa formatação de moeda)
                        try:
                            clean_val = (
                                str(val)
                                .replace("R$", "")
                                .replace("$", "")
                                .replace(",", ".")
                                .replace(" ", "")
                                .replace(".", "", str(val).count(".") - 1)  # Remove pontos de milhar
                                .strip()
                            )
                            return float(clean_val)
                        except (ValueError, TypeError):
                            return str(val)

                    reverse = sort_order == "desc"
                    raw_items.sort(key=get_sort_val, reverse=reverse)

            # Limitar resultados (proteção contra contexto estourado)
            safe_limit = min(max(1, limit), 20)
            top_items = raw_items[:safe_limit]

            # Formatar resposta para o LLM
            result_lines = [f"Encontrados {len(raw_items)} itens (mostrando top {len(top_items)}):"]

            for idx, item in enumerate(top_items, 1):
                metadata = item.get("metadata", {})
                # Remove campos internos do display
                display_meta = {
                    k: v for k, v in metadata.items()
                    if k not in ("file_type", "row_index", "document_id", "source")
                }
                meta_str = ", ".join([f"{k}: {v}" for k, v in display_meta.items()])
                result_lines.append(f"{idx}. {meta_str}")

            result = "\n".join(result_lines)

            logger.info(
                f"[CSV Analytics] ✅ Retornados {len(top_items)} de {len(raw_items)} itens"
            )

            return result

        except Exception as e:
            logger.error(f"[CSV Analytics] Erro: {e}", exc_info=True)
            return f"Erro ao analisar dados: {str(e)}"

    async def _arun(
        self,
        filter_column: Optional[str] = None,
        filter_value: Optional[str] = None,
        sort_column: Optional[str] = None,
        sort_order: str = "desc",
        limit: int = 10,
        agent_id: Optional[str] = None,
        **kwargs,
    ) -> str:
        """Versão assíncrona - chama a síncrona."""
        return self._run(
            filter_column=filter_column,
            filter_value=filter_value,
            sort_column=sort_column,
            sort_order=sort_order,
            limit=limit,
            agent_id=agent_id,
            **kwargs,
        )
