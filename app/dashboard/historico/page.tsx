'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { UnifiedSidebar } from '@/components/UnifiedSidebar';
import { useUserId } from '@/hooks/useUserId';

interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export default function HistoricoPage() {
  const router = useRouter();
  const { userId: currentUserId } = useUserId();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    // Middleware já garante autenticação, não precisa verificar aqui
    try {
      const response = await fetch('/api/conversations?include_counts=true');
      if (!response.ok) throw new Error('Failed to load conversations');

      const data = await response.json();
      setConversations(data.conversations || []);
    } catch (error) {
      console.error('Erro ao carregar conversas:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenConversation = (conversationId: string) => {
    router.push(`/dashboard/chat?conversation=${conversationId}`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background text-foreground">
        {currentUserId && <UnifiedSidebar userId={currentUserId} />}
        <div className="flex-1 lg:ml-64 flex items-center justify-center">
          <div className="text-muted-foreground">Carregando histórico...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar - FIXED: Added hidden on mobile to prevent double sidebar */}
      {currentUserId && <UnifiedSidebar userId={currentUserId} />}

      <div className="flex-1 lg:ml-64 bg-background">
        <div className="p-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Histórico de Conversas</h1>

            {conversations.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center shadow-sm">
                <p className="text-muted-foreground mb-4">Você ainda não tem conversas</p>
                <button
                  onClick={() => router.push('/dashboard/chat')}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                >
                  Iniciar primeira conversa
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => handleOpenConversation(conv.id)}
                    className="group bg-card border border-border rounded-xl p-6 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold mb-2 text-card-foreground group-hover:text-blue-600 transition-colors">
                          {conv.title || 'Conversa sem título'}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="bg-secondary/50 px-2 py-0.5 rounded text-xs">
                            {conv.message_count} msgs
                          </span>
                          <span>•</span>
                          <span>
                            {formatDistanceToNow(new Date(conv.updated_at), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        </div>
                      </div>
                      <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors font-medium shrink-0">
                        Abrir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
