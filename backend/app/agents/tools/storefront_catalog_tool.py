"""
Storefront Catalog Tool - Busca de produtos em loja específica para LangChain.

Usa o Storefront MCP (público, sem autenticação).
"""

import asyncio
import json
import logging
from typing import Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from app.services.storefront_mcp import (
    get_storefront_client,
)

logger = logging.getLogger(__name__)


# =========================================================
# Input Schemas
# =========================================================

class StoreProductSearchInput(BaseModel):
    """Schema de entrada para busca de produtos."""
    query: str = Field(
        description="Termo de busca (ex: 'vestido', 'camiseta preta')"
    )
    variant_query: Optional[str] = Field(
        default=None,
        description="Filtro opcional de variante (ex: 'P', 'GG', 'Azul', '38'). Use para selecionar a variante correta."
    )
    context: Optional[str] = Field(
        default=None,
        description="Contexto adicional sobre o cliente (ex: 'procurando presente de aniversário')"
    )
    limit: int = Field(
        default=5,
        description="Número máximo de produtos a retornar (1-5)",
        ge=1,
        le=5
    )


class StorePolicySearchInput(BaseModel):
    """Schema de entrada para perguntas sobre políticas."""
    question: str = Field(
        description="Pergunta sobre a loja (ex: 'qual o prazo de entrega?', 'como funciona a devolução?')"
    )


# =========================================================
# Store Product Search Tool
# =========================================================

