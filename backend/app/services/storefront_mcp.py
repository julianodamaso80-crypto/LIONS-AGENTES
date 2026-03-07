"""
Storefront MCP Client - Busca de produtos em loja específica.

Cada loja Shopify expõe um endpoint MCP público:
  https://{store-domain}/api/mcp

Sem autenticação necessária!

Tools disponíveis:
- search_shop_catalog: Busca produtos na loja
- search_shop_policies_and_faqs: Perguntas sobre políticas

Referência: https://shopify.dev/docs/agents/catalog/storefront-mcp
"""

import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


# =========================================================
# Models
# =========================================================

class StorefrontProduct(BaseModel):
    """Produto retornado pela busca na loja."""
    id: str
    title: str
    description: Optional[str] = None
    vendor: Optional[str] = None
    product_type: Optional[str] = None
    handle: Optional[str] = None
    available: bool = True
    price: Optional[Dict[str, str]] = None  # {"amount": "99.00", "currency": "BRL"}
    image_url: Optional[str] = None
    image_alt: Optional[str] = None
    images: List[Dict[str, str]] = []
    variants: List[Dict[str, Any]] = []
    options: List[Dict[str, Any]] = []
    has_variants: bool = False


class StorefrontSearchResult(BaseModel):
    """Resultado de busca no catálogo da loja."""
    success: bool
    store_url: str
    query: str
    products: List[StorefrontProduct] = []
    total: int = 0
    error: Optional[str] = None


class PolicySearchResult(BaseModel):
    """Resultado de busca em políticas/FAQ."""
    success: bool
    store_url: str
    question: str
    answer: Optional[str] = None
    sources: List[str] = []
    error: Optional[str] = None


# =========================================================
# Storefront MCP Client
# =========================================================

