"""
Shopify Catalog Tool - Busca global de produtos para LangChain.

Diferente das tools UCP que são geradas dinamicamente,
esta é uma tool fixa para busca no catálogo global Shopify.
"""

import asyncio
import json
import logging
from typing import Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from app.services.shopify_catalog import (
    get_shopify_catalog_service,
)

logger = logging.getLogger(__name__)


# =========================================================
# Input Schema
# =========================================================

class CatalogSearchInput(BaseModel):
    """Schema de entrada para busca no catálogo."""
    query: str = Field(
        description="Termo de busca natural para encontrar produtos (ex: 'tênis esportivo vermelho')"
    )
    limit: int = Field(
        default=5,
        description="Número máximo de produtos a retornar (1-20)",
        ge=1,
        le=20
    )


class ProductLookupInput(BaseModel):
    """Schema para lookup de produto específico."""
    product_id: str = Field(
        description="ID do produto para buscar detalhes"
    )
    shop_domain: Optional[str] = Field(
        default=None,
        description="Domínio da loja (opcional)"
    )


# =========================================================
# Catalog Search Tool
# =========================================================

class ShopifyCatalogSearchTool(BaseTool):
    """
    Tool para busca global de produtos no Shopify Catalog.

    Permite buscar produtos em TODAS as lojas Shopify usando
    linguagem natural.
    """

    name: str = "shopify_catalog_search"
    description: str = (
        "Busca produtos em todo o catálogo global Shopify. "
        "Use para encontrar produtos por nome, categoria, marca ou descrição. "
        "Retorna lista de produtos com preço, imagem e loja de origem."
    )
    args_schema: Type[BaseModel] = CatalogSearchInput

    def _run(self, query: str, limit: int = 5) -> str:
        """Execução síncrona (fallback)."""
        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        self._run_in_new_loop, query, limit
                    )
                    return future.result(timeout=65)
            else:
                return self._run_in_new_loop(query, limit)
        except Exception as e:
            logger.error(f"[Catalog Tool] Sync error: {e}")
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    def _run_in_new_loop(self, query: str, limit: int) -> str:
        """Executa em novo event loop."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._arun(query=query, limit=limit))
        finally:
            loop.close()

    async def _arun(self, query: str, limit: int = 5) -> str:
        """Execução ASYNC principal."""
        logger.info(f"[Catalog Tool] 🔍 Buscando: '{query}'")

        service = get_shopify_catalog_service()
        result = await service.search_products(query=query, limit=limit)

        if not result.success:
            return json.dumps({
                "error": result.error,
                "type": "catalog_error"
            }, ensure_ascii=False)

        # Formatar resposta para o LLM
        products_data = []
        for product in result.products:
            products_data.append({
                "id": product.id,
                "title": product.title,
                "price": product.price,
                "currency": product.currency,
                "vendor": product.vendor,
                "shop": product.shop_domain,
                "image": product.image_url,
                "variant_id": product.variant_id,
                "available": product.available
            })

        response = {
            "query": query,
            "total": result.total,
            "products": products_data,
            "_metadata": {
                "type": "shopify_catalog",
                "source": "global_shopify"
            }
        }

        return json.dumps(response, ensure_ascii=False, indent=2)


class ShopifyCatalogDetailsTool(BaseTool):
    """
    Tool para obter detalhes de um produto específico.
    """

    name: str = "shopify_product_details"
    description: str = (
        "Obtém detalhes completos de um produto específico do Shopify. "
        "Use após buscar produtos para obter mais informações."
    )
    args_schema: Type[BaseModel] = ProductLookupInput

    def _run(self, product_id: str, shop_domain: Optional[str] = None) -> str:
        """Execução síncrona (fallback)."""
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(
                    self._arun(product_id=product_id, shop_domain=shop_domain)
                )
            finally:
                loop.close()
        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    async def _arun(
        self,
        product_id: str,
        shop_domain: Optional[str] = None
    ) -> str:
        """Execução ASYNC principal."""
        service = get_shopify_catalog_service()
        product = await service.get_product_details(
            product_id=product_id,
            shop_domain=shop_domain
        )

        if not product:
            return json.dumps({
                "error": "Produto não encontrado",
                "product_id": product_id
            }, ensure_ascii=False)

        return json.dumps({
            "id": product.id,
            "title": product.title,
            "description": product.description,
            "price": product.price,
            "currency": product.currency,
            "vendor": product.vendor,
            "product_type": product.product_type,
            "shop": product.shop_domain,
            "image": product.image_url,
            "variant_id": product.variant_id,
            "available": product.available
        }, ensure_ascii=False, indent=2)


# =========================================================
# Factory
# =========================================================

def get_catalog_tools() -> list:
    """
    Retorna lista de tools do Shopify Catalog.

    Só retorna se credenciais estiverem configuradas.
    """
    from app.core.config import settings

    # Verificar se tem credenciais
    has_credentials = bool(
        getattr(settings, 'SHOPIFY_CLIENT_ID', None) or
        getattr(settings, 'SHOPIFY_PARTNER_CLIENT_ID', None)
    )

    if not has_credentials:
        logger.debug("[Catalog Tools] Credenciais Shopify não configuradas")
        return []

    return [
        ShopifyCatalogSearchTool(),
        ShopifyCatalogDetailsTool()
    ]
