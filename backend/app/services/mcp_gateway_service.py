"""
MCP Gateway Service - Executa MCP Servers INTERNOS.
Usa servidores Python próprios em vez de pacotes npm de terceiros.
"""

import asyncio
import json
import logging
import os
import re
import sys
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Padrões de dados sensíveis para redacionar nos logs
_SENSITIVE_PATTERNS = [
    (re.compile(r'"access_token"\s*:\s*"[^"]+"', re.IGNORECASE), '"access_token": "[REDACTED]"'),
    (re.compile(r'"refresh_token"\s*:\s*"[^"]+"', re.IGNORECASE), '"refresh_token": "[REDACTED]"'),
    (re.compile(r'Bearer\s+[A-Za-z0-9\-_\.]+', re.IGNORECASE), 'Bearer [REDACTED]'),
    (re.compile(r'Authorization:\s*[^\s,}]+', re.IGNORECASE), 'Authorization: [REDACTED]'),
]


def _sanitize_for_log(data: str) -> str:
    """
    Remove ou mascara dados sensíveis antes de enviar para logs.
    Protege tokens, credenciais e headers de autorização.
    """
    result = data
    for pattern, replacement in _SENSITIVE_PATTERNS:
        result = pattern.sub(replacement, result)
    return result


class MCPGatewayService:
    """Gateway para MCP Servers INTERNOS."""

    def __init__(self, supabase_client=None):
        self.supabase = supabase_client
        self._encryption_service = None

        # Mapeamento servidor -> módulo Python
        self.internal_servers = {
            "google-calendar": "app.mcp_servers.google_calendar_server",
            "google-drive": "app.mcp_servers.google_drive_server",
            "slack": "app.mcp_servers.slack_server",
            "github": "app.mcp_servers.github_server",
        }

    @property
    def encryption(self):
        if self._encryption_service is None:
            from .encryption_service import get_encryption_service
            self._encryption_service = get_encryption_service()
        return self._encryption_service

    def _get_supabase(self):
        if self.supabase is None:
            from ..core.database import get_supabase_client
            self.supabase = get_supabase_client().client
        return self.supabase

    def _get_command(self, server_name: str) -> List[str]:
        """Retorna comando para executar servidor interno."""
        module = self.internal_servers.get(server_name)
        if not module:
            raise ValueError(f"Servidor '{server_name}' não suportado")
        return [sys.executable, "-m", module]

    def _build_env(self, server_name: str, tokens: Optional[Dict] = None) -> Dict[str, str]:
        """Constrói variáveis de ambiente para o servidor."""
        env = dict(os.environ)

        # PYTHONPATH para encontrar módulos
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        env["PYTHONPATH"] = backend_dir

        if tokens and tokens.get("access_token"):
            token = tokens["access_token"]
            if "google" in server_name:
                env["GOOGLE_ACCESS_TOKEN"] = token
            elif "slack" in server_name:
                env["SLACK_ACCESS_TOKEN"] = token
            elif "github" in server_name:
                env["GITHUB_ACCESS_TOKEN"] = token

        return env

    async def discover_server_tools(self, server_name: str, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Descobre tools de um servidor MCP interno."""
        logger.info(f"[MCP Gateway] 🔍 Descobrindo tools: {server_name}")

        if server_name not in self.internal_servers:
            return {"success": False, "error": f"Servidor '{server_name}' não suportado"}

        server_config = await self._get_server_config(server_name)
        if not server_config:
            return {"success": False, "error": f"Servidor '{server_name}' não encontrado"}

        # Buscar tokens se necessário
        tokens = None
        if server_config.get("oauth_provider") and agent_id:
            from .mcp_oauth_service import get_mcp_oauth_service
            tokens = await get_mcp_oauth_service().get_agent_oauth_tokens(agent_id, server_config["id"])
            if not tokens:
                return {
                    "success": False,
                    "error": f"Conecte sua conta {server_config['oauth_provider']} primeiro",
                    "requires_oauth": True
                }

        request = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        result = await self._execute_request(
            self._get_command(server_name),
            request,
            self._build_env(server_name, tokens)
        )

        if result.get("success"):
            tools = result.get("result", {}).get("tools", [])
            logger.info(f"[MCP Gateway] ✅ {len(tools)} tools em '{server_name}'")
            return {"success": True, "server_name": server_name, "tools": tools}
        return result

    async def enable_server_for_agent(
        self,
        agent_id: str,
        mcp_server_id: str,
        company_id: str
    ) -> Dict[str, Any]:
        """Habilita servidor MCP para um agente."""
        supabase = self._get_supabase()

        # Validação de segurança: verificar se o agente pertence à empresa (defesa em profundidade)
        agent_check = supabase.table("agents") \
            .select("id") \
            .eq("id", agent_id) \
            .eq("company_id", company_id) \
            .single() \
            .execute()

        if not agent_check.data:
            logger.warning(f"[MCP Gateway] Tentativa de habilitar server para agent {agent_id} com company_id inválido {company_id}")
            return {"success": False, "error": "Agente não pertence a esta empresa"}

        server_result = supabase.table("mcp_servers") \
            .select("*") \
            .eq("id", mcp_server_id) \
            .single() \
            .execute()

        if not server_result.data:
            return {"success": False, "error": "Servidor não encontrado"}

        server = server_result.data
        discovery = await self.discover_server_tools(server["name"], agent_id)

        if not discovery.get("success"):
            return discovery

        tools = discovery.get("tools", [])
        if not tools:
            return {"success": False, "error": "Nenhuma tool encontrada"}

        enabled_tools = []
        for tool in tools:
            tool_name = tool.get("name", "")
            variable_name = f"mcp_{server['name'].replace('-', '_')}_{tool_name}"

            tool_data = {
                "agent_id": agent_id,
                "mcp_server_id": mcp_server_id,
                "mcp_server_name": server["name"],
                "tool_name": tool_name,
                "variable_name": variable_name,
                "description": tool.get("description", ""),
                "input_schema": tool.get("inputSchema", {}),
                "is_enabled": True
            }

            try:
                supabase.table("agent_mcp_tools").upsert(
                    tool_data,
                    on_conflict="agent_id,mcp_server_id,tool_name"
                ).execute()

                enabled_tools.append({
                    "variable_name": variable_name,
                    "tool_name": tool_name
                })
            except Exception as e:
                logger.error(f"[MCP Gateway] Erro ao salvar tool {tool_name}: {e}")

        logger.info(f"[MCP Gateway] ✅ {len(enabled_tools)} tools habilitadas")
        return {
            "success": True,
            "server_name": server["name"],
            "enabled_tools": enabled_tools
        }

    async def disable_server_for_agent(
        self,
        agent_id: str,
        mcp_server_id: str
    ) -> Dict[str, Any]:
        """Remove tools de um servidor para um agente."""
        try:
            self._get_supabase().table("agent_mcp_tools") \
                .delete() \
                .eq("agent_id", agent_id) \
                .eq("mcp_server_id", mcp_server_id) \
                .execute()
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_agent_mcp_tools(self, agent_id: str) -> List[Dict]:
        """Retorna tools MCP habilitadas para um agente."""
        try:
            result = self._get_supabase().table("agent_mcp_tools") \
                .select("*") \
                .eq("agent_id", agent_id) \
                .eq("is_enabled", True) \
                .execute()
            return result.data or []
        except Exception as e:
            logger.error(f"[MCP Gateway] Erro ao buscar MCP tools do agente: {e}")
            return []

    async def call_mcp_tool(
        self,
        agent_id: str,
        mcp_server_name: str,
        tool_name: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Executa uma tool de um servidor MCP interno."""
        logger.info(f"[MCP Gateway] 🔗 {mcp_server_name}.{tool_name}")

        if mcp_server_name not in self.internal_servers:
            return {"success": False, "error": f"Servidor '{mcp_server_name}' não suportado"}

        server_config = await self._get_server_config(mcp_server_name)
        if not server_config:
            return {"success": False, "error": "Servidor não encontrado"}

        tokens = None
        if server_config.get("oauth_provider"):
            from .mcp_oauth_service import get_mcp_oauth_service
            tokens = await get_mcp_oauth_service().get_agent_oauth_tokens(
                agent_id,
                server_config["id"]
            )
            if not tokens:
                return {
                    "success": False,
                    "error": f"Conta {server_config['oauth_provider']} não conectada"
                }

        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": params}
        }

        return await self._execute_request(
            self._get_command(mcp_server_name),
            request,
            self._build_env(mcp_server_name, tokens)
        )

    async def get_available_servers(self) -> List[Dict]:
        """Lista servidores MCP disponíveis."""
        try:
            result = self._get_supabase().table("mcp_servers") \
                .select("id, name, display_name, description, oauth_provider") \
                .eq("is_active", True) \
                .execute()
            return result.data or []
        except Exception as e:
            logger.error(f"[MCP Gateway] Erro ao listar servidores disponíveis: {e}")
            return []

    async def _get_server_config(self, server_name: str) -> Optional[Dict]:
        """Busca configuração de um servidor."""
        try:
            result = self._get_supabase().table("mcp_servers") \
                .select("*") \
                .eq("name", server_name) \
                .eq("is_active", True) \
                .single() \
                .execute()
            return result.data
        except Exception as e:
            logger.warning(f"[MCP Gateway] Servidor '{server_name}' não encontrado: {e}")
            return None

    async def _execute_request(
        self,
        command: List[str],
        request: Dict,
        env: Dict[str, str],
        timeout: int = 60
    ) -> Dict[str, Any]:
        """Executa request MCP via subprocess."""
        # Log sanitizado do comando (sem expor tokens no ambiente)
        logger.info(f"[MCP Gateway] 📤 Comando: {' '.join(command)}")
        safe_request = _sanitize_for_log(json.dumps(request)[:200])
        logger.info(f"[MCP Gateway] 📤 Request: {safe_request}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=json.dumps(request).encode()),
                timeout=timeout
            )

            stdout_str = stdout.decode() if stdout else ""
            stderr_str = stderr.decode() if stderr else ""

            logger.info(f"[MCP Gateway] 📥 Return code: {proc.returncode}")
            # Log sanitizado do stdout
            safe_stdout = _sanitize_for_log(stdout_str[:500])
            logger.info(f"[MCP Gateway] 📥 Stdout: {safe_stdout}")
            if stderr_str:
                safe_stderr = _sanitize_for_log(stderr_str[:500])
                logger.warning(f"[MCP Gateway] 📥 Stderr: {safe_stderr}")

            if proc.returncode != 0:
                error_msg = stderr_str[:500] if stderr_str else "Unknown error"
                safe_error = _sanitize_for_log(error_msg)
                logger.error(f"[MCP Gateway] ❌ Process error: {safe_error}")
                return {"success": False, "error": error_msg}

            if not stdout_str:
                logger.error("[MCP Gateway] ❌ Empty stdout")
                return {"success": False, "error": "Empty response from MCP server"}

            response = json.loads(stdout_str)
            safe_response = _sanitize_for_log(json.dumps(response)[:300])
            logger.info(f"[MCP Gateway] 📥 Response: {safe_response}")

            if "error" in response:
                error_msg = response["error"].get("message", str(response["error"]))
                logger.error(f"[MCP Gateway] ❌ MCP error: {error_msg}")
                return {"success": False, "error": error_msg}

            logger.info("[MCP Gateway] ✅ Success")
            return {"success": True, "result": response.get("result", {})}

        except asyncio.TimeoutError:
            logger.error(f"[MCP Gateway] ❌ Timeout ({timeout}s)")
            return {"success": False, "error": f"Timeout ({timeout}s)"}
        except json.JSONDecodeError as e:
            logger.error(f"[MCP Gateway] ❌ JSON decode error: {e}")
            return {"success": False, "error": f"Invalid JSON response: {str(e)}"}
        except Exception as e:
            logger.error(f"[MCP Gateway] ❌ Error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}


_mcp_gateway: Optional[MCPGatewayService] = None


def get_mcp_gateway() -> MCPGatewayService:
    global _mcp_gateway
    if _mcp_gateway is None:
        _mcp_gateway = MCPGatewayService()
    return _mcp_gateway