class StorefrontMCPClient:
    """
    Cliente MCP para interagir com loja Shopify específica.

    Endpoint: https://{store-domain}/api/mcp
    Autenticação: Nenhuma (público)
    Protocolo: JSON-RPC 2.0 (MCP)
    """

    def __init__(self, store_url: str):
        """
        Args:
            store_url: URL da loja (ex: "102d14.myshopify.com")
        """
        self.store_url = self._normalize_store_url(store_url)
        self.mcp_endpoint = f"{self.store_url}/api/mcp"
        self._request_id = 0

    def _normalize_store_url(self, url: str) -> str:
        """Normaliza URL da loja."""
        url = url.strip().rstrip("/")
        if not url.startswith("http"):
            url = f"https://{url}"
        url = url.replace("http://", "https://")
        return url

    # http_client property removed - using transient clients per request

    def _next_request_id(self) -> int:
        """Gera próximo ID de request."""
        self._request_id += 1
        return self._request_id

    async def _call_mcp_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Chama uma tool MCP.

        Formato JSON-RPC 2.0:
        {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        }
        """
        request = {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        }

        logger.info(f"[Storefront MCP] Chamando {tool_name} em {self.store_url}")
        logger.debug(f"[Storefront MCP] Args: {json.dumps(arguments)}")

        try:
            # FIX: Use transient client to avoid "Event loop is closed" errors across requests
            async with httpx.AsyncClient(timeout=30.0, headers={
                "Content-Type": "application/json",
                "User-Agent": "Scale-Storefront-MCP/1.0"
            }) as client:
                response = await client.post(
                    self.mcp_endpoint,
                    json=request
                )

                if response.status_code != 200:
                    logger.error(f"[Storefront MCP] HTTP {response.status_code}: {response.text[:200]}")
                    return {"error": f"HTTP {response.status_code}"}

                data = response.json()

                # Verificar erro JSON-RPC
                if "error" in data:
                    error = data["error"]
                    logger.error(f"[Storefront MCP] MCP Error: {error}")
                    return {"error": error.get("message", str(error))}

                # Extrair resultado
                result = data.get("result", {})

                # MCP retorna content como array
                content = result.get("content", [])
                if content and isinstance(content, list):
                    for item in content:
                        if item.get("type") == "text":
                            try:
                                return json.loads(item.get("text", "{}"))
                            except json.JSONDecodeError:
                                return {"text": item.get("text")}

                return result

        except httpx.ConnectError as e:
            logger.error(f"[Storefront MCP] Connection error: {e}")
            return {"error": f"Não foi possível conectar à loja: {e}"}
        except httpx.TimeoutException:
            logger.error("[Storefront MCP] Timeout")
            return {"error": "Timeout ao conectar com a loja"}
        except Exception as e:
            logger.error(f"[Storefront MCP] Error: {e}")
            return {"error": str(e)}

    async def search_products(
        self,
        query: str,
        context: Optional[str] = None,
        limit: int = 10
    ) -> StorefrontSearchResult:
        """
        Busca produtos na loja.

        Args:
            query: Termo de busca (natural language)
            context: Contexto adicional sobre o cliente
            limit: Número máximo de resultados

        Returns:
            StorefrontSearchResult com produtos
        """
        # Tratamento de queries genéricas para retornar catálogo completo
        clean_query = query.strip().lower()
        generic_terms = [
            "todos os produtos", "all products", "todos", "lista de produtos",
            "catalogo", "catálogo", "ver tudo", "show all"
        ]

        # Se for termo genérico exato ou muito curto, usa query vazia
        if clean_query in generic_terms or (len(clean_query) < 3 and "tod" in clean_query):
            query = ""

        # Shopify MCP espera context como parâmetro obrigatório
        arguments = {
            "query": query,
            "context": context or "Customer searching for products"
        }

        result = await self._call_mcp_tool("search_shop_catalog", arguments)

        if "error" in result:
            return StorefrontSearchResult(
                success=False,
                store_url=self.store_url,
                query=query,
                error=result["error"]
            )

        # Parsear produtos do resultado
        products = []
        raw_products = result.get("products", result.get("results", []))

        for item in raw_products[:limit]:
            try:
                product = self._parse_product(item)
                products.append(product)
            except Exception as e:
                import traceback
                logger.debug(f"[Storefront MCP] Erro ao parsear produto: {e}")
                logger.debug(f"[Storefront MCP] Traceback: {traceback.format_exc()}")

        logger.info(f"[Storefront MCP] ✅ {len(products)} produtos encontrados para '{query}'")

        return StorefrontSearchResult(
            success=True,
            store_url=self.store_url,
            query=query,
            products=products,
            total=len(products)
        )

    async def search_policies(
        self,
        question: str
    ) -> PolicySearchResult:
        """
        Busca informações em políticas e FAQ da loja.

        Args:
            question: Pergunta sobre a loja (frete, devolução, etc.)

        Returns:
            PolicySearchResult com resposta
        """
        result = await self._call_mcp_tool(
            "search_shop_policies_and_faqs",
            {"query": question}
        )

        if "error" in result:
            return PolicySearchResult(
                success=False,
                store_url=self.store_url,
                question=question,
                error=result["error"]
            )

        return PolicySearchResult(
            success=True,
            store_url=self.store_url,
            question=question,
            answer=result.get("answer", result.get("text", str(result))),
            sources=result.get("sources", [])
        )

    def _parse_product(self, item: Dict[str, Any]) -> StorefrontProduct:
        """Parseia produto do formato Shopify Storefront MCP."""

        # ID: pode ser "product_id" ou "id"
        product_id = item.get("product_id", item.get("id", ""))

        # Preço: pode estar direto no item ou em variants
        price = None
        price_amount = item.get("price")
        price_currency = item.get("currency", "BRL")

        if price_amount:
            price = {"amount": str(price_amount), "currency": price_currency}
        else:
            # Fallback: tentar extrair de variants
            variants = item.get("variants", [])
            if variants:
                first_variant = variants[0] if isinstance(variants, list) else variants
                if isinstance(first_variant, dict):
                    if isinstance(first_variant.get("price"), dict):
                        price = {
                            "amount": str(first_variant["price"].get("amount", "0")),
                            "currency": first_variant["price"].get("currencyCode", "BRL")
                        }
                    else:
                        price = {
                            "amount": str(first_variant.get("price", "0")),
                            "currency": first_variant.get("currency", "BRL")
                        }

        # Imagem: pode estar em image_url, featured_image, images
        image_url = item.get("image_url") or item.get("featured_image")
        if not image_url:
            images_list = item.get("images", [])
            if images_list and isinstance(images_list, list):
                first_img = images_list[0]
                if isinstance(first_img, dict):
                    image_url = first_img.get("url", first_img.get("src"))
                elif isinstance(first_img, str):
                    image_url = first_img

        # Variant ID para checkout
        variant_id = item.get("variant_id")
        variants = item.get("variants", [])
        parsed_variants = []

        if variants and isinstance(variants, list):
            for v in variants:
                if isinstance(v, dict):
                    # Price pode ser dict ou string
                    v_price = v.get("price")
                    if isinstance(v_price, dict):
                        v_price_amount = str(v_price.get("amount", "0"))
                        v_price_currency = v_price.get("currencyCode", v.get("currency", "BRL"))
                    else:
                        v_price_amount = str(v_price) if v_price else "0"
                        v_price_currency = v.get("currency", "BRL")

                    parsed_variants.append({
                        "id": v.get("id", v.get("variant_id", "")),
                        "title": v.get("title", "Default"),
                        "available": v.get("available", v.get("availableForSale", True)),
                        "quantity_available": v.get("quantityAvailable"),
                        "price": {
                            "amount": v_price_amount,
                            "currency": v_price_currency
                        },
                        "selected_options": v.get("selectedOptions", v.get("selected_options", [])),
                        "image": v.get("image")
                    })
        elif variant_id:
            # Single variant from top-level
            parsed_variants.append({
                "id": variant_id,
                "title": "Default",
                "available": item.get("available", True),
                "price": price or {"amount": "0", "currency": "BRL"},
                "selected_options": []
            })

        # Options
        options = []
        for opt in item.get("options", []):
            if isinstance(opt, dict):
                options.append({
                    "name": opt.get("name", ""),
                    "values": opt.get("values", opt.get("optionValues", []))
                })

        return StorefrontProduct(
            id=str(product_id),
            title=item.get("title", ""),
            description=item.get("description", item.get("descriptionHtml", "")),
            vendor=item.get("vendor"),
            product_type=item.get("productType", item.get("product_type")),
            handle=item.get("handle"),
            available=item.get("available", item.get("availableForSale", True)),
            price=price,
            image_url=image_url,
            image_alt=item.get("image_alt"),
            images=[{"url": image_url, "alt": ""}] if image_url else [],
            variants=parsed_variants,
            options=options,
            has_variants=len(parsed_variants) > 1
        )

    async def close(self) -> None:
        """Fecha recursos (No-op com clientes transientes)."""
        pass


# =========================================================
# Factory / Cache
# =========================================================

_clients: Dict[str, StorefrontMCPClient] = {}


def get_storefront_client(store_url: str) -> StorefrontMCPClient:
    """
    Retorna cliente MCP para uma loja (com cache).

    Args:
        store_url: URL da loja

    Returns:
        StorefrontMCPClient configurado
    """
    # Normalizar URL
    normalized = store_url.strip().rstrip("/")
    if not normalized.startswith("http"):
        normalized = f"https://{normalized}"
    normalized = normalized.replace("http://", "https://")

    if normalized not in _clients:
        _clients[normalized] = StorefrontMCPClient(normalized)

    return _clients[normalized]
