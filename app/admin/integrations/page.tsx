'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, Bot } from 'lucide-react';
import { useAdminRole } from '@/hooks/useAdminRole';

export default function IntegrationsPage() {
  const { role, isLoading } = useAdminRole();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && role !== 'company_admin') {
      router.push('/admin');
    }
  }, [role, isLoading, router]);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-white">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
          <MessageCircle className="w-8 h-8" />
          Integrações
        </h1>
        <p className="text-muted-foreground">Conecte canais de comunicação ao seu agente</p>
      </div>

      {/* WhatsApp - Migrado para Agente */}
      <Card className="bg-card border-border mb-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-500" />
            WhatsApp (Z-API)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-md">
            <p className="text-green-600 dark:text-green-400 text-sm flex items-center gap-2">
              <Bot className="w-4 h-4" />A configuração do WhatsApp agora é feita{' '}
              <strong>por agente</strong>.
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              Acesse <strong>Agentes → Editar → aba WhatsApp</strong> para configurar a integração
              de cada agente.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Futuras integrações */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card border-border opacity-50">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              Telegram
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Em breve: Integração com Telegram</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border opacity-50">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              Messenger
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Em breve: Integração com Facebook Messenger</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
