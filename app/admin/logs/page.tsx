'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  Search,
  Filter,
  Calendar,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';

// Safe types (without sensitive fields)
interface SafeUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_id: string | null;
}

interface SafeAdmin {
  id: string;
  email: string;
  name: string;
}

interface SafeCompany {
  id: string;
  company_name: string;
}

interface SystemLog {
  id: string;
  timestamp: string;
  user_id: string | null;
  admin_id: string | null;
  company_id: string | null;
  action_type: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  status: 'success' | 'error' | 'warning';
  error_message: string | null;
  created_at: string;
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [users, setUsers] = useState<Record<string, SafeUser>>({});
  const [admins, setAdmins] = useState<Record<string, SafeAdmin>>({});
  const [companies, setCompanies] = useState<Record<string, SafeCompany>>({});
  const [loading, setLoading] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [originFilter, setOriginFilter] = useState<string>('all'); // Frontend | Backend | all
  const [dateFilter, setDateFilter] = useState<string>('7days');
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 15;

  useEffect(() => {
    loadData();
  }, [dateFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/logs/data?dateFilter=${dateFilter}`);

      if (!response.ok) {
        throw new Error('Erro ao carregar logs');
      }

      const data = await response.json();

      setLogs(data.logs || []);
      setUsers(data.users || {});
      setAdmins(data.admins || {});
      setCompanies(data.companies || {});
    } catch (error) {
      console.error('[LOGS PAGE] Error loading logs:', error);
      alert(`Erro ao carregar logs: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const getDateThreshold = (filter: string): string => {
    const now = new Date();
    switch (filter) {
      case 'today':
        now.setHours(0, 0, 0, 0);
        return now.toISOString();
      case '7days':
        now.setDate(now.getDate() - 7);
        return now.toISOString();
      case '30days':
        now.setDate(now.getDate() - 30);
        return now.toISOString();
      case '90days':
        now.setDate(now.getDate() - 90);
        return now.toISOString();
      default:
        now.setDate(now.getDate() - 7);
        return now.toISOString();
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Sucesso</Badge>
        );
      case 'error':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Erro</Badge>;
      case 'warning':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Aviso</Badge>
        );
      default:
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">{status}</Badge>;
    }
  };

