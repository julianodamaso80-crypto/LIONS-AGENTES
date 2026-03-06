'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MessageCircle, Save, Loader2, Eye, EyeOff, Bot } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Agent } from '@/types/agent';

interface IntegrationModalProps {
  companyId: string;
  companyName: string;
}

export function IntegrationModal({ companyId, companyName }: IntegrationModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showClientToken, setShowClientToken] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const { toast } = useToast();

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const [formData, setFormData] = useState({
    identifier: '',
    instance_id: '',
    token: '',
    client_token: '',
    base_url: 'https://api.z-api.io/instances',
    is_active: true,
    agent_id: '', // NEW: Vinculação ao agente
    // Buffer settings
    buffer_enabled: true,
    buffer_debounce_seconds: 3,
    buffer_max_wait_seconds: 10,
  });

  useEffect(() => {
    if (open) {
      loadAgents();
      loadIntegration();
    }
  }, [open]);

  const loadIntegration = async () => {
    setLoading(true);
    try {
      // Use the first active agent's ID if available, or skip
      const agentIdToLoad = formData.agent_id !== 'none' ? formData.agent_id : agents[0]?.id;
      if (!agentIdToLoad) {
        // No agent to load integration for
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/admin/integrations?agentId=${agentIdToLoad}`);

      if (!response.ok) {
        if (response.status === 404) {
          // No integration found - that's OK
          setLoading(false);
          return;
        }
        throw new Error('Failed to load integration');
      }

      const { integration } = await response.json();

      if (integration) {
        setFormData({
          identifier: integration.identifier || '',
          instance_id: integration.instance_id || '',
          token: integration.token || '',
          client_token: integration.client_token || '',
          base_url: integration.base_url || 'https://api.z-api.io/instances',
          is_active: integration.is_active ?? true,
          agent_id: integration.agent_id || 'none',
          // Buffer settings
          buffer_enabled: integration.buffer_enabled ?? true,
          buffer_debounce_seconds: integration.buffer_debounce_seconds ?? 3,
          buffer_max_wait_seconds: integration.buffer_max_wait_seconds ?? 10,
        });
      }
    } catch (error) {
      console.error('Error loading integration:', error);
      toast({
        title: 'Erro',
        description: 'Falha ao carregar integração',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAgents = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/agents/company/${companyId}`);
      if (response.ok) {
        const data = await response.json();
        setAgents(data.filter((a: Agent) => a.is_active));
      }
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  };

  const handleSave = async () => {
    // Validações básicas
    if (!formData.identifier.trim()) {
      toast({
        title: 'Validação',
        description: 'Telefone é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.instance_id.trim()) {
      toast({
        title: 'Validação',
        description: 'Instance ID é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.token.trim()) {
      toast({
        title: 'Validação',
        description: 'Token é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      // 🔒 SECURITY: Using API route - company_id is extracted from session on server
      const payload = {
        // Note: company_id is NOT sent - server extracts from session
        provider: 'z-api',
        identifier: formData.identifier.trim(),
        instance_id: formData.instance_id.trim(),
        token: formData.token.trim(),
        client_token: formData.client_token.trim() || null,
        base_url: formData.base_url.trim(),
        is_active: formData.is_active,
        agent_id: formData.agent_id === 'none' ? null : formData.agent_id || null,
        // Buffer settings
        buffer_enabled: formData.buffer_enabled,
        buffer_debounce_seconds: formData.buffer_debounce_seconds,
        buffer_max_wait_seconds: formData.buffer_max_wait_seconds,
      };

      const response = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save integration');
      }

      toast({
        title: 'Sucesso',
        description: 'Integração WhatsApp salva com sucesso!',
      });
      setOpen(false);
    } catch (error: any) {
      console.error('Error saving integration:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao salvar integração',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="bg-transparent border-green-600/50 text-green-500 hover:text-green-400 hover:bg-green-900/20"
        >
          <MessageCircle className="w-4 h-4 mr-2" />
          WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">Configurar WhatsApp (Z-API)</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Empresa: <span className="text-foreground font-medium">{companyName}</span>
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-green-500" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Phone Number */}
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-sm font-medium text-foreground">
                Telefone Conectado (Connected Phone)
              </Label>
              <Input
                id="identifier"
                placeholder="Ex: 554499999999"
                value={formData.identifier}
                onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                className="bg-background border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Número no formato: DDI + DDD + Número (sem espaços ou caracteres)
              </p>
            </div>

            {/* Agent Selector */}
            <div className="space-y-2">
              <Label htmlFor="agent_id" className="text-sm font-medium flex items-center gap-2 text-foreground">
                <Bot className="w-4 h-4" />
                Vincular ao Agente
              </Label>
              <Select
                value={formData.agent_id}
                onValueChange={(value) => setFormData({ ...formData, agent_id: value })}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="Selecione um agente (opcional)" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none" className="text-muted-foreground">
                    Nenhum
                  </SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id} className="text-foreground">
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Escolha qual agente irá responder por esta integração
              </p>
            </div>

            {/* Instance ID */}
            <div className="space-y-2">
              <Label htmlFor="instance_id" className="text-sm font-medium text-foreground">
                Instance ID
              </Label>
              <Input
                id="instance_id"
                placeholder="Ex: 3B71E8..."
                value={formData.instance_id}
                onChange={(e) => setFormData({ ...formData, instance_id: e.target.value })}
                className="bg-background border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">ID da instância no painel Z-API</p>
            </div>

            {/* Instance Token */}
            <div className="space-y-2">
              <Label htmlFor="token" className="text-sm font-medium text-foreground">
                Instance Token
              </Label>
              <div className="relative">
                <Input
                  id="token"
                  type={showToken ? 'text' : 'password'}
                  placeholder="Token da instância"
                  value={formData.token}
                  onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                  className="bg-background border-border text-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Token de autenticação da instância</p>
            </div>

            {/* Client Token */}
            <div className="space-y-2">
              <Label htmlFor="client_token" className="text-sm font-medium text-foreground">
                Client Token (Opcional)
              </Label>
              <div className="relative">
                <Input
                  id="client_token"
                  type={showClientToken ? 'text' : 'password'}
                  placeholder="Token de segurança (se configurado)"
                  value={formData.client_token}
                  onChange={(e) => setFormData({ ...formData, client_token: e.target.value })}
                  className="bg-background border-border text-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowClientToken(!showClientToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showClientToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Token adicional de segurança (Client-Token header)
              </p>
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="base_url" className="text-sm font-medium text-foreground">
                Base URL
              </Label>
              <Input
                id="base_url"
                placeholder="https://api.z-api.io/instances"
                value={formData.base_url}
                onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                className="bg-background border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                URL base da API Z-API (normalmente não precisa alterar)
              </p>
            </div>

            {/* Active Switch */}
            <Card className="bg-card border-border p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="is_active" className="text-sm font-medium cursor-pointer text-foreground">
                    Integração Ativa
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Habilita/desabilita o recebimento de mensagens
                  </p>
                </div>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
            </Card>

            {/* Buffer Settings */}
            <Card className="bg-card border-border p-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">Buffer de Mensagens</h3>
                  <p className="text-xs text-muted-foreground">
                    Agrupa mensagens consecutivas antes do processamento do LLM
                  </p>
                </div>

                {/* Enable Buffer Switch */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="buffer_enabled" className="text-sm font-medium cursor-pointer text-foreground">
                      Habilitar Buffer
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Combina mensagens rápidas em 1 chamada LLM
                    </p>
                  </div>
                  <Switch
                    id="buffer_enabled"
                    checked={formData.buffer_enabled}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, buffer_enabled: checked })
                    }
                  />
                </div>

                {/* Buffer Debounce */}
                {formData.buffer_enabled && (
                  <div className="space-y-2">
                    <Label htmlFor="buffer_debounce" className="text-sm font-medium text-foreground">
                      Debounce (segundos)
                    </Label>
                    <Input
                      id="buffer_debounce"
                      type="number"
                      min="1"
                      max="30"
                      value={formData.buffer_debounce_seconds}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          buffer_debounce_seconds: parseInt(e.target.value) || 3,
                        })
                      }
                      className="bg-background border-border text-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Aguarda X segundos após última mensagem (recomendado: 3s)
                    </p>
                  </div>
                )}

                {/* Buffer Max Wait */}
                {formData.buffer_enabled && (
                  <div className="space-y-2">
                    <Label htmlFor="buffer_max_wait" className="text-sm font-medium text-foreground">
                      Max Wait (segundos)
                    </Label>
                    <Input
                      id="buffer_max_wait"
                      type="number"
                      min="5"
                      max="60"
                      value={formData.buffer_max_wait_seconds}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          buffer_max_wait_seconds: parseInt(e.target.value) || 10,
                        })
                      }
                      className="bg-background border-border text-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Tempo máximo desde primeira mensagem (recomendado: 10s)
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="bg-transparent border-border text-muted-foreground hover:text-foreground"
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Salvar
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
