'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Building2,
  Users,
  UserCheck,
  Clock,
  DollarSign,
  Activity,
  AlertCircle,
  FileText,
} from 'lucide-react';
import Link from 'next/link';
import { useAdminRole } from '@/hooks/useAdminRole';

interface DashboardStats {
  totalCompanies: number;
  activeCompanies: number;
  suspendedCompanies: number;
  totalUsers: number;
  pendingUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  mrr: number;
  logsLast24h: number;
  failedLoginsLast24h: number;
  errorsLast24h: number;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { role, isLoading: roleLoading } = useAdminRole();
  const [stats, setStats] = useState<DashboardStats>({
    totalCompanies: 0,
    activeCompanies: 0,
    suspendedCompanies: 0,
    totalUsers: 0,
    pendingUsers: 0,
    activeUsers: 0,
    suspendedUsers: 0,
    mrr: 0,
    logsLast24h: 0,
    failedLoginsLast24h: 0,
    errorsLast24h: 0,
  });
  const [loading, setLoading] = useState(true);

  // Redirect Company Admin to their team page
  useEffect(() => {
    if (!roleLoading && role === 'company_admin') {
      router.push('/admin/team');
    }
  }, [role, roleLoading, router]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await fetch('/api/admin/stats');

      if (!response.ok) {
        throw new Error('Erro ao carregar estatísticas');
      }

      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'MRR (Monthly Recurring Revenue)',
      value: `R$ ${stats.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      color: 'from-blue-600 to-cyan-600',
      details: 'Receita mensal recorrente',
    },
    {
      title: 'Total de Empresas',
      value: stats.totalCompanies,
      icon: Building2,
      color: 'from-blue-600 to-cyan-600',
      details: `${stats.activeCompanies} ativas, ${stats.suspendedCompanies} suspensas`,
    },
    {
      title: 'Total de Usuários',
      value: stats.totalUsers,
      icon: Users,
      color: 'from-blue-600 to-cyan-600',
      details: `${stats.activeUsers} ativos, ${stats.suspendedUsers} suspensos`,
    },
    {
      title: 'Aprovações Pendentes',
      value: stats.pendingUsers,
      icon: UserCheck,
      color: 'from-blue-600 to-cyan-600',
      details: 'Aguardando aprovação',
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Dashboard Administrativo</h1>
        <p className="text-muted-foreground">Visão geral do sistema Scale AI</p>
      </div>

      {loading ? (
        <div className="text-foreground">Carregando estatísticas...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((card, index) => (
            <Card key={index} className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <div
                  className={`w-10 h-10 bg-gradient-to-br ${card.color} rounded-lg flex items-center justify-center`}
                >
                  <card.icon className="w-5 h-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground mb-1">{card.value}</div>
                <p className="text-xs text-muted-foreground">{card.details}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Ações Rápidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <a
              href="/admin/pending-users"
              className="block p-4 bg-muted/50 rounded-lg hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-foreground font-medium">Aprovar Usuários</h3>
                  <p className="text-sm text-muted-foreground">{stats.pendingUsers} pendentes</p>
                </div>
                <UserCheck className="w-5 h-5 text-blue-600" />
              </div>
            </a>
            <a
              href="/admin/companies"
              className="block p-4 bg-muted/50 rounded-lg hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-foreground font-medium">Gerenciar Empresas</h3>
                  <p className="text-sm text-muted-foreground">{stats.totalCompanies} cadastradas</p>
                </div>
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
            </a>
            <Link
              href="/admin/logs"
              className="block p-4 bg-muted/50 rounded-lg hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-foreground font-medium">Ver Logs do Sistema</h3>
                  <p className="text-sm text-muted-foreground">
                    {stats.logsLast24h} eventos nas últimas 24h
                  </p>
                </div>
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Resumo do Sistema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Usuários Ativos</span>
              <span className="text-foreground font-medium">{stats.activeUsers}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Usuários Pendentes</span>
              <span className="text-orange-400 font-medium">{stats.pendingUsers}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Empresas Ativas</span>
              <span className="text-green-400 font-medium">{stats.activeCompanies}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Empresas Suspensas</span>
              <span className="text-red-400 font-medium">{stats.suspendedCompanies}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Atividade do Sistema (últimas 24 horas)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Total de Logs</span>
                  <FileText className="w-5 h-5 text-cyan-500" />
                </div>
                <p className="text-3xl font-bold text-foreground">{stats.logsLast24h}</p>
                <p className="text-xs text-muted-foreground mt-1">Eventos registrados</p>
              </div>

              <div className="p-4 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Logins com Falha</span>
                  <AlertCircle className="w-5 h-5 text-yellow-500" />
                </div>
                <p className="text-3xl font-bold text-yellow-400">{stats.failedLoginsLast24h}</p>
                <p className="text-xs text-muted-foreground mt-1">Tentativas sem sucesso</p>
              </div>

              <div className="p-4 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Erros do Sistema</span>
                  <AlertCircle className="w-5 h-5 text-red-500" />
                </div>
                <p className="text-3xl font-bold text-red-400">{stats.errorsLast24h}</p>
                <p className="text-xs text-muted-foreground mt-1">Requer atenção</p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <Link
                href="/admin/logs"
                className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Ver todos os logs →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
