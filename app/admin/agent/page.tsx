'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bot, Plus, Loader2 } from 'lucide-react';
import { useAdminRole } from '@/hooks/useAdminRole';
import { AgentConfigModal } from '@/components/admin/AgentConfigModal';
import { AgentFlowView } from '@/components/agents/AgentFlowView';
import type { AgentWithDelegations } from '@/components/agents/hooks/useAgentFlowLayout';
import { Agent } from '@/types/agent';
import { useToast } from '@/hooks/use-toast';

export default function AgentConfigPage() {
  const { role, companyId, isLoading } = useAdminRole();
  const router = useRouter();
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentWithDelegations[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  useEffect(() => {
    if (!isLoading && role !== 'company_admin') {
      router.push('/admin');
    }
  }, [role, isLoading, router]);

  useEffect(() => {
    if (companyId) {
      loadAgents();
    }
  }, [companyId]);

  const loadAgents = async () => {
    setLoadingAgents(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/agents/company/${companyId}/with-delegations`);
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

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-white">Carregando...</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-8">
        <div className="text-red-400">Erro: Empresa não encontrada</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Bot className="w-8 h-8" />
            Gerenciar Agentes IA
          </h1>
          <p className="text-gray-400">
            Crie e configure múltiplos agentes com diferentes personalidades e funções
          </p>
        </div>
        <Button
          onClick={handleCreateAgent}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Criar Novo Agente
        </Button>
      </div>

      {/* Agents Grid */}
      {loadingAgents ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="bg-[#1A1A1A] border-[#2D2D2D]">
          <CardContent className="py-12 text-center">
            <Bot className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Nenhum agente criado ainda</h3>
            <p className="text-gray-400 mb-6">
              Crie seu primeiro agente para começar a personalizar seu assistente IA
            </p>
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

      {/* Info Card */}
      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-blue-400">
          💡 <strong>Dica:</strong> Você pode criar agentes especializados para diferentes funções
          (vendas, suporte, atendimento) e vinculá-los a canais específicos como WhatsApp.
        </p>
      </div>

      {/* Modal */}
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
