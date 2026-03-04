'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Plug,
  CheckCircle,
  XCircle,
  RefreshCw,
  Info,
  Link,
  Unlink,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface MCPServer {
  id: string;
  name: string;
  display_name: string;
  description: string;
  oauth_provider: string | null;
  provider_configured?: boolean;
  is_enabled?: boolean;
  is_connected?: boolean;
  enabled_tools?: number;
}

interface MCPConnection {
  id: string;
  mcp_server_id: string;
  is_connected: boolean;
  connected_at: string;
  mcp_server?: {
    name: string;
    display_name: string;
    oauth_provider: string;
  };
}

interface Props {
  agentId: string;
  companyId: string;
}

export function MCPConfigTab({ agentId, companyId }: Props) {
  const [loading, setLoading] = useState(true);
  const [availableServers, setAvailableServers] = useState<MCPServer[]>([]);
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [enabledTools, setEnabledTools] = useState<any[]>([]);
  const [enablingServer, setEnablingServer] = useState<string | null>(null);
  const [disablingServer, setDisablingServer] = useState<string | null>(null);
  const [connectingServer, setConnectingServer] = useState<string | null>(null);
  const [disconnectingServer, setDisconnectingServer] = useState<string | null>(null);

  const { toast } = useToast();
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // Listener para mensagens do popup OAuth
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MCP_OAUTH_SUCCESS') {
        toast({
          title: '✅ Conectado!',
          description: `${event.data.provider} conectado com sucesso.`,
        });
        setConnectingServer(null);
        loadData();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [toast]);

  useEffect(() => {
    if (agentId) {
      loadData();
    }
  }, [agentId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load available servers (com info de provider_configured)
      const serversRes = await fetch(`${BACKEND_URL}/api/mcp/servers`);
      const serversData = await serversRes.json();

      // Load agent connections (tokens)
      const connectionsRes = await fetch(`${BACKEND_URL}/api/mcp/agent/${agentId}/connections`);
      const connectionsData = await connectionsRes.json();
      const agentConnections: MCPConnection[] = connectionsData.connections || [];
      setConnections(agentConnections);

      // Load enabled tools
      const toolsRes = await fetch(`${BACKEND_URL}/api/mcp/agent/${agentId}/tools`);
      const toolsData = await toolsRes.json();
      setEnabledTools(toolsData.tools || []);

      // Create connection map
      const connectionMap = new Map(agentConnections.map((c) => [c.mcp_server_id, c]));

      // Mark servers with status - usar mcp_server_id diretamente
      const enabledServerIds = new Set(
        (toolsData.tools || []).map((t: any) => t.mcp_server_id).filter(Boolean),
      );

      const serversWithStatus = (serversData.servers || []).map((server: MCPServer) => {
        const conn = connectionMap.get(server.id);
        const serverTools = (toolsData.tools || []).filter(
          (t: any) => t.mcp_server_id === server.id || t.mcp_server_name === server.name,
        );
        return {
          ...server,
          is_connected: conn?.is_connected || false,
          is_enabled: enabledServerIds.has(server.id) || serverTools.length > 0,
          enabled_tools: serverTools.length,
        };
      });

      setAvailableServers(serversWithStatus);
    } catch (error) {
      console.error('Error loading MCP data:', error);
      toast({
        title: 'Erro',
        description: 'Falha ao carregar servidores MCP',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (server: MCPServer) => {
    if (!server.oauth_provider) return;

    setConnectingServer(server.id);

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/mcp/oauth/url/${server.oauth_provider}?agent_id=${agentId}&mcp_server_id=${server.id}`,
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Falha ao gerar URL OAuth');
      }

      // Abrir popup para OAuth
      const width = 600;
      const height = 700;
      const left = (window.innerWidth - width) / 2;
      const top = (window.innerHeight - height) / 2;

      window.open(data.url, 'MCP OAuth', `width=${width},height=${height},left=${left},top=${top}`);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
      setConnectingServer(null);
    }
  };

  const handleDisconnect = async (server: MCPServer) => {
    setDisconnectingServer(server.id);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/mcp/agent/${agentId}/disconnect/${server.id}?company_id=${companyId}`,
        { method: 'POST' },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Falha ao desconectar');
      }

      toast({
        title: 'Desconectado',
        description: `${server.display_name} desconectado`,
      });

      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDisconnectingServer(null);
    }
  };

  const handleEnableServer = async (serverId: string, serverName: string) => {
    setEnablingServer(serverId);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mcp/agent/${agentId}/enable-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcp_server_id: serverId,
          company_id: companyId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Falha ao habilitar servidor');
      }

      toast({
        title: 'Sucesso',
        description: `${serverName} habilitado! ${data.enabled_tools?.length || 0} tools disponíveis.`,
      });

      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setEnablingServer(null);
    }
  };

  const handleDisableServer = async (serverId: string, serverName: string) => {
    setDisablingServer(serverId);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/mcp/agent/${agentId}/disable-server/${serverId}?company_id=${companyId}`,
        { method: 'DELETE' },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Falha ao desabilitar servidor');
      }

      toast({
        title: 'Sucesso',
        description: `${serverName} desabilitado`,
      });

      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDisablingServer(null);
    }
  };

  const getServerStatus = (server: MCPServer) => {
    if (!server.provider_configured && server.oauth_provider) return 'not_configured';
    if (server.is_enabled) return 'enabled';
    if (server.is_connected) return 'connected';
    return 'disconnected';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-6">
      {/* Info Card */}
      <Card className="bg-blue-600 border-transparent">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-white mt-0.5" />
            <div>
              <p className="text-sm text-white">
                <strong>MCP (Model Context Protocol)</strong> permite integrar este agente com
                serviços externos.
              </p>
              <p className="text-xs text-white/90 mt-1">
                1. <strong>Conecte</strong> sua conta → 2. <strong>Habilite</strong> as tools → 3.{' '}
                <strong>Use</strong> no prompt
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Servers */}
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-foreground">Integrações MCP</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadData}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {availableServers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum servidor MCP disponível</p>
          ) : (
            availableServers.map((server) => {
              const status = getServerStatus(server);

              return (
                <div
                  key={server.id}
                  className={`p-4 rounded-lg border ${status === 'enabled'
                    ? 'bg-green-900/20 border-green-700'
                    : status === 'connected'
                      ? 'bg-blue-900/20 border-blue-700'
                      : status === 'not_configured'
                        ? 'bg-red-900/20 border-red-700'
                        : 'bg-background border-border'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Plug
                          className={`h-4 w-4 ${status === 'enabled'
                            ? 'text-green-400'
                            : status === 'connected'
                              ? 'text-blue-400'
                              : status === 'not_configured'
                                ? 'text-red-400'
                                : 'text-muted-foreground'
                            }`}
                        />
                        <span className="font-medium text-foreground">{server.display_name}</span>

                        {status === 'enabled' && (
                          <Badge className="bg-green-600 text-xs">
                            {server.enabled_tools} tools ativas
                          </Badge>
                        )}
                        {status === 'connected' && (
                          <Badge className="bg-blue-600 text-xs">Conectado</Badge>
                        )}
                        {status === 'not_configured' && (
                          <Badge className="bg-red-600 text-xs">Não disponível</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{server.description}</p>

                      {status === 'not_configured' && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Integração não configurada na plataforma
                        </p>
                      )}
                    </div>

                    <div className="ml-4 flex gap-2">
                      {/* Não configurado na plataforma */}
                      {status === 'not_configured' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled
                          className="bg-muted border-border text-muted-foreground"
                        >
                          Indisponível
                        </Button>
                      )}

                      {/* Desconectado - Pode conectar */}
                      {status === 'disconnected' && server.oauth_provider && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleConnect(server)}
                          disabled={connectingServer === server.id}
                          className="bg-card border-blue-600 text-blue-400 hover:bg-blue-900/30"
                        >
                          {connectingServer === server.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Link className="h-4 w-4 mr-1" />
                              Conectar
                            </>
                          )}
                        </Button>
                      )}

                      {/* Conectado - Pode habilitar ou desconectar */}
                      {status === 'connected' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEnableServer(server.id, server.display_name)}
                            disabled={enablingServer === server.id}
                            className="bg-card border-green-600 text-green-400 hover:bg-green-900/30"
                          >
                            {enablingServer === server.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Habilitar
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDisconnect(server)}
                            disabled={disconnectingServer === server.id}
                            className="text-muted-foreground hover:text-red-400"
                          >
                            {disconnectingServer === server.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Unlink className="h-4 w-4" />
                            )}
                          </Button>
                        </>
                      )}

                      {/* Habilitado - Pode reconectar ou desabilitar */}
                      {status === 'enabled' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConnect(server)}
                            disabled={connectingServer === server.id}
                            className="bg-card border-blue-600 text-blue-400 hover:bg-blue-900/30"
                          >
                            {connectingServer === server.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Reconectar
                              </>
                            )}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDisableServer(server.id, server.display_name)}
                            disabled={disablingServer === server.id}
                          >
                            {disablingServer === server.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <XCircle className="h-4 w-4 mr-1" />
                                Desabilitar
                              </>
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Enabled Tools */}
      {enabledTools.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm text-foreground">
              Variáveis Disponíveis para o Prompt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2">
              {enabledTools.map((tool: any) => (
                <div
                  key={tool.variable_name}
                  className="flex items-center justify-between p-3 bg-background rounded border border-border"
                >
                  <div>
                    <code className="text-green-400 text-sm font-mono">
                      {'{' + tool.variable_name + '}'}
                    </code>
                    <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`{${tool.variable_name}}`);
                      toast({
                        title: 'Copiado!',
                        description: 'Variável copiada',
                      });
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Copiar
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
