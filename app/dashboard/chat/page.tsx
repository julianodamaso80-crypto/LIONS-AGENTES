'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, PlusCircle } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import InputArea from '@/components/InputArea';
import { MessageBubble } from '@/components/MessageBubble';
import { TypingIndicator } from '@/components/TypingIndicator';
import { UnifiedSidebar } from '@/components/UnifiedSidebar';
import { sendTextToN8N, sendVoiceToN8N } from '@/lib/n8nClient';
import { Message } from '@/lib/types';
import { useUserId } from '@/hooks/useUserId';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function ChatPage() {
  const { userId, userAvatar, userName, isLoading: isLoadingUser } = useUserId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [conversationId, setConversationId] = useState<string | null>(null);

  // States do Agente
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [agentsLoaded, setAgentsLoaded] = useState(false); // 🔥 NOVO: Flag para saber quando agents carregou

  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isWebSearchAllowed, setIsWebSearchAllowed] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Busca Company e Permissões
  useEffect(() => {
    const fetchCompanyData = async () => {
      if (!userId) return;

      try {
        const response = await fetch('/api/user/company-data');
        if (!response.ok) return;

        const data = await response.json();
        setCompanyId(data.companyId);
        setIsWebSearchAllowed(data.allowWebSearch || false);
      } catch (error) {
        console.error('[CHAT] Erro setup:', error);
      }
    };

    fetchCompanyData();
  }, [userId]);

  // 2. Busca Agentes
  useEffect(() => {
    const fetchAgents = async () => {
      if (!companyId) return;

      try {
        const response = await fetch('/api/agents');
        if (!response.ok) throw new Error('Falha ao buscar agentes');

        const data = await response.json();

        if (data.agents && data.agents.length > 0) {
          setAgents(data.agents);
          if (!selectedAgentId) {
            setSelectedAgentId(data.agents[0].id);
          }
        }

        setAgentsLoaded(true);
      } catch (error) {
        console.error('[CHAT] Erro agents:', error);
        setAgentsLoaded(true);
      }
    };

    fetchAgents();
  }, [companyId]);

  // 🔥 CORREÇÃO PRINCIPAL: Load Conversation SÓ quando agents estiver pronto
  useEffect(() => {
    if (userId && agentsLoaded) {
      loadConversation();
    }
  }, [userId, sessionId, agentsLoaded]); // 🔥 Depende de agentsLoaded

  // Auto-scroll
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 🔔 POLLING: Receber mensagens periodicamente (Human Handoff)
  useEffect(() => {
    if (!conversationId) return;

    const pollMessages = async () => {
      try {
        const response = await fetch(`/api/conversations?session_id=${sessionId}`);
        if (!response.ok) return;

        const data = await response.json();
        if (data.messages) {
          setMessages((prev) => {
            const newMsgs = (data.messages as Message[]).filter(
              (m: Message) => !prev.some((existing) => existing.id === m.id),
            );
            if (newMsgs.length === 0) return prev;
            return [...prev, ...newMsgs];
          });
        }
      } catch {
        // Silent fail
      }
    };

    const interval = setInterval(pollMessages, 3000);
    return () => clearInterval(interval);
  }, [conversationId, sessionId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // === 🔥 LÓGICA DE CARREGAMENTO CORRIGIDA ===
  const loadConversation = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/conversations?session_id=${sessionId}`);
      if (!response.ok) throw new Error('Falha ao carregar conversa');

      const data = await response.json();
      const conversation = data.conversation;

      if (conversation) {
        setConversationId(conversation.id);

        if (conversation.agent_id) {
          setSelectedAgentId(conversation.agent_id);
        }

        if (data.messages) {
          setMessages(data.messages);
        }
      } else {
        setConversationId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('[CHAT] Erro ao carregar conversa:', error);
    }
  }, [userId, sessionId, selectedAgentId]);

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    if (!userId || !companyId) throw new Error('Init failed');

    const response = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        agent_id: selectedAgentId,
        title: 'Nova Conversa',
      }),
    });

    if (!response.ok) throw new Error('Falha ao criar conversa');

    const data = await response.json();
    setConversationId(data.conversation.id);
    return data.conversation.id;
  };

  const saveMessage = async (
    convId: string,
    role: 'user' | 'assistant',
    content: string,
    type: 'text' | 'voice' = 'text',
    audioUrl?: string,
    imageUrl?: string,
  ) => {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convId,
        role,
        content,
        type,
        audio_url: audioUrl,
        image_url: imageUrl,
      }),
    });

    if (!response.ok) throw new Error('Falha ao salvar mensagem');

    const data = await response.json();
    return data.message;
  };

  // === 🚀 LÓGICA DE TROCA DE AGENTE ===
  const handleAgentChange = (newAgentId: string) => {
    if (newAgentId === selectedAgentId) return;

    const agentName = agents.find((a) => a.id === newAgentId)?.name;

    // 1. Atualiza ID
    setSelectedAgentId(newAgentId);

    // 2. RESETA O CHAT (Nova Sessão)
    handleNewConversation();

    // 3. Feedback visual
    toast.success(`Chat iniciado com ${agentName}`);
  };

  const handleSendMessage = async (message: string, imageUrl?: string) => {
    if (!userId) return;

    if (!companyId) {
      toast.error('Erro: Company ID não identificado. Recarregue a página.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Garante a conversa e salva msg do usuário
      const convId = await ensureConversation();

      // Mensagem do usuário (Optimistic)
      const tempUserMessage: Message = {
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'user',
        content: message,
        type: 'text',
        image_url: imageUrl,
        created_at: new Date().toISOString(),
      };

      // Mensagem do Assistente (VAZIA INICIAL) - GUARDAMOS ESSE ID
      const assistantMsgId = crypto.randomUUID();
      const tempAssistantMessage: Message = {
        id: assistantMsgId,
        conversation_id: convId,
        role: 'assistant',
        content: '', // Começa vazio
        type: 'text',
        created_at: new Date().toISOString(),
      };

      // Atualiza estado com as duas mensagens
      setMessages((prev) => [...prev, tempUserMessage, tempAssistantMessage]);

      // Salva user msg no banco (background)
      saveMessage(convId, 'user', message, 'text', undefined, imageUrl);

      // 2. Dispara Request
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatInput: message,
          sessionId: sessionId,
          imageUrl: imageUrl,
          agentId: selectedAgentId || undefined,
          companyId: companyId,
          userId: userId,
          options: { web_search: webSearchEnabled },
          assistantMessageId: assistantMsgId, // Sync ID with backend to prevent duplicates
        }),
      });

      if (!response.body) {
        console.error('❌ [FRONT] Response sem body!');
        throw new Error('No response body');
      }

      // 3. Leitura do Stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // Guarda o resto incompleto

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          const dataStr = line.replace('data: ', '').trim();

          if (dataStr === '[DONE]') {
            break;
          }

          try {
            const data = JSON.parse(dataStr);
            if (data.token) {
              accumulatedResponse += data.token;

              // Check if we're in the middle of streaming UCP JSON
              // If so, don't update the UI until the JSON is complete
              const ucpJsonStart = accumulatedResponse.match(/\{"type"\s*:\s*"ucp_/);
              let shouldUpdateUI = true;

              if (ucpJsonStart && ucpJsonStart.index !== undefined) {
                // Count brackets from the UCP JSON start to see if it's complete
                let brackets = 0;
                let inString = false;
                let escapeNext = false;
                let jsonComplete = false;

                for (let i = ucpJsonStart.index; i < accumulatedResponse.length; i++) {
                  const char = accumulatedResponse[i];
                  if (escapeNext) { escapeNext = false; continue; }
                  if (char === '\\') { escapeNext = true; continue; }
                  if (char === '"' && !escapeNext) { inString = !inString; continue; }
                  if (!inString) {
                    if (char === '{') brackets++;
                    else if (char === '}') {
                      brackets--;
                      if (brackets === 0) { jsonComplete = true; break; }
                    }
                  }
                }

                // JSON is still incomplete - show only the text before it
                if (!jsonComplete) {
                  shouldUpdateUI = true;
                  // Update with only the text before the JSON
                  const visibleContent = accumulatedResponse.substring(0, ucpJsonStart.index).trim();
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id === assistantMsgId) {
                        return { ...msg, content: visibleContent };
                      }
                      return msg;
                    }),
                  );
                  shouldUpdateUI = false;
                }
              }

              if (shouldUpdateUI) {
                // Normal update (no UCP JSON being streamed, or UCP JSON is complete)
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id === assistantMsgId) {
                      return { ...msg, content: accumulatedResponse };
                    }
                    return msg;
                  }),
                );
              }
            }
          } catch (e) {
            console.warn('⚠️ [FRONT] Erro parse JSON:', e);
          }
        }
      }

      // Atualiza título da conversa no final
      fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updated_at: new Date().toISOString(),
          title: messages.length === 0 ? message.slice(0, 50) : undefined,
        }),
      });
    } catch (error) {
      console.error('❌ [FRONT] Erro Geral:', error);
      // Remove a mensagem vazia se deu erro fatal antes de começar
      setMessages((prev) => prev.filter((m) => m.role !== 'assistant' || m.content !== ''));

      const errorMsg: Message = {
        id: crypto.randomUUID(),
        conversation_id: conversationId || '',
        role: 'assistant',
        content: `Erro: ${error instanceof Error ? error.message : 'Desconhecido'}`,
        type: 'text',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendVoice = async (audioBase64: string, audioBlob: Blob) => {
    if (!userId) return;
    setIsLoading(true);

    try {
      let audioUrl: string | null = null;
      try {
        const { uploadVoiceMessage } = await import('@/lib/storageSetup');
        audioUrl = await uploadVoiceMessage(audioBlob);
      } catch (e) {
        console.warn('Upload audio fail', e);
      }

      const convId = await ensureConversation();

      // 🔥 OPTIMISTIC UPDATE: Adiciona mensagem do usuário imediatamente ao state
      // Isso garante que a primeira mensagem apareça mesmo antes do Realtime se inscrever
      const tempUserMessage: Message = {
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'user',
        content: '[Mensagem de voz]',
        type: 'voice',
        audio_url: audioUrl || undefined,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMessage]);

      // Salva mensagem do usuário no banco (Realtime vai ignorar duplicata pelo conteúdo check)
      await saveMessage(convId, 'user', '[Mensagem de voz]', 'voice', audioUrl || undefined);

      const response = await sendVoiceToN8N(
        audioBase64,
        sessionId,
        selectedAgentId,
        companyId!,
        userId,
      );

      // 🔥 FIX: Adiciona resposta do backend ao state imediatamente
      // Não depende mais 100% do Realtime
      if (response && response.output) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'assistant',
          content: response.output,
          type: 'text',
          created_at: new Date().toISOString(),
        };

        // Adiciona ao state, evitando duplicatas por conteúdo
        setMessages((prev) => {
          const exists = prev.some((m) => m.role === 'assistant' && m.content === response.output);
          if (exists) return prev;
          return [...prev, assistantMessage];
        });
      }
    } catch (error) {
      console.error('[AUDIO] Erro:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 🔥 CORREÇÃO: Nova conversa mantém o agente selecionado, só reseta session
  const handleNewConversation = useCallback(() => {
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    setConversationId(null);
    setMessages([]);
    // 🔥 NÃO reseta selectedAgentId aqui - mantém o agente escolhido
  }, [selectedAgentId]);

  // 🔥 CORREÇÃO: Ao selecionar conversa do sidebar, reseta states e deixa loadConversation sincronizar
  const handleSelectConversation = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
    setConversationId(null);
    setMessages([]);
    // 🔥 NÃO toca no selectedAgentId aqui - o loadConversation vai sincronizar
  }, []);

  if (isLoadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Carregando...
      </div>
    );
  }

  // Nome do agente atual para exibição
  const currentAgentName = agents.find((a) => a.id === selectedAgentId)?.name || 'Agente';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {userId && (
        <UnifiedSidebar
          userId={userId}
          currentSessionId={sessionId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
        />
      )}

      <div className="flex-1 flex flex-col h-full lg:ml-64 relative">
        {/* HEADER DO CHAT */}
        <div className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-6 justify-between shrink-0 z-20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center border border-blue-600/20 shadow-lg shadow-blue-600/5">
                <Bot className="w-5 h-5 text-blue-600" />
              </div>

              <div className="flex flex-col">
                {/* Header simplificado - só mostra o agente ativo */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">Conversando com</span>
                  <Badge
                    variant="outline"
                    className="bg-blue-600/10 text-blue-400 border-blue-600/20 text-xs py-0.5 px-2 h-5"
                  >
                    {currentAgentName}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleNewConversation}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              title="Novo Chat"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ÁREA DE MENSAGENS */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col">
              <EmptyState />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full pb-4">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  userAvatar={userAvatar || undefined}
                  userName={userName || undefined}
                  onSendMessage={(text) => handleSendMessage(text)}
                />
              ))}
              {/* Mostra typing indicator apenas quando loading E (não tem mensagens OU última não é assistant OU está vazia) */}
              {isLoading &&
                (messages.length === 0 ||
                  messages[messages.length - 1].role !== 'assistant' ||
                  !messages[messages.length - 1].content) && <TypingIndicator />}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* ÁREA DE INPUT */}
        <div className="flex-shrink-0 bg-gradient-to-t from-background via-background to-transparent pt-6 pb-6 px-4 z-10 w-full">
          <div className="max-w-3xl mx-auto">
            <InputArea
              onSendMessage={handleSendMessage}
              onSendVoice={handleSendVoice}
              disabled={isLoading}
              showWebSearch={isWebSearchAllowed}
              allowWebSearch={webSearchEnabled}
              onToggleWebSearch={() => setWebSearchEnabled(!webSearchEnabled)}
              companyId={companyId || undefined}
              agents={agents}
              selectedAgentId={selectedAgentId}
              onAgentChange={handleAgentChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
