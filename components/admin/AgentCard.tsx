'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bot, Edit, Archive, CheckCircle, XCircle, Users } from 'lucide-react';
import { Agent } from '@/types/agent';

interface AgentCardProps {
  agent: Agent;
  onEdit: (agentId: string) => void;
  onArchive: (agentId: string) => void;
}

export function AgentCard({ agent, onEdit, onArchive }: AgentCardProps) {
  return (
    <Card className="bg-card border-border hover:border-blue-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Bot className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">{agent.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">/{agent.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {agent.is_active ? (
              <Badge className="bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20">
                <CheckCircle className="w-3 h-3 mr-1" />
                Ativo
              </Badge>
            ) : (
              <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">
                <XCircle className="w-3 h-3 mr-1" />
                Inativo
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Model Info */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Provider:</span>
            <span className="text-foreground font-medium">
              {agent.llm_provider || 'Não configurado'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Modelo:</span>
            <span className="text-foreground font-medium truncate ml-2">
              {agent.llm_model || 'Não configurado'}
            </span>
          </div>
        </div>

        {/* Capabilities */}
        <div className="flex flex-wrap gap-2">
          {agent.allow_web_search && (
            <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">
              🌐 Web Search
            </Badge>
          )}
          {agent.allow_vision && (
            <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">
              👁️ Vision
            </Badge>
          )}
          {agent.has_api_key && (
            <Badge variant="outline" className="text-xs border-green-500/30 text-green-400">
              🔑 API Key
            </Badge>
          )}
          {agent.has_whatsapp && (
            <Badge
              variant="outline"
              className="text-xs border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
            >
              📱 WhatsApp
            </Badge>
          )}
          {agent.is_subagent && (
            <Badge
              variant="outline"
              className="text-xs border-indigo-500/30 text-indigo-400 bg-indigo-500/10"
            >
              <Users className="w-3 h-3 mr-1" />
              Especialista
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/50"
            onClick={() => onEdit(agent.id)}
          >
            <Edit className="w-3 h-3 mr-1" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/50"
            onClick={() => onArchive(agent.id)}
          >
            <Archive className="w-3 h-3 mr-1" />
            Arquivar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
