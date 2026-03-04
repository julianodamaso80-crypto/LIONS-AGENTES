'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { User, Search, Filter, CheckCircle, XCircle, Clock } from 'lucide-react';

// Tipos parciais para evitar expor campos sensíveis
interface SafeUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  company_id: string | null;
  created_at: string;
  phone: string | null;
  cpf: string;
  is_owner: boolean;
}

interface SafeCompany {
  id: string;
  company_name: string;
  status: string;
}

export default function AdminAllUsersPage() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [companies, setCompanies] = useState<Record<string, SafeCompany>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [processing, setProcessing] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [usersResponse, companiesResponse] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/companies'),
      ]);

      if (!usersResponse.ok || !companiesResponse.ok) {
        throw new Error('Erro ao carregar dados');
      }

      const usersData = await usersResponse.json();
      const companiesData = await companiesResponse.json();

      if (usersData.users) setUsers(usersData.users);
      if (companiesData.companies) {
        const companiesMap = companiesData.companies.reduce(
          (acc: Record<string, SafeCompany>, company: SafeCompany) => {
            acc[company.id] = company;
            return acc;
          },
          {} as Record<string, SafeCompany>,
        );
        setCompanies(companiesMap);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateUserStatus = async (userId: string, newStatus: 'active' | 'suspended') => {
    setProcessing(userId);
    try {
      const user = users.find((u) => u.id === userId);
      const company = user?.company_id ? companies[user.company_id] : undefined;

      const response = await fetch('/api/admin/users/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, status: newStatus }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update status');
      }

      await loadData();
    } catch (error) {
      console.error('Error updating user:', error);

      alert('Erro ao atualizar usuário');
    } finally {
      setProcessing(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-600 text-white border-transparent">Ativo</Badge>;
      case 'pending':
        return (
          <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Pendente</Badge>
        );
      case 'suspended':
        return <Badge className="bg-red-600 text-white border-transparent">Suspenso</Badge>;
      default:
        // "badge Led mantenha o fundo e escrito Branco" -> Agora fundo Preto
        return <Badge className="bg-black text-white border-transparent capitalize">{status}</Badge>;
    }
  };

  const getRoleBadge = (user: SafeUser) => {
    // Se é Owner (admin_company com is_owner true)
    if (
      user.is_owner &&
      (user.role === 'admin_company' || user.role === 'owner' || user.role === 'admin')
    ) {
      return (
        <Badge className="bg-yellow-600 text-white border-transparent">👑 Owner</Badge>
      );
    }

    // Se é Admin (sem is_owner)
    if (user.role === 'admin_company' || user.role === 'owner' || user.role === 'admin') {
      return (
        <Badge className="bg-purple-600 text-white border-transparent">🛡️ Admin</Badge>
      );
    }

    // Member por padrão
    return <Badge className="bg-blue-600 text-white border-transparent">👤 Membro</Badge>;
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.cpf?.includes(searchTerm);

    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Todos os Usuários</h1>
        <p className="text-muted-foreground">Visualize e gerencie todos os usuários do sistema</p>
      </div>

      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email ou CPF..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-background border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px] bg-background border-border text-foreground">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-background border-border">
            <SelectItem value="all" className="text-foreground">
              Todos
            </SelectItem>
            <SelectItem value="active" className="text-foreground">
              Ativos
            </SelectItem>
            <SelectItem value="pending" className="text-foreground">
              Pendentes
            </SelectItem>
            <SelectItem value="suspended" className="text-foreground">
              Suspensos
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-foreground">Carregando usuários...</div>
      ) : (
        <div className="space-y-4">
          {paginatedUsers.map((user) => (
            <Card key={user.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center">
                      <User className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-card-foreground text-xl">
                        {user.first_name} {user.last_name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {getRoleBadge(user)}
                    {getStatusBadge(user.status)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">CPF</p>
                    <p className="text-card-foreground font-medium">{user.cpf}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Empresa</p>
                    <p className="text-card-foreground font-medium">
                      {user.company_id && companies[user.company_id]
                        ? companies[user.company_id].company_name
                        : 'Não atribuída'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Telefone</p>
                    <p className="text-card-foreground font-medium">{user.phone || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Cadastro</p>
                    <p className="text-card-foreground font-medium">
                      {new Date(user.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>

                {user.status !== 'pending' && (
                  <div className="flex gap-2">
                    {user.status === 'suspended' ? (
                      <Button
                        onClick={() => updateUserStatus(user.id, 'active')}
                        disabled={processing === user.id}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {processing === user.id ? 'Ativando...' : 'Ativar Usuário'}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => updateUserStatus(user.id, 'suspended')}
                        disabled={processing === user.id}
                        variant="destructive"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        {processing === user.id ? 'Suspendendo...' : 'Suspender Usuário'}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {filteredUsers.length === 0 && (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center">
                <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-card-foreground font-medium mb-2">Nenhum usuário encontrado</h3>
                <p className="text-muted-foreground text-sm">
                  Ajuste os filtros ou aguarde novos cadastros
                </p>
              </CardContent>
            </Card>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-4 bg-card border border-border rounded-lg">
              <p className="text-sm text-muted-foreground">
                Mostrando {(currentPage - 1) * itemsPerPage + 1} -{' '}
                {Math.min(currentPage * itemsPerPage, filteredUsers.length)} de{' '}
                {filteredUsers.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="bg-transparent border-border text-muted-foreground hover:text-foreground"
                >
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="bg-transparent border-border text-muted-foreground hover:text-foreground"
                >
                  Próximo
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