class StoreProductSearchTool(BaseTool):
    """
    Tool para busca de produtos em uma loja Shopify específica.

    Usa Storefront MCP - sem autenticação necessária.
    """

    name: str = "store_product_search"
    description: str = ""  # Será definido no __init__
    args_schema: Type[BaseModel] = StoreProductSearchInput

    # Configuração da loja
    store_url: str = ""
    store_name: str = ""

    def __init__(self, store_url: str, store_name: Optional[str] = None, **kwargs):
        """
        Args:
            store_url: URL da loja Shopify
            store_name: Nome amigável da loja (opcional)
        """
        super().__init__(**kwargs)
        self.store_url = store_url
        self.store_name = store_name or store_url.replace("https://", "").split(".")[0]

        # Definir description com nome da loja
        self.description = (
            f"Busca produtos na loja {self.store_name}. "
            f"RETORNA JSON UCP. O AGENTE DEVE RETORNAR ESSE JSON CRU NA RESPOSTA PARA O FRONTEND RENDERIZAR O CARROSSEL."
        )

    def _run(self, query: str, variant_query: Optional[str] = None, context: Optional[str] = None, limit: int = 5) -> str:
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
                        self._run_in_new_loop, query, variant_query, context, limit
                    )
                    return future.result(timeout=65)
            else:
                return self._run_in_new_loop(query, variant_query, context, limit)
        except Exception as e:
            logger.error(f"[Store Search] Sync error: {e}")
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    def _run_in_new_loop(self, query: str, variant_query: Optional[str], context: Optional[str], limit: int) -> str:
        """Executa em novo event loop."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                self._arun(query=query, variant_query=variant_query, context=context, limit=limit)
            )
        finally:
            loop.close()

    def _find_best_variant(self, product, variant_query: str):
        """
        Encontra a melhor variante baseada no termo de busca (scoring simples).
        PRIORIZA PRODUTOS EM ESTOQUE (available: true).
        """
        if not product.variants:
            return None

        best_variant = product.variants[0] # Default
        best_score = -1

        query_lower = variant_query.lower().strip()

        for variant in product.variants:
            # 0. Check Availability (Prioridade Máxima)
            # Se não estiver disponível, penaliza muito ou pula
            if not variant.get("available", False):
                continue

            score = 0
            v_title = variant.get("title", "").lower()

            # 1. Match exato no título (ex: "Preto / P" contém "P")
            if query_lower in v_title:
                score += 10

            # 2. Match exato isolado (split por " / ")
            parts = [p.strip() for p in v_title.split("/")]
            if query_lower in parts:
                score += 20 # Bônus alto para match exato de opção (ex: "P" vs "PP")

            # 3. Match em selectedOptions (se houver, nosso polyfill ajuda)
            selected_opts = variant.get("selectedOptions", [])
            # (Se o polyfill rodou antes, isso estará populado)
            for opt in selected_opts:
                if isinstance(opt, dict) and query_lower == opt.get("value", "").lower():
                    score += 15

            if score > best_score:
                best_score = score
                best_variant = variant

        # Fallback: Se não achou NENHUMA disponível que bate com a query (best_score == -1),
        # tenta retornar a primeira disponível geral.
        if best_score == -1 and not best_variant.get("available", False):
             available_vars = [v for v in product.variants if v.get("available", False)]
             if available_vars:
                 best_variant = available_vars[0]

        return best_variant

    async def _arun(
        self,
        query: str,
        variant_query: Optional[str] = None,
        context: Optional[str] = None,
        limit: int = 5
    ) -> str:
        """Execução ASYNC principal."""
        logger.info(f"[Store Search] 🔍 Buscando '{query}' (Var: {variant_query}) em {self.store_url}")

        client = get_storefront_client(self.store_url)
        result = await client.search_products(
            query=query,
            context=context,
            limit=limit
        )

        if not result.success:
            return json.dumps({
                "error": result.error,
                "type": "store_search_error",
                "store": self.store_url
            }, ensure_ascii=False)

        # Formatar produtos para resposta UCP (compatível com ProductCard/ProductCarousel)
        products_data = []
        shop_domain = self.store_url.replace("https://", "").replace("http://", "").rstrip("/")

        for product in result.products:
            # Safe Description
            safe_description = (product.description or "")
            if len(safe_description) > 120:
                safe_description = safe_description[:120] + "..."

            # POLYFILL: Sempre rodar para garantir que variantes tenham dados ricos
            # Isso ajuda no _find_best_variant mesmo que não enviemos options pro front
            if not product.options and product.variants:
                first_var = product.variants[0]
                if first_var.get("title") != "Default Title":
                    title_parts = first_var.get("title", "").split(" / ")
                    if len(title_parts) > 0:
                        inferred_options = [{"name": f"Opção {i+1}", "values": set()} for i in range(len(title_parts))]
                        for v in product.variants:
                            parts = v.get("title", "").split(" / ")
                            v_selected = []
                            for i, part in enumerate(parts):
                                if i < len(inferred_options):
                                    inferred_options[i]["values"].add(part.strip())
                                    v_selected.append({"name": f"Opção {i+1}", "value": part.strip()})
                            v["selectedOptions"] = v_selected
                        product.options = [{"name": o["name"], "values": sorted(o["values"])} for o in inferred_options]

            # SMART SELECTION LOGIC
            selected_variant = None
            if variant_query and product.variants:
                selected_variant = self._find_best_variant(product, variant_query)
            elif product.variants:
                selected_variant = product.variants[0]

            variant_id = selected_variant.get("id") if selected_variant else None

            # 🔥 Cart Permalink: URL direta para checkout
            checkout_url = None
            if variant_id:
                variant_numeric_id = variant_id.split("/")[-1] if "/" in variant_id else variant_id
                checkout_url = f"https://{shop_domain}/cart/{variant_numeric_id}:1"

            products_data.append({
                "id": product.id,
                "title": product.title,
                "description": safe_description,
                "available": product.available,
                "price": selected_variant.get("price") if selected_variant else product.price, # Preço da variante
                "image_url": selected_variant.get("image", {}).get("url") if isinstance(selected_variant.get("image"), dict) else product.image_url, # Imagem da variante
                "variant_id": variant_id,
                "checkout_url": checkout_url,
                "has_variants": len(product.variants) > 1 if product.variants else False,
                # Info de debug para o usuário saber o que foi selecionado
                "selected_variant_title": selected_variant.get("title") if selected_variant else None
            })

        # IMPORTANTE: type DEVE estar no nível raiz para parseUCPContent detectar
        response = {
            "type": "ucp_product_list",
            "provider": "storefront_mcp",
            "shop_domain": shop_domain,
            "query": query,
            "variant_query": variant_query, # Devolver para debug
            "products": products_data[:limit],
            "total_found": result.total,
        }

        # Minify JSON output (remove indent) to save whitespace tokens
        return json.dumps(response, ensure_ascii=False, separators=(',', ':'))


# =========================================================
# Store Policy Search Tool
# =========================================================

class StorePolicySearchTool(BaseTool):
    """
    Tool para perguntas sobre políticas e FAQ da loja.
    """

    name: str = "store_policy_search"
    description: str = ""
    args_schema: Type[BaseModel] = StorePolicySearchInput

    store_url: str = ""
    store_name: str = ""

    def __init__(self, store_url: str, store_name: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.store_url = store_url
        self.store_name = store_name or store_url.replace("https://", "").split(".")[0]

        self.description = (
            f"Responde perguntas sobre políticas da loja {self.store_name}. "
            f"Use para perguntas sobre frete, entrega, devolução, trocas, pagamento, etc."
        )

    def _run(self, question: str) -> str:
        """Execução síncrona."""
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(self._arun(question=question))
            finally:
                loop.close()
        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    async def _arun(self, question: str) -> str:
        """Execução ASYNC principal."""
        logger.info(f"[Store Policy] ❓ Pergunta: '{question}' para {self.store_url}")

        client = get_storefront_client(self.store_url)
        result = await client.search_policies(question=question)

        if not result.success:
            return json.dumps({
                "error": result.error,
                "type": "policy_search_error"
            }, ensure_ascii=False)

        return json.dumps({
            "question": question,
            "answer": result.answer,
            "sources": result.sources,
            "store": self.store_url.replace("https://", ""),
            "_ucp_metadata": {
                "type": "ucp_policy_answer",
                "store_url": self.store_url
            }
        }, ensure_ascii=False, indent=2)


# =========================================================
# Factory
# =========================================================

def create_storefront_tools(store_url: str, store_name: Optional[str] = None) -> list:
    """
    Cria tools de catálogo para uma loja específica.

    Args:
        store_url: URL da loja Shopify
        store_name: Nome amigável (opcional)

    Returns:
        Lista com StoreProductSearchTool e StorePolicySearchTool
    """
    return [
        StoreProductSearchTool(store_url=store_url, store_name=store_name),
        StorePolicySearchTool(store_url=store_url, store_name=store_name)
    ]