  const getActionTypeBadge = (actionType: string) => {
    const colorMap: Record<string, string> = {
      LOGIN_SUCCESS: 'from-blue-600 to-cyan-600',
      LOGIN_FAILED: 'from-red-600 to-pink-600',
      LOGOUT: 'from-gray-600 to-slate-600',
      SIGNUP: 'from-green-600 to-emerald-600',
      ADMIN_LOGIN: 'from-purple-600 to-indigo-600',
      ADMIN_LOGOUT: 'from-gray-600 to-slate-600',
      USER_APPROVED: 'from-green-600 to-teal-600',
      USER_REJECTED: 'from-red-600 to-orange-600',
      USER_SUSPENDED: 'from-orange-600 to-red-600',
      USER_ACTIVATED: 'from-green-600 to-lime-600',
      COMPANY_CREATED: 'from-blue-600 to-indigo-600',
      COMPANY_UPDATED: 'from-yellow-600 to-orange-600',
      COMPANY_SUSPENDED: 'from-red-600 to-pink-600',
      COMPANY_ACTIVATED: 'from-green-600 to-emerald-600',
      N8N_WEBHOOK_CALL: 'from-cyan-600 to-blue-600',
      ERROR_OCCURRED: 'from-red-600 to-rose-600',
      BACKEND_REQUEST: 'from-emerald-600 to-teal-600',
      BACKEND_ERROR: 'from-red-600 to-rose-600',
    };

    const gradient = colorMap[actionType] || 'from-gray-600 to-slate-600';

    return (
      <div
        className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gradient-to-r ${gradient} text-white`}
      >
        {actionType.replace(/_/g, ' ')}
      </div>
    );
  };

  const getUserDisplay = (log: SystemLog): string => {
    if (log.admin_id && admins[log.admin_id]) {
      return `Admin: ${admins[log.admin_id].name}`;
    }
    if (log.user_id && users[log.user_id]) {
      const user = users[log.user_id];
      return `${user.first_name} ${user.last_name} (${user.email})`;
    }
    return 'Sistema';
  };

  const getCompanyDisplay = (log: SystemLog): string => {
    if (log.company_id && companies[log.company_id]) {
      return companies[log.company_id].company_name;
    }
    return '-';
  };

  const toggleExpandLog = (logId: string) => {
    setExpandedLog(expandedLog === logId ? null : logId);
  };

  // HTTP Status Badge (for backend logs)
  const getHttpStatusBadge = (statusCode: number | undefined) => {
    if (!statusCode) return null;
    if (statusCode >= 500) {
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">🔴 {statusCode}</Badge>
      );
    } else if (statusCode >= 400) {
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          🟡 {statusCode}
        </Badge>
      );
    } else {
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
          🟢 {statusCode}
        </Badge>
      );
    }
  };

  // Latency Indicator
  const getLatencyBadge = (latencyMs: number | undefined) => {
    if (!latencyMs) return null;
    if (latencyMs < 500) {
      return <span className="text-green-400 text-xs">⚡ {latencyMs}ms</span>;
    } else if (latencyMs < 2000) {
      return <span className="text-yellow-400 text-xs">🚶 {latencyMs}ms</span>;
    } else {
      return <span className="text-red-400 text-xs">🐢 {(latencyMs / 1000).toFixed(1)}s</span>;
    }
  };

  // HTTP Method Badge
  const getMethodBadge = (method: string | undefined) => {
    if (!method) return null;
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      POST: 'bg-green-500/20 text-green-400 border-green-500/30',
      PUT: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      PATCH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      DELETE: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    return <Badge className={colors[method] || 'bg-gray-500/20 text-gray-400'}>{method}</Badge>;
  };

  // Check if log is from backend
  const isBackendLog = (log: SystemLog) => {
    return log.action_type === 'BACKEND_REQUEST' || log.action_type === 'BACKEND_ERROR';
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      searchTerm === '' ||
      log.action_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getUserDisplay(log).toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.ip_address?.includes(searchTerm) ||
      JSON.stringify(log.details).toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAction = actionFilter === 'all' || log.action_type === actionFilter;
    const matchesStatus = statusFilter === 'all' || log.status === statusFilter;

    // Origin filter
    const isBackend = isBackendLog(log);
    const matchesOrigin =
      originFilter === 'all' ||
      (originFilter === 'backend' && isBackend) ||
      (originFilter === 'frontend' && !isBackend);

    return matchesSearch && matchesAction && matchesStatus && matchesOrigin;
  });

  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * logsPerPage,
    currentPage * logsPerPage,
  );

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);

  const actionTypes = Array.from(new Set(logs.map((log) => log.action_type))).sort();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Logs do Sistema</h1>
        <p className="text-muted-foreground">Visualize todos os logs e atividades do sistema Scale AI</p>
      </div>

      <Card className="bg-card border-border mb-6">
        <CardHeader>
          <CardTitle className="text-card-foreground text-lg">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-background border-input text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="bg-background border-input text-foreground">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border">
                <SelectItem value="today" className="text-foreground">
                  Hoje
                </SelectItem>
                <SelectItem value="7days" className="text-foreground">
                  Últimos 7 dias
                </SelectItem>
                <SelectItem value="30days" className="text-foreground">
                  Últimos 30 dias
                </SelectItem>
                <SelectItem value="90days" className="text-foreground">
                  Últimos 90 dias
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="bg-background border-input text-foreground">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Tipo de Ação" />
              </SelectTrigger>
              <SelectContent className="bg-background border-border max-h-[300px]">
                <SelectItem value="all" className="text-foreground">
                  Todas as ações
                </SelectItem>
                {actionTypes.map((type) => (
                  <SelectItem key={type} value={type} className="text-foreground">
                    {type.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-background border-input text-foreground">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-background border-border">
                <SelectItem value="all" className="text-foreground">
                  Todos os status
                </SelectItem>
                <SelectItem value="success" className="text-foreground">
                  Sucesso
                </SelectItem>
                <SelectItem value="error" className="text-foreground">
                  Erro
                </SelectItem>
                <SelectItem value="warning" className="text-foreground">
                  Aviso
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={originFilter} onValueChange={setOriginFilter}>
              <SelectTrigger className="bg-background border-input text-foreground">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Origem" />
              </SelectTrigger>
              <SelectContent className="bg-background border-border">
                <SelectItem value="all" className="text-foreground">
                  Todas origens
                </SelectItem>
                <SelectItem value="frontend" className="text-foreground">
                  🌐 Frontend
                </SelectItem>
                <SelectItem value="backend" className="text-foreground">
                  ⚙️ Backend (FastAPI)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Mostrando {filteredLogs.length} de {logs.length} logs
            </p>
            <Button
              onClick={loadData}
              variant="outline"
              size="sm"
              className="bg-transparent border-input text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-foreground text-center py-12">Carregando logs...</div>
      ) : (
        <>
          <div className="space-y-2">
            {paginatedLogs.map((log) => (
              <Card
                key={log.id}
                className="bg-card border-border hover:bg-muted/50 transition-colors"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        {getActionTypeBadge(log.action_type)}
                        {getStatusBadge(log.status)}
                        <span className="text-sm text-muted-foreground">
                          {new Date(log.timestamp).toLocaleString('pt-BR')}
                        </span>
                        {/* Backend-specific badges */}
                        {isBackendLog(log) && (
                          <>
                            {getMethodBadge(log.details?.method)}
                            {getHttpStatusBadge(log.details?.status_code)}
                            {getLatencyBadge(log.details?.latency_ms)}
                            {log.details?.path && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {log.details.path}
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Usuário: </span>
                          <span className="text-foreground">{getUserDisplay(log)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Empresa: </span>
                          <span className="text-foreground">{getCompanyDisplay(log)}</span>
                        </div>
                        {log.ip_address && (
                          <div>
                            <span className="text-muted-foreground">IP: </span>
                            <span className="text-foreground font-mono text-xs">{log.ip_address}</span>
                          </div>
                        )}
                      </div>

                      {log.error_message && (
                        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded">
                          <p className="text-sm text-red-400">{log.error_message}</p>
                        </div>
                      )}

                      {expandedLog === log.id && (
                        <div className="mt-3 p-3 bg-muted rounded border border-border">
                          <p className="text-xs text-muted-foreground mb-2 font-semibold">
                            Detalhes (JSON):
                          </p>
                          <ScrollArea className="h-[200px]">
                            <pre className="text-xs text-muted-foreground font-mono overflow-x-auto">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </ScrollArea>
                          {log.user_agent && (
                            <div className="mt-3 pt-3 border-t border-border">
                              <p className="text-xs text-muted-foreground mb-1 font-semibold">
                                User Agent:
                              </p>
                              <p className="text-xs text-muted-foreground break-all">{log.user_agent}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={() => toggleExpandLog(log.id)}
                      variant="ghost"
                      size="sm"
                      className="ml-4 text-muted-foreground hover:text-foreground"
                    >
                      {expandedLog === log.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredLogs.length === 0 && (
              <Card className="bg-card border-border">
                <CardContent className="py-12 text-center">
                  <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-foreground font-medium mb-2">Nenhum log encontrado</h3>
                  <p className="text-muted-foreground text-sm">
                    Ajuste os filtros ou aguarde novas atividades no sistema
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                variant="outline"
                size="sm"
                className="bg-transparent border-input text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                Anterior
              </Button>
              <span className="text-foreground px-4">
                Página {currentPage} de {totalPages}
              </span>
              <Button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                variant="outline"
                size="sm"
                className="bg-transparent border-input text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
