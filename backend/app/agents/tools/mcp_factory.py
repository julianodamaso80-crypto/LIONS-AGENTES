"""
MCP Tool Factory - Cria tools dinâmicas a partir das configurações do banco.

Similar ao create_dynamic_tool do http_request.py, mas para MCP.
Cada tool MCP se torna uma tool LangChain individual com schema tipado.
"""

import asyncio
import json
import logging
from typing import Dict, List, Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, create_model

logger = logging.getLogger(__name__)


class DynamicMCPTool(BaseTool):
    """
    Tool dinâmica que executa uma tool específica de um MCP Server.
    Criada em runtime pelo MCPToolFactory.
    """

    name: str
    description: str
    args_schema: Type[BaseModel]

    # Metadata MCP
    mcp_server_name: str
    mcp_tool_name: str
    agent_id: str

    class Config:
        arbitrary_types_allowed = True

    def _run(self, **kwargs) -> str:
        """Execução síncrona (fallback)."""
        try:
            # Tentar obter loop existente
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                # Loop rodando - usar thread com novo loop
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(self._run_in_new_loop, kwargs)
                    return future.result(timeout=65)
            else:
                # Sem loop ou loop não está rodando - criar um
                return self._run_in_new_loop(kwargs)
        except Exception as e:
            logger.error(f"[MCP Tool] Sync error: {e}")
            return f"❌ Erro: {str(e)}"

    def _run_in_new_loop(self, kwargs: dict) -> str:
        """Executa em um novo event loop."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self._arun(**kwargs))
        finally:
            loop.close()

    async def _arun(self, **kwargs) -> str:
        """Execução ASYNC (método principal)."""
        logger.info(f"[MCP Tool] 🔗 {self.mcp_server_name}.{self.mcp_tool_name}")

        from ...services.mcp_gateway_service import get_mcp_gateway

        gateway = get_mcp_gateway()
        result = await gateway.call_mcp_tool(
            agent_id=self.agent_id,
            mcp_server_name=self.mcp_server_name,
            tool_name=self.mcp_tool_name,
            params=kwargs
        )

        if result.get("success"):
            data = result.get("result", {})
            if isinstance(data, dict):
                return json.dumps(data, ensure_ascii=False, indent=2)
            return str(data)
        else:
            return f"❌ Erro: {result.get('error', 'Erro desconhecido')}"


class MCPToolFactory:
    """
    Factory que cria tools LangChain a partir das configurações MCP do banco.
    """

    @staticmethod
    def create_tools_for_agent(
        agent_id: str,
        mcp_tools_config: List[Dict]
    ) -> List[BaseTool]:
        """
        Cria lista de DynamicMCPTool a partir das configs do banco.

        Args:
            agent_id: ID do agente
            mcp_tools_config: Lista de configs de agent_mcp_tools

        Returns:
            Lista de tools LangChain prontas para usar
        """
        tools = []

        for config in mcp_tools_config:
            try:
                tool = MCPToolFactory._create_single_tool(config, agent_id)
                if tool:
                    tools.append(tool)
            except Exception as e:
                logger.error(f"[MCP Factory] Erro ao criar tool: {e}")

        logger.info(f"[MCP Factory] ✅ Criadas {len(tools)} tools MCP para agente {agent_id}")
        return tools

    @staticmethod
    def _create_single_tool(config: Dict, agent_id: str) -> Optional[DynamicMCPTool]:
        """Cria uma única DynamicMCPTool a partir da config."""

        variable_name = config.get("variable_name", "")
        tool_name = config.get("tool_name", "")
        server_name = config.get("mcp_server_name", "")
        description = config.get("description", f"Executa {tool_name} via MCP")
        input_schema = config.get("input_schema", {})

        if not variable_name or not tool_name or not server_name:
            logger.warning(f"[MCP Factory] Config incompleta: {config}")
            return None

        # Criar Pydantic model dinamicamente a partir do input_schema
        InputModel = MCPToolFactory._create_input_model(variable_name, input_schema)

        return DynamicMCPTool(
            name=variable_name,
            description=description,
            args_schema=InputModel,
            mcp_server_name=server_name,
            mcp_tool_name=tool_name,
            agent_id=agent_id,
        )

    @staticmethod
    def _create_input_model(tool_name: str, schema: Dict) -> Type[BaseModel]:
        """
        Cria um Pydantic model a partir do JSON Schema do MCP.
        """
        if not schema or not isinstance(schema, dict):
            # Schema vazio: tool sem parâmetros
            return create_model(f"{tool_name}_Input")

        properties = schema.get("properties", {})
        required = schema.get("required", [])

        fields = {}
        for prop_name, prop_schema in properties.items():
            # Mapear tipo JSON Schema -> Python (passa schema completo para arrays)
            python_type = MCPToolFactory._json_type_to_python(prop_schema)

            description = prop_schema.get("description", "")
            default = ... if prop_name in required else None

            fields[prop_name] = (
                python_type if prop_name in required else Optional[python_type],
                Field(default=default, description=description)
            )

        if not fields:
            return create_model(f"{tool_name}_Input")

        return create_model(f"{tool_name}_Input", **fields)

    @staticmethod
    def _json_type_to_python(prop_schema):
        """Mapeia tipo JSON Schema para tipo Python.
        
        Para arrays, resolve o tipo interno via 'items' para que
        o Pydantic gere JSON Schema com 'items' (exigido pelo Gemini).
        """
        # Aceita string legada ou dict completo
        if isinstance(prop_schema, str):
            json_type = prop_schema
            prop_schema = {}
        else:
            json_type = prop_schema.get("type", "string")

        base_mapping = {
            "string": str,
            "integer": int,
            "number": float,
            "boolean": bool,
            "object": dict,
        }

        if json_type == "array":
            items_schema = prop_schema.get("items", {})
            items_type = items_schema.get("type", "string") if isinstance(items_schema, dict) else "string"
            inner = base_mapping.get(items_type, str)
            return List[inner]

        return base_mapping.get(json_type, str)


def get_mcp_tools_for_prompt(agent_mcp_tools: List[Dict]) -> List[Dict]:
    """
    Formata MCP tools para o dropdown de variáveis do frontend.
    Retorna no mesmo formato das HTTP tools.
    """
    return [
        {
            "name": tool["variable_name"],
            "description": tool.get("description", ""),
            "type": "mcp",
            "mcp_server": tool.get("mcp_server_name", ""),
            "parameters": _extract_parameters(tool.get("input_schema", {}))
        }
        for tool in agent_mcp_tools
    ]


def _extract_parameters(schema: Dict) -> List[Dict]:
    """Extrai parâmetros do JSON Schema para exibição."""
    if not schema:
        return []

    properties = schema.get("properties", {})
    required = schema.get("required", [])

    params = []
    for name, prop in properties.items():
        params.append({
            "name": name,
            "type": prop.get("type", "string"),
            "description": prop.get("description", ""),
            "required": name in required
        })

    return params
