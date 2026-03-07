'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { X, Send, MessageCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { LeadForm } from '@/components/embed/LeadForm';
import {
  extractUCPData,
  ProductCarousel,
  ProductCard,
  CheckoutButton,
  UCPData,
} from '@/components/ucp';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image_url?: string;
  created_at: string;
  senderName?: string | null; // Nome do admin quando Human Handoff
}

interface AgentPublic {
  id: string;
  company_id: string;
  name: string;
  avatar_url?: string;
  widget_config?: {
    title?: string;
    subtitle?: string;
    primaryColor?: string;
    position?: string;
    initialMessage?: string;
    showFooter?: boolean;
    requireLeadCapture?: boolean; // Nova flag
  };
}

interface LeadData {
  leadId: string;
  name: string;
  email: string;
}

export default function EmbedChat() {
  const params = useParams();
  const agentId = params.agentId as string;

  // Estados principais
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Estados do Lead Gen
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);


  // Chave para localStorage
  const getStorageKey = (suffix: string) => `scale_${agentId}_${suffix}`;

  // ==========================================================================
  // SESSION TTL HELPERS (24 hours)
  // ==========================================================================
  const TTL_24H_MS = 24 * 60 * 60 * 1000;

  const updateLastActive = () => {
    if (agentId) {
      localStorage.setItem(getStorageKey('last_active'), Date.now().toString());
    }
  };

  const isSessionExpired = (): boolean => {
    const lastActive = localStorage.getItem(getStorageKey('last_active'));
    if (!lastActive) return false; // No timestamp = new session, not expired
    return (Date.now() - parseInt(lastActive, 10)) > TTL_24H_MS;
  };

  const getPersistedAnonymousSession = (): string | null => {
    return localStorage.getItem(getStorageKey('anonymous_session'));
  };

  const persistAnonymousSession = (id: string) => {
    localStorage.setItem(getStorageKey('anonymous_session'), id);
  };

  const clearExpiredSession = async (companyId: string, expiredSessionId: string) => {
    console.log('[Session TTL] Session expired, clearing...');

    // 1. Clear backend memory (LangGraph checkpoints)
    try {
      await fetch('/api/chat/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: expiredSessionId, companyId }),
      });
      console.log('[Session TTL] Backend memory cleared');
    } catch (e) {
      console.error('[Session TTL] Error clearing backend:', e);
    }

    // 2. Clear localStorage
    localStorage.removeItem(getStorageKey('messages'));
    localStorage.removeItem(getStorageKey('lead'));
    localStorage.removeItem(getStorageKey('last_active'));
    localStorage.removeItem(getStorageKey('anonymous_session'));

    console.log('[Session TTL] Session reset complete');
  };

  // Load agent config and check lead status
  useEffect(() => {
    if (!agentId) return;

    // =========================================================================
    // STEP 1: Check Session TTL FIRST
    // =========================================================================
    const storedLead = localStorage.getItem(getStorageKey('lead'));
    const anonymousSession = getPersistedAnonymousSession();
    const currentSessionId = storedLead ? JSON.parse(storedLead).leadId : anonymousSession;

    // Fetch agent first to get company_id for cleanup
    fetch(`/api/agents/${agentId}/public`)
      .then((res) => res.json())
      .then(async (data) => {
        if (data.error) {
          console.error('Agent not found:', data.error);
          setLoading(false);
          return;
        }

        // =====================================================================
        // STEP 2: If session expired, clean up and start fresh
        // =====================================================================
        if (isSessionExpired() && currentSessionId && data.company_id) {
          await clearExpiredSession(data.company_id, currentSessionId);
          // Reset states
          setMessages([]);
          setLeadData(null);
          setSessionId('');
        }

        // =====================================================================
        // STEP 3: Load session data (if not expired)
        // =====================================================================
        const freshStoredLead = localStorage.getItem(getStorageKey('lead'));
        if (freshStoredLead) {
          try {
            const parsed = JSON.parse(freshStoredLead);
            setLeadData(parsed);
            setSessionId(parsed.leadId);
          } catch (e) {
            console.error('Error loading lead data:', e);
            localStorage.removeItem(getStorageKey('lead'));
          }
        }

        // Load stored messages
        const storedMessages = localStorage.getItem(getStorageKey('messages'));
        if (storedMessages) {
          try {
            setMessages(JSON.parse(storedMessages));
          } catch (e) {
            console.error('Error loading messages:', e);
          }
        }

        setAgent(data);

        // Verificar se precisa mostrar LeadForm
        const hasStoredLead = localStorage.getItem(getStorageKey('lead'));
        const requireCapture = data.widget_config?.requireLeadCapture !== false;

        if (!hasStoredLead && requireCapture) {
          setShowLeadForm(true);
        } else if (!hasStoredLead && !requireCapture) {
          // ===================================================================
          // FIX: Persist anonymous sessionId to survive F5
          // ===================================================================
          const existingAnonymous = getPersistedAnonymousSession();
          if (existingAnonymous) {
            setSessionId(existingAnonymous);
          } else {
            const newSession = crypto.randomUUID();
            persistAnonymousSession(newSession);
            setSessionId(newSession);
          }
        }

        // Add initial message if no history and lead already identified
        if (!storedMessages && data.widget_config?.initialMessage && hasStoredLead) {
          const welcomeMsg: Message = {
            id: 'welcome',
            role: 'assistant',
            content: data.widget_config.initialMessage,
            created_at: new Date().toISOString(),
          };
          setMessages([welcomeMsg]);
        }

        // Update last active timestamp
        updateLastActive();

        setLoading(false);

        // Notify parent that widget is ready
        window.parent.postMessage({ type: 'scale:ready' }, '*');

        // Send position config
        if (data.widget_config?.position) {
          window.parent.postMessage(
            {
              type: 'scale:position',
              position: data.widget_config.position,
            },
            '*',
          );
        }
      })
      .catch((err) => {
        console.error('Error loading agent:', err);
        setLoading(false);
      });
  }, [agentId]);

  // Save messages to localStorage
  useEffect(() => {
    if (messages.length > 0 && agentId) {
      localStorage.setItem(getStorageKey('messages'), JSON.stringify(messages));
    }
  }, [messages, agentId]);

  // Notify parent about open/close state
  useEffect(() => {
    window.parent.postMessage(
      {
        type: 'scale:resize',
        isOpen: isOpen,
        width: '380px',
        height: '600px',
      },
      '*',
    );
  }, [isOpen]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for toggle from parent
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'scale:toggle') {
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // 🔥 POLLING: Buscar mensagens novas do servidor (para Human Handoff)
  useEffect(() => {
    if (!sessionId || !isOpen || sending) return;

    const pollMessages = async () => {
      try {
        const response = await fetch(`/api/widget/messages?session_id=${sessionId}`);
        if (!response.ok) return;

        const data = await response.json();

        // Se tiver mensagens do servidor, sincronizar
        if (data.messages && data.messages.length > 0) {
          // Converter para formato do widget
          const serverMessages: Message[] = data.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            image_url: m.image_url,
            created_at: m.created_at,
            // Adicionar nome do admin se for mensagem do admin (sender_user_id)
            senderName: m.sender
              ? `${m.sender.first_name || ''} ${m.sender.last_name || ''}`.trim()
              : null,
          }));

          // Atualizar apenas se houver mais mensagens ou mensagens diferentes
          setMessages((prev) => {
            // Se o servidor retornou MENOS mensagens, provavelmente temos mensagens
            // locais otimistas (ou de erro) que não queremos perder.
            if (serverMessages.length < prev.length) {
              return prev;
            }

            // Se o servidor retornou MAIS mensagens, assumimos que há novidades
            if (serverMessages.length > prev.length) {
              return serverMessages;
            }

            // Se têm o MESMO tamanho, verificamos se o id da última coincide.
            // Se for diferente, pode ser a sincronização do ID local otimista com o ID do banco.
            const lastServer = serverMessages[serverMessages.length - 1];
            const lastLocal = prev[prev.length - 1];
            if (lastServer && lastLocal && lastServer.id !== lastLocal.id) {
              return serverMessages;
            }

            return prev;
          });
        }
      } catch (err) {
        // Silently fail - polling is best-effort
      }
    };

    // Poll every 3 seconds while chat is open and not sending
    const interval = setInterval(pollMessages, 3000);

    // Also poll immediately
    pollMessages();

    return () => clearInterval(interval);
  }, [sessionId, isOpen, sending]);

  // Handler para identificação do lead
  const handleLeadSubmit = async (data: { name: string; email: string }) => {
    if (!agent) return;

    setIsIdentifying(true);
    try {
      const response = await fetch('/api/leads/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          name: data.name,
          companyId: agent.company_id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to identify lead');
      }

      const result = await response.json();

      const newLeadData: LeadData = {
        leadId: result.leadId,
        name: data.name,
        email: data.email,
      };

      // Salvar no localStorage
      localStorage.setItem(getStorageKey('lead'), JSON.stringify(newLeadData));
      setLeadData(newLeadData);
      setSessionId(result.leadId); // Usar leadId como sessionId
      setShowLeadForm(false);

      // Adicionar mensagem de boas-vindas personalizada
      const welcomeContent =
        agent.widget_config?.initialMessage || `Olá ${data.name}! Como posso ajudar você hoje?`;

      const welcomeMsg: Message = {
        id: 'welcome-' + Date.now(),
        role: 'assistant',
        content: welcomeContent,
        created_at: new Date().toISOString(),
      };
      setMessages([welcomeMsg]);
    } catch (error) {
      console.error('Error identifying lead:', error);
      alert('Erro ao iniciar. Tente novamente.');
    } finally {
      setIsIdentifying(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || sending || !agent || !sessionId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputText.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setSending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatInput: userMessage.content,
          sessionId: sessionId, // Lead ID para memória
          companyId: agent.company_id,
          userId: leadData?.leadId || null, // Passa leadId para o backend
          agentId: agentId,
          channel: 'widget',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();

      // Only add assistant message if there's actual content
      // (empty output means human handoff mode - message comes via realtime)
      if (data.output) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.output,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Desculpe, não foi possível processar sua mensagem. Tente novamente.',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
      updateLastActive(); // Keep session alive
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-transparent">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white rounded-2xl">
        <p className="text-gray-500 text-sm">Widget não disponível</p>
      </div>
    );
  }

  const config = agent.widget_config || {};
  const primaryColor = config.primaryColor || '#2563EB';

  // Closed state - just show the launcher button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full h-full rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 overflow-hidden"
        style={{ backgroundColor: primaryColor }}
      >
        {agent.avatar_url ? (
          <img
            src={agent.avatar_url}
            alt={agent.name}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <MessageCircle className="w-8 h-8 text-white" />
        )}
      </button>
    );
  }

  // Show Lead Form if not identified yet
  if (showLeadForm) {
    return (
      <div className="h-full w-full flex flex-col overflow-hidden bg-white rounded-2xl shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 text-white shrink-0"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="flex items-center gap-3">
            {agent.avatar_url ? (
              <img
                src={agent.avatar_url}
                alt=""
                className="w-10 h-10 rounded-full bg-white/20 object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle className="w-5 h-5" />
              </div>
            )}
            <div>
              <h3 className="font-bold text-sm leading-tight">{config.title || agent.name}</h3>
              <p className="text-xs opacity-90">{config.subtitle || 'Online'}</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="hover:bg-white/20 p-2 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lead Form */}
        <LeadForm
          onSubmit={handleLeadSubmit}
          isLoading={isIdentifying}
          agentName={agent.name}
          primaryColor={primaryColor}
        />
      </div>
    );
  }

  // Open state - show full chat
  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white rounded-2xl shadow-2xl">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 text-white shrink-0"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="flex items-center gap-3">
          {agent.avatar_url ? (
            <img
              src={agent.avatar_url}
              alt=""
              className="w-10 h-10 rounded-full bg-white/20 object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </div>
          )}
          <div>
            <h3 className="font-bold text-sm leading-tight">{config.title || agent.name}</h3>
            <p className="text-xs opacity-90">
              {leadData?.name ? `Olá, ${leadData.name}` : config.subtitle || 'Online'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="hover:bg-white/20 p-2 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-4">
        {messages.map((msg) => {
          const isHumanAgent = msg.role === 'assistant' && !!msg.senderName;

          // 🛒 UCP: Detectar e extrair conteúdo de comércio
          let displayContent = msg.content;
          let ucpData: UCPData | null = null;

          if (msg.role === 'assistant' && msg.content) {
            const extracted = extractUCPData(msg.content);
            displayContent = extracted.text;
            ucpData = extracted.data;

            // If no UCP was fully parsed but content contains partial UCP JSON
            // (streaming in progress), hide the partial JSON from display
            if (!ucpData && displayContent) {
              const partialUcpMatch = displayContent.match(/\{"type"\s*:\s*"ucp_/);
              if (partialUcpMatch && partialUcpMatch.index !== undefined) {
                displayContent = displayContent.substring(0, partialUcpMatch.index).trim();
              }
            }
          }

          // Função para renderizar UCP
          const renderUCPContent = (data: UCPData) => {
            switch (data.type) {
              case 'ucp_product_list':
                return (
                  <ProductCarousel
                    products={data.products}
                    shopDomain={data.shop_domain}
                    query={data.query}
                    onSendMessage={(text) => {
                      setInputText(text);
                    }}
                  />
                );
              case 'ucp_product_detail':
                return (
                  <ProductCard
                    product={data.product}
                    size="large"
                    onSendMessage={(text) => {
                      setInputText(text);
                    }}
                  />
                );
              case 'ucp_checkout':
                return <CheckoutButton data={data} />;
              default:
                return null;
            }
          };

          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className="max-w-[95%] flex flex-col gap-2">
                {/* 🛒 UCP Content - Carrossel, Cards, Checkout */}
                {ucpData && <div className="w-full">{renderUCPContent(ucpData)}</div>}

                {/* Mensagem de texto normal */}
                {displayContent && displayContent.trim() && (
                  <div
                    className={`p-3 rounded-2xl text-sm ${msg.role === 'user'
                      ? 'rounded-br-sm text-white'
                      : 'rounded-bl-sm bg-white border border-gray-100 shadow-sm text-gray-800'
                      }`}
                    style={msg.role === 'user' ? { backgroundColor: primaryColor } : {}}
                  >
                    {/* Badge para atendimento humano */}
                    {isHumanAgent && (
                      <div className="text-xs font-medium text-purple-600 mb-1">
                        👤 {msg.senderName}
                      </div>
                    )}

                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown>{displayContent}</ReactMarkdown>
                      </div>
                    ) : (
                      displayContent
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm p-3">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 border-t bg-white shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Digite sua mensagem..."
            className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || sending}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-95"
            style={{ backgroundColor: primaryColor }}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Footer */}
      {config.showFooter !== false && (
        <div className="text-center py-2 bg-gray-50 border-t shrink-0">
          <a
            href="https://agentscale.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Powered by Agent Scale AI
          </a>
        </div>
      )}
    </div>
  );
}
