"""
UCP Tool Factory - Gera tools LangChain DINAMICAMENTE a partir do manifest UCP.

IMPORTANTE: Esta versão NÃO usa definições hardcoded.
As tools são geradas a partir das capabilities declaradas no manifest da loja.

Se a loja declarar "dev.ucp.shopping.checkout", o Scale AI cria a tool automaticamente.
Se a loja declarar uma capability customizada, também seremos capazes de usá-la.

Referência: https://ucp.dev/specification/overview/
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, create_model

from app.schemas.ucp_manifest import UCPCapability, UCPManifest
from app.services.ucp_transport import (
    UCPTransportClient,
    create_transport_client,
)

logger = logging.getLogger(__name__)


# =========================================================
# Dynamic Input Schema Generation
# =========================================================

class GenericUCPInput(BaseModel):
    """
    Schema genérico para capabilities UCP.

    Usado quando não temos schema específico da capability.
    Aceita qualquer parâmetro como kwargs.
    """
    query: Optional[str] = Field(
        default=None,
        description="Termo de busca ou consulta"
    )
    item_id: Optional[str] = Field(
        default=None,
        description="ID do item (produto, pedido, etc.)"
    )
    variant_id: Optional[str] = Field(
        default=None,
        description="ID da variante do produto (Shopify variant GID)"
    )
    quantity: Optional[int] = Field(
        default=1,
        description="Quantidade do item"
    )
    session_id: Optional[str] = Field(
        default=None,
        description="ID da sessão UCP (para operações multi-step)"
    )
    line_items: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Lista de itens para checkout. Formato: [{'quantity': 1, 'item': {'id': 'variant_id'}}]"
    )
    buyer_email: Optional[str] = Field(
        default=None,
        description="Email do comprador"
    )
    extra_params: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Parâmetros adicionais específicos da capability"
    )


def create_input_schema_from_json_schema(
    schema: Dict[str, Any],
    capability_name: str
) -> Type[BaseModel]:
    """
    Gera um Pydantic model a partir de um JSON Schema.

    Isso permite que qualquer capability com schema seja usável.
    """
    if not schema or "properties" not in schema:
        return GenericUCPInput

    properties = schema.get("properties", {})
    required = schema.get("required", [])

    # Mapear tipos JSON Schema -> Python
    # NOTA: Gemini exige 'items' type em arrays. Usamos List[str] como
    # fallback seguro para arrays e Dict[str, str] para objects.
    type_mapping = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": List[str],
        "object": Dict[str, str]
    }

    # Construir campos do modelo
    fields = {}
    for name, prop in properties.items():
        prop_type = prop.get("type", "string")
        python_type = type_mapping.get(prop_type, str)
        description = prop.get("description", f"Parameter: {name}")
        default = prop.get("default")

        if name in required:
            # Campo obrigatório
            if default is not None:
                fields[name] = (python_type, Field(default=default, description=description))
            else:
                fields[name] = (python_type, Field(..., description=description))
        else:
            # Campo opcional
            optional_type = Optional[python_type]
            fields[name] = (optional_type, Field(default=default, description=description))

    if not fields:
        return GenericUCPInput

    # Gerar nome único para o modelo
    model_name = f"UCP{capability_name.replace('.', '_').title()}Input"

    try:
        return create_model(model_name, **fields)
    except Exception as e:
        logger.warning(f"[UCP Factory] Erro ao criar schema dinâmico: {e}")
        return GenericUCPInput


# =========================================================
# Dynamic UCP Tool
# =========================================================

class DynamicUCPTool(BaseTool):
    """
    Tool LangChain que executa capabilities UCP.

    Criada dinamicamente a partir do manifest da loja.
    Não depende de nenhum provider específico (Shopify, etc.).
    """

    name: str
    description: str
    args_schema: Type[BaseModel] = GenericUCPInput

    # Metadata UCP
    ucp_capability: str  # "dev.ucp.shopping.checkout"
    store_url: str
    transport_type: str = "rest"

    # Privados (não serializados)
    _transport_client: Optional[UCPTransportClient] = None
    _manifest: Optional[UCPManifest] = None

    class Config:
        arbitrary_types_allowed = True
        underscore_attrs_are_private = True

    def _run(self, **kwargs) -> str:
        """Execução síncrona (fallback para async)."""
        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(self._run_in_new_loop, kwargs)
                    return future.result(timeout=65)
            else:
                return self._run_in_new_loop(kwargs)
        except Exception as e:
            logger.error(f"[UCP Tool] Sync error: {e}")
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    def _run_in_new_loop(self, kwargs: dict) -> str:
        """Executa em novo event loop."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._arun(**kwargs))
        finally:
            loop.close()

    async def _arun(self, **kwargs) -> str:
        """Execução ASYNC principal."""
        logger.info(f"[UCP Tool] 🛒 Executando {self.name} para {self.store_url}")

        try:
            # Obter transport client
            transport = await self._get_transport_client()
            if not transport:
                return json.dumps({
                    "error": "Não foi possível conectar à loja",
                    "type": "transport_error"
                }, ensure_ascii=False)

            # Determinar método (último segmento da capability ou default)
            # dev.ucp.shopping.checkout -> checkout
            parts = self.ucp_capability.split(".")
            capability_action = parts[-1] if parts else self.ucp_capability

            # Preparar parâmetros
            params = self._prepare_params(kwargs)

            # Chamar capability via transport
            result = await transport.call_capability(
                capability=self.ucp_capability,
                method="execute",  # Método padrão
                params=params
            )

            # Verificar erros
            if result.get("error"):
                return json.dumps(result, ensure_ascii=False)

            # Adicionar metadata UCP para frontend
            result["_ucp_metadata"] = {
                "type": self._determine_response_type(capability_action),
                "capability": self.ucp_capability,
                "store_url": self.store_url
            }

            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[UCP Tool] Error: {e}")
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    async def _get_transport_client(self) -> Optional[UCPTransportClient]:
        """Obtém ou cria transport client."""
        if self._transport_client:
            return self._transport_client

        if not self._manifest:
            # Precisamos descobrir o manifest
            from app.services.ucp_discovery import get_ucp_discovery_service
            discovery = get_ucp_discovery_service()
            result = await discovery.discover(self.store_url)

            if not result.success or not result.manifest:
                logger.error(f"[UCP Tool] Falha no discovery: {result.error}")
                return None

            self._manifest = result.manifest

        # Criar transport
        self._transport_client = create_transport_client(
            manifest=self._manifest,
            preferred_transport=self.transport_type
        )

        return self._transport_client

    def _prepare_params(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Prepara parâmetros para a chamada.

        Para checkout, converte variant_id/quantity para line_items Shopify.
        """
        params = {}

        for key, value in kwargs.items():
            if value is not None:
                # Expandir extra_params se presente
                if key == "extra_params" and isinstance(value, dict):
                    params.update(value)
                else:
                    params[key] = value

        # 🔥 FIX: Se for checkout e tiver variant_id, converter para line_items
        # Formato Shopify: line_items: [{"quantity": 1, "item": {"id": "gid://..."}}]
        if self.ucp_capability.endswith("checkout"):
            variant_id = params.pop("variant_id", None) or params.pop("item_id", None)
            quantity = params.pop("quantity", 1) or 1
            buyer_email = params.pop("buyer_email", None)

            # Construir line_items se variant_id fornecido e line_items não presente
            if variant_id and "line_items" not in params:
                params["line_items"] = [{
                    "quantity": quantity,
                    "item": {"id": variant_id}
                }]
                logger.info(f"[UCP Tool] Auto-converted variant_id to line_items: {variant_id}")

            # Adicionar buyer se email fornecido
            if buyer_email and "buyer" not in params:
                params["buyer"] = {"email": buyer_email}

            # Adicionar currency default se não presente
            if "currency" not in params:
                params["currency"] = "BRL"

            # 🔥 FIX: Adicionar _meta obrigatório para checkout (conforme documentação Shopify)
            # https://shopify.dev/docs/agents/get-started/complete-checkout
            if "_meta" not in params:
                params["_meta"] = {
                    "ucp": {
                        "profile": "https://agent.scale.ai/profiles/shopping-agent.json"
                    }
                }
                logger.info("[UCP Tool] Added _meta.ucp.profile to checkout params")

        return params

    def _determine_response_type(self, action: str) -> str:
        """Determina tipo de resposta para renderização no frontend."""
        if action in ["checkout", "cart", "payment"]:
            return "ucp_checkout"
        elif action in ["catalog", "search", "products"]:
            return "ucp_product_list"
        elif action in ["product", "item", "detail"]:
            return "ucp_product_detail"
        elif action in ["order", "fulfillment", "tracking"]:
            return "ucp_order"
        else:
            return "ucp_generic"


# =========================================================
# UCP Tool Factory
# =========================================================

class UCPToolFactory:
    """
    Factory que cria tools LangChain DINAMICAMENTE a partir do manifest UCP.

    Não possui definições hardcoded. Toda informação vem do manifest.
    """

    @staticmethod
    async def create_tools_from_manifest(
        store_url: str,
        manifest: UCPManifest,
        preferred_transport: Optional[str] = None,
        schema_cache: Optional[Dict[str, Dict]] = None
    ) -> List[BaseTool]:
        """
        Cria tools a partir das capabilities do manifest.

        Args:
            store_url: URL da loja
            manifest: Manifest UCP parseado
            preferred_transport: Transport preferido (mcp, rest, a2a)
            schema_cache: Cache de schemas já baixados

        Returns:
            Lista de DynamicUCPTool prontas para uso
        """
        tools = []
        transport = preferred_transport or manifest.get_preferred_transport() or "rest"

        capabilities = manifest.get_capabilities()

        if not capabilities:
            logger.warning(f"[UCP Factory] Nenhuma capability no manifest de {store_url}")
            return []

        logger.info(f"[UCP Factory] Criando tools para {len(capabilities)} capabilities")

        for capability in capabilities:
            try:
                tool = await UCPToolFactory._create_tool_from_capability(
                    capability=capability,
                    store_url=store_url,
                    transport_type=transport,
                    schema_cache=schema_cache
                )
                if tool:
                    tools.append(tool)
            except Exception as e:
                logger.error(f"[UCP Factory] Erro ao criar tool para {capability.name}: {e}")

        # =========================================================
        # STOREFRONT MCP: Adicionar tools de busca de produtos
        # =========================================================
        # Sempre adicionar Storefront tools para busca de produtos/políticas
        # (funciona sem autenticação via {store}/api/mcp)
        try:
            from app.agents.tools.storefront_catalog_tool import create_storefront_tools

            # Extrair nome amigável da loja
            store_name = store_url.replace("https://", "").split(".")[0]

            storefront_tools = create_storefront_tools(
                store_url=store_url,
                store_name=store_name
            )
            tools.extend(storefront_tools)

            logger.info(f"[UCP Factory] ✅ +{len(storefront_tools)} Storefront tools adicionadas")
        except Exception as e:
            logger.warning(f"[UCP Factory] Erro ao criar Storefront tools: {e}")

        logger.info(f"[UCP Factory] ✅ {len(tools)} tools criadas para {store_url}")
        return tools

    @staticmethod
    async def _create_tool_from_capability(
        capability: UCPCapability,
        store_url: str,
        transport_type: str,
        schema_cache: Optional[Dict[str, Dict]] = None
    ) -> Optional[DynamicUCPTool]:
        """Cria uma DynamicUCPTool a partir de uma capability."""

        # Obter schema se disponível
        input_schema = GenericUCPInput

        if capability.schema_url:
            # Tentar buscar schema
            if schema_cache and capability.schema_url in schema_cache:
                schema = schema_cache[capability.schema_url]
            else:
                from app.services.ucp_discovery import get_ucp_discovery_service
                discovery = get_ucp_discovery_service()
                schema = await discovery.get_capability_schema(capability)

                if schema and schema_cache is not None:
                    schema_cache[capability.schema_url] = schema

            if schema:
                input_schema = create_input_schema_from_json_schema(
                    schema=schema,
                    capability_name=capability.name
                )

        # Construir descrição
        description = UCPToolFactory._build_description(capability, store_url)

        return DynamicUCPTool(
            name=capability.tool_name,
            description=description,
            args_schema=input_schema,
            ucp_capability=capability.name,
            store_url=store_url,
            transport_type=transport_type
        )

    @staticmethod
    def _build_description(capability: UCPCapability, store_url: str) -> str:
        """Constrói descrição da tool para o LLM."""
        # Mapear capabilities conhecidas para descrições melhores
        descriptions = {
            "checkout": f"Cria sessão de checkout para comprar itens da loja {store_url}",
            "catalog": f"Busca produtos no catálogo da loja {store_url}",
            "fulfillment": f"Consulta status de entrega e rastreamento em {store_url}",
            "order": f"Consulta informações de pedidos em {store_url}",
            "discount": f"Aplica cupons de desconto em {store_url}",
            "identity": f"Vincula identidade do usuário com {store_url}",
        }

        # Extrair ação da capability
        action = capability.short_name.split("_")[-1]

        if action in descriptions:
            return descriptions[action]

        # Descrição genérica
        return f"Executa capability UCP '{capability.name}' na loja {store_url}"


    @staticmethod
    async def create_tools_for_agent(agent_id: str) -> List[BaseTool]:
        """
        Cria todas as tools UCP (incluindo Storefront) para um agente.
        Carrega conexões ativas do banco de dados.
        """
        try:
            from app.services.ucp_discovery import get_ucp_discovery_service

            discovery = get_ucp_discovery_service()
            discoveries = await discovery.load_from_database(agent_id)

            tools = []
            for result in discoveries:
                if result.manifest:
                    # Cria tools para esta conexão (UCP + Storefront)
                    conn_tools = await UCPToolFactory.create_tools_from_manifest(
                        store_url=result.store_url,
                        manifest=result.manifest,
                        preferred_transport=result.preferred_transport
                    )
                    tools.extend(conn_tools)

            return tools
        except Exception as e:
            logger.error(f"[UCP Factory] Erro ao criar tools para agente {agent_id}: {e}")
            return []


# =========================================================
# Helpers para Prompt Editor
# =========================================================

def get_ucp_tools_for_prompt(manifest: UCPManifest, store_url: str) -> List[Dict[str, Any]]:
    """
    Formata tools UCP para o dropdown de variáveis do frontend.

    Inclui:
    - Capabilities do manifest (checkout, fulfillment, etc.)
    - Storefront MCP tools (busca de produtos, políticas)
    """
    tools_info = []
    store_name = store_url.replace("https://", "").split(".")[0]

    # 1. Capabilities do manifest UCP
    for capability in manifest.get_capabilities():
        tools_info.append({
            "name": capability.tool_name,
            "description": f"UCP: {capability.name}",
            "type": "ucp",
            "capability": capability.name,
            "version": capability.version,
            "store": store_url,
            "is_extension": capability.is_extension
        })

    # 2. Storefront MCP Tools (busca de produtos - sempre disponível)
    tools_info.append({
        "name": "store_product_search",
        "description": f"Busca produtos na loja {store_name}",
        "type": "storefront",
        "capability": "storefront.catalog",
        "store": store_url,
        "is_extension": False
    })

    tools_info.append({
        "name": "store_policy_search",
        "description": f"Perguntas sobre políticas da loja {store_name}",
        "type": "storefront",
        "capability": "storefront.policies",
        "store": store_url,
        "is_extension": False
    })

    return tools_info


async def get_all_ucp_tools_for_agent(agent_id: str) -> List[Dict[str, Any]]:
    """
    Retorna todas as tools UCP disponíveis para um agente.

    Carrega do banco de dados e formata para o prompt editor.
    """
    from app.services.ucp_discovery import get_ucp_discovery_service

    discovery = get_ucp_discovery_service()
    discoveries = await discovery.load_from_database(agent_id)

    all_tools = []
    for result in discoveries:
        if result.manifest:
            tools = get_ucp_tools_for_prompt(result.manifest, result.store_url)
            all_tools.extend(tools)

    return all_tools
