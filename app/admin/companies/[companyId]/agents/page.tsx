'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bot, Plus, Loader2, ArrowLeft, Building2, Lock as LockIcon } from 'lucide-react';
import { useAdminRole } from '@/hooks/useAdminRole';
import { AgentConfigModal } from '@/components/admin/AgentConfigModal';
import { AgentFlowView } from '@/components/agents/AgentFlowView';
import type { AgentWithDelegations } from '@/components/agents/hooks/useAgentFlowLayout';
import { Agent } from '@/types/agent';
import { useToast } from '@/hooks/use-toast';

export default function AdminCompanyAgentsPage() {
  const { role, isLoading: roleLoading } = useAdminRole();
  const router = useRouter();
  const params = useParams();
  const companyId = params.companyId as string;
  const { toast } = useToast();

  const [agents, setAgents] = useState<AgentWithDelegations[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [companyName, setCompanyName] = useState<string>('');

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // Verificar permissão Super Admin
  useEffect(() => {
    if (!roleLoading && role !== 'master') {
      router.push('/admin');
    }
  }, [role, roleLoading, router]);

  // Carregar nome da empresa
  useEffect(() => {
    if (companyId) {
      loadCompanyInfo();
      loadAgents();
    }
  }, [companyId]);

  const loadCompanyInfo = async () => {
    try {
      const response = await fetch(`/api/admin/company-info?companyId=${companyId}`, {
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to load company info');

      const data = await response.json();
      setCompanyName(data?.company_name || 'Empresa');
    } catch (error) {
      console.error('Error loading company info:', error);
    }
  };

  const loadAgents = async () => {
    setLoadingAgents(true);
    try {
      const response = await fetch(`/api/admin/agents/company/${companyId}/with-delegations`);
      if (response.ok) {
        const data = await response.json();
        setAgents(data);
      } else {
        throw new Error('Failed to load agents');
      }
    } catch (error) {
      console.error('Error loading agents:', error);
      toast({
        title: 'Erro',
        description: 'Falha ao carregar agentes',
        variant: 'destructive',
      });
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleCreateAgent = () => {
    setSelectedAgentId(undefined);
    setIsModalOpen(true);
  };

  const handleEditAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setIsModalOpen(true);
  };

  const handleArchiveAgent = async (agentId: string) => {
    if (!confirm('Tem certeza que deseja arquivar este agente?')) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/agents/${agentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: 'Sucesso',
          description: 'Agente arquivado com sucesso',
        });
        loadAgents();
      } else {
        throw new Error('Failed to archive agent');
      }
    } catch (error) {
      console.error('Error archiving agent:', error);
      toast({
        title: 'Erro',
        description: 'Falha ao arquivar agente',
        variant: 'destructive',
      });
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedAgentId(undefined);
    loadAgents();
  };

  if (roleLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (role !== 'master') {
    return (
      <div className="p-8">
        <div className="text-red-400">
          Acesso negado. Apenas Super Admin pode acessar esta página.
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        {/* Breadcrumb / Back */}
        <Button
          variant="ghost"
          onClick={() => router.push('/admin/companies')}
          className="mb-4 text-muted-foreground hover:text-foreground hover:bg-muted -ml-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Empresas
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gerenciando agentes de</p>
                <h1 className="text-2xl font-bold text-foreground">{companyName}</h1>
              </div>
            </div>
            <p className="text-muted-foreground mt-2">Configure os agentes de IA desta empresa</p>
          </div>
          <Button
            onClick={handleCreateAgent}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Novo Agente
          </Button>
        </div>
      </div>

      {/* Agents Flow View */}
      {loadingAgents ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <Bot className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-foreground mb-2">Nenhum agente criado ainda</h3>
            <p className="text-muted-foreground mb-6">Crie o primeiro agente para esta empresa</p>
            <Button
              onClick={handleCreateAgent}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
            >
              <Plus className="w-4 h-4" />
              Criar Primeiro Agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <AgentFlowView
          agents={agents}
          onEdit={handleEditAgent}
          onArchive={handleArchiveAgent}
        />
      )}

      {/* Info */}
      <div className="mt-6 p-4 bg-blue-600 border border-blue-700 rounded-lg">
        <p className="text-sm text-white">
          <LockIcon className="w-4 h-4 inline-block mr-2 text-blue-200" />
          <strong>Modo Super Admin:</strong> Você está visualizando os agentes como administrador
          do sistema. As alterações feitas aqui afetarão diretamente a experiência do cliente.
        </p>
      </div>

      {/* Modal - passa o companyId da URL */}
      {isModalOpen && (
        <AgentConfigModal
          companyId={companyId}
          agentId={selectedAgentId}
          open={isModalOpen}
          onOpenChange={handleModalClose}
        />
      )}
    </div>
  );
}
