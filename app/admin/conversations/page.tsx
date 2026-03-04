'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import {
  MessageSquare,
  Zap,
  Share2,
  Search,
  User,
  Filter,
  Send,
  MoreVertical,
  CheckCheck,
  RefreshCw,
  X,
  Mic,
  Image as ImageIcon,
  Square,
  Loader2,
  Hand,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import VoiceMessage from '@/components/VoiceMessage';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/lib/supabase'; // KEPT: Only for Realtime subscriptions
import { useAdminRole } from '@/hooks/useAdminRole';
import { toast } from 'sonner';
import { Message } from '@/lib/types';
import {
  extractUCPData,
  ProductCarousel,
  ProductCard,
  CheckoutButton,
  UCPData,
} from '@/components/ucp';

// --- TIPOS ---
interface Conversation {
  id: string;
  user_name: string | null;
  user_phone: string | null;
  user_avatar: string | null;
  unread_count: number;
  last_message_preview: string | null;
  agent_name: string;
  agent_id: string | null;
  session_id: string; // 🔔 NOVO: para enviar mensagem
  status: string; // 🔔 NOVO: open, HUMAN_REQUESTED, closed
  created_at: string;
  last_message_at: string;
  status_color: 'red' | 'yellow' | 'green';
  channel: string;
  users_v2?: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
  agents?: {
    id: string;
    name: string;
  } | null;
}

type ChannelFilter = 'all' | 'whatsapp' | 'web';

export default function AdminConversationsPage() {
  const { companyId } = useAdminRole();

  // Estados da Lista
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState({ total: 0, agents: 0, channels: 0 });
  const [isLoadingList, setIsLoadingList] = useState(true);

  // ============================================================
  // [NEW] Estados dos Filtros
  // ============================================================
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  // Estados do Chat Ativo
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 🔔 Estado para resposta humana
  const [humanReplyText, setHumanReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [adminName, setAdminName] = useState<string>('Admin');
  const [adminAvatar, setAdminAvatar] = useState<string | null>(null);

  // 🎤 Estados para upload de mídia
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🔔 Buscar nome e avatar do admin logado
  useEffect(() => {
    const fetchAdminData = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.user?.first_name) {
            setAdminName(`${data.user.first_name} ${data.user.last_name || ''}`.trim());
          } else if (data.user?.email) {
            setAdminName(data.user.email.split('@')[0]);
          }
          if (data.user?.avatar_url) {
            setAdminAvatar(data.user.avatar_url);
          }
        }
      } catch (err) {
        // Silent fail - not critical
      }
    };
    fetchAdminData();
  }, []);

  // ============================================================
  // [NEW] Lista filtrada (memoizada para performance)
  // 🔔 HUMAN_REQUESTED aparece primeiro!
  // ============================================================
  const filteredConversations = useMemo(() => {
    const filtered = conversations.filter((conv) => {
      // Filtro por canal
      if (channelFilter !== 'all' && conv.channel !== channelFilter) {
        return false;
      }

      // Filtro por busca (nome, telefone, preview)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const nameMatch = conv.user_name?.toLowerCase().includes(query);
        const phoneMatch = conv.user_phone?.toLowerCase().includes(query);
        const previewMatch = conv.last_message_preview?.toLowerCase().includes(query);

        if (!nameMatch && !phoneMatch && !previewMatch) {
          return false;
        }
      }

      return true;
    });

    // 🔔 ORDENAÇÃO: HUMAN_REQUESTED primeiro, depois por last_message_at
    return filtered.sort((a, b) => {
      const aHuman = a.status === 'HUMAN_REQUESTED' ? 1 : 0;
      const bHuman = b.status === 'HUMAN_REQUESTED' ? 1 : 0;
      if (aHuman !== bHuman) return bHuman - aHuman;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });
  }, [conversations, searchQuery, channelFilter]);

  // Função de busca (reutilizável)
  const fetchConversations = async (isBackground = false) => {
    if (!companyId) return;

    if (!isBackground) setIsLoadingList(true);
    try {
      // 🔥 QUERY VIA API (com Service Role)
      const response = await fetch('/api/admin/conversations');
      if (!response.ok) throw new Error('Falha ao buscar conversas');

      const result = await response.json();
      const data = result.conversations;

      const loadedConversations = (data as any[]).map((conv) => {
        const profileName = conv.users_v2?.first_name
          ? `${conv.users_v2.first_name} ${conv.users_v2.last_name || ''}`.trim()
          : null;

        const displayName =
          conv.user_name ||
          profileName ||
          conv.user_phone ||
          conv.users_v2?.email ||
          'Usuário Desconhecido';

        const displayAvatar = conv.user_avatar || conv.users_v2?.avatar_url;

        return {
          ...conv,
          user_name: displayName,
          user_avatar: displayAvatar,
          // 🔥 ATUALIZADO: Usa nome do agente do JOIN
          agent_name: conv.agents?.name || conv.agent_name || 'Smith Agent',
          status_color: conv.status_color || 'green',
          // 🔔 Status para Human Handoff
          status: conv.status || 'open',
        };
      });

      setConversations(loadedConversations);

      // Stats (baseado em TODAS as conversas, não filtradas)
      const uniqueAgents = new Set(loadedConversations.map((c) => c.agent_name)).size;
      const uniqueChannels = new Set(loadedConversations.map((c) => c.channel)).size;
      setStats({
        total: loadedConversations.length,
        agents: uniqueAgents || 0,
        channels: uniqueChannels || 0,
      });
    } catch (err) {
      console.error('Erro ao buscar conversas:', err);
    } finally {
      if (!isBackground) setIsLoadingList(false);
    }
  };

  // 1. SETUP INICIAL E REALTIME
  useEffect(() => {
    if (!companyId) return;

    fetchConversations();

    const channel = supabase
      .channel('admin-inbox')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          fetchConversations(true);
        },
      )
      .subscribe();

    const interval = setInterval(() => {
      fetchConversations(true);
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [companyId]);

  // 2. FETCH MESSAGES (Ao clicar na conversa)
  useEffect(() => {
    async function fetchMessages() {
      if (!selectedId) return;

      setIsLoadingChat(true);
      try {
        // 🔥 QUERY VIA API
        const response = await fetch(`/api/messages?conversation_id=${selectedId}`);
        if (!response.ok) throw new Error('Falha ao buscar mensagens');

        const result = await response.json();
        setMessages(result.messages || []);

        // Marcar como lida via API
        await fetch(`/api/conversations/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unread_count: 0 }),
        });

        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)),
        );
      } catch (err) {
        console.error('Erro ao buscar mensagens:', err);
        toast.error('Erro ao carregar mensagens.');
      } finally {
        setIsLoadingChat(false);
      }
    }

    fetchMessages();
  }, [selectedId]);

  // 🔔 REALTIME: Receber mensagens do usuário instantaneamente (Admin vê em tempo real)
  useEffect(() => {
    if (!selectedId) return;

    const channel = supabase
      .channel(`admin-messages:${selectedId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        async (payload) => {
          const newMessage = payload.new as Message;

          // 🔥 FIX: Se mensagem tem sender_user_id, buscar dados do sender
          // Realtime não traz JOIN, então precisamos enriquecer manualmente
          if (newMessage.sender_user_id && !newMessage.sender) {
            try {
              const res = await fetch(`/api/users/${newMessage.sender_user_id}`);
              if (res.ok) {
                const data = await res.json();
                if (data.user) {
                  newMessage.sender = {
                    first_name: data.user.first_name,
                    last_name: data.user.last_name,
                    avatar_url: data.user.avatar_url,
                  };
                }
              }
            } catch {
              // Fallback: usa dados do admin logado
              newMessage.sender = {
                first_name: adminName,
                last_name: '',
                avatar_url: adminAvatar,
              };
            }
          }

          // Evita duplicar mensagem que já existe no state
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === newMessage.id);
            if (exists) return prev;
            return [...prev, newMessage];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId, adminName, adminAvatar]);

  // Auto-scroll para o final quando mensagens mudam ou chat é aberto
  useEffect(() => {
    if (scrollRef.current) {
      // setTimeout garante que o scroll aconteça após o render do DOM
      setTimeout(() => {
        scrollRef.current!.scrollTop = scrollRef.current!.scrollHeight;
      }, 0);
    }
  }, [messages, selectedId, isLoadingChat]); // Adicionado selectedId e loading

  // --- HELPERS ---
  const getBarColor = (color: string) => {
    switch (color) {
      case 'red':
        return 'bg-red-500';
      case 'yellow':
        return 'bg-yellow-500';
      case 'green':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getTimeAgo = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.abs(now.getTime() - date.getTime()) / 36e5;
    if (diffInHours < 1) return 'agora';
    if (diffInHours < 24) return `há ${Math.floor(diffInHours)}h`;
    return `há ${Math.floor(diffInHours / 24)}d`;
  };

  const getChannelBadge = (channel: string) => {
    const isWhatsapp = channel === 'whatsapp';
    const isWidget = channel === 'widget';

    /* 🔔 ATUALIZADO: Badges solicitadas pelo usuário */
    let colorClass = '';
    let label = '';

    if (isWhatsapp) {
      colorClass = 'bg-green-700 text-white border-green-800 hover:bg-green-800'; // WhatsApp: Verde Escuro + Branco
      label = 'WhatsApp';
    } else if (isWidget) {
      colorClass = 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'; // Widget: Azul Padrão + Branco
      label = 'Widget';
    } else {
      colorClass = 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'; // Web: Azul Padrão + Branco
      label = 'Web';
    }

    return (
      <Badge
        className={`h-5 px-1.5 text-[9px] uppercase tracking-wide border font-bold ${colorClass}`}
      >
        {label}
      </Badge>
    );
  };

  // ============================================================
  // [NEW] Helper para label do filtro ativo
  // ============================================================
  const getFilterLabel = () => {
    switch (channelFilter) {
      case 'whatsapp':
        return 'WhatsApp';
      case 'web':
        return 'Web';
      default:
        return null;
    }
  };

  // ============================================================
  // 🔔 Enviar resposta humana
  // ============================================================
  const handleSendHumanReply = async () => {
    const conversation = conversations.find((c) => c.id === selectedId);
    if (!humanReplyText.trim() || !selectedId || !conversation) return;

    setIsSendingReply(true);
    try {
      // 1. Salvar mensagem via API (bypassa RLS, usa sender_user_id via sessão)
      const response = await fetch('/api/admin/conversations/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedId,
          content: humanReplyText.trim(), // Sem prefixo - backend usa sender_user_id
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send message');
      }

      // WhatsApp delivery is now handled by the API Route server-side
      // No direct BACKEND_URL call needed here

      // Mensagem será adicionada automaticamente via Realtime
      setHumanReplyText('');
      toast.success('Mensagem enviada!');
    } catch (err) {
      console.error('Erro ao enviar resposta:', err);
      toast.error('Erro ao enviar mensagem.');
    } finally {
      setIsSendingReply(false);
    }
  };

  // ============================================================
  // 🔔 Encerrar atendimento humano (devolver para IA)
  // ============================================================
  const handleCloseHumanHandoff = async () => {
    if (!selectedId) return;

    try {
      const response = await fetch('/api/admin/conversations/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedId,
          status: 'open',
        }),
      });

      if (!response.ok) throw new Error('Failed to update status');

      // Atualizar estado local
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, status: 'open' } : c)),
      );

      toast.success('Atendimento devolvido para a IA!');
    } catch (err) {
      console.error('Erro ao encerrar handoff:', err);
      toast.error('Erro ao devolver para IA.');
    }
  };

  // ============================================================
  // 🖐️ Assumir Conversa (Take Over)
  // ============================================================
  const handleTakeOver = async () => {
    if (!selectedId) return;

    try {
      const response = await fetch('/api/admin/conversations/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedId,
          status: 'HUMAN_REQUESTED',
          reason: 'Intervenção Manual do Admin',
        }),
      });

      if (!response.ok) throw new Error('Failed to take over');

      // Atualizar estado local
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, status: 'HUMAN_REQUESTED' } : c)),
      );

      toast.success('Você assumiu o controle da conversa. A IA foi pausada.');
    } catch (err) {
      console.error('Erro ao assumir conversa:', err);
      toast.error('Erro ao assumir conversa.');
    }
  };

  // ============================================================
  // 🖼️ Upload de Imagem
  // ============================================================
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;

    setIsUploadingMedia(true);
    try {
      const timestamp = Date.now();
      const filename = `${timestamp}_${file.name}`;
      const path = `admin/${selectedId}/${filename}`;

      // Storage upload (still uses anon client, OK for public buckets)
      const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('chat-media').getPublicUrl(path);

      // Inserir mensagem via API (bypassa RLS)
      const response = await fetch('/api/admin/conversations/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedId,
          content: '📷 Imagem enviada', // Sem prefixo - backend usa sender_user_id
          image_url: publicUrl,
          type: 'text',
        }),
      });

      if (!response.ok) throw new Error('Failed to save message');

      // WhatsApp delivery is now handled by the API Route server-side

      toast.success('Imagem enviada!');
    } catch (err) {
      console.error('Erro no upload de imagem:', err);
      toast.error('Erro ao enviar imagem.');
    } finally {
      setIsUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ============================================================
  // 🎤 Gravação de Áudio
  // ============================================================
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        await sendAudioMessage(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao iniciar gravação:', err);
      toast.error('Erro ao acessar microfone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendAudioMessage = async (audioBlob: Blob) => {
    if (!selectedId) return;

    setIsUploadingMedia(true);
    try {
      const timestamp = Date.now();
      const filename = `${timestamp}_audio.webm`;
      const path = `admin/${selectedId}/${filename}`;

      // Storage upload (still uses anon client, OK for public buckets)
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(path, audioBlob);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('voice-messages').getPublicUrl(path);

      // Inserir mensagem via API (bypassa RLS)
      const response = await fetch('/api/admin/conversations/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedId,
          content: '🎤 Áudio enviado', // Sem prefixo - backend usa sender_user_id
          audio_url: publicUrl,
          type: 'voice',
        }),
      });

      if (!response.ok) throw new Error('Failed to save message');

      // WhatsApp delivery is now handled by the API Route server-side

      toast.success('Áudio enviado!');
    } catch (err) {
      console.error('Erro no upload de áudio:', err);
      toast.error('Erro ao enviar áudio.');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const activeConversation = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex h-full bg-background text-foreground overflow-hidden">
      {/* ================= SIDEBAR (LISTA) ================= */}
      <div className="w-[380px] flex flex-col border-r border-border bg-card relative flex-shrink-0">
        {/* Header Sidebar */}
        <div className="p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">Inbox</h2>
              {/* Badge mostrando filtro ativo */}
              {channelFilter !== 'all' && (
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-purple-600/20 text-purple-400 border-purple-500/30 cursor-pointer hover:bg-purple-600/30"
                  onClick={() => setChannelFilter('all')}
                >
                  {getFilterLabel()}
                  <X className="w-3 h-3 ml-1" />
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => fetchConversations()}
                title="Atualizar lista"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* ============================================================ */}
              {/* [NEW] Dropdown de Filtro por Canal */}
              {/* ============================================================ */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 hover:text-foreground ${channelFilter !== 'all' ? 'text-purple-400' : 'text-muted-foreground'}`}
                    title="Filtrar por canal"
                  >
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-card border-border text-foreground min-w-[160px]"
                >
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    Filtrar por Canal
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border" />

                  <DropdownMenuItem
                    onClick={() => setChannelFilter('all')}
                    className={`cursor-pointer ${channelFilter === 'all' ? 'bg-purple-600/20 text-purple-400' : 'hover:bg-muted'}`}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Todos os Canais
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => setChannelFilter('whatsapp')}
                    className={`cursor-pointer ${channelFilter === 'whatsapp' ? 'bg-green-600/20 text-green-400' : 'hover:bg-muted'}`}
                  >
                    <div className="w-4 h-4 mr-2 rounded-full bg-green-500/20 flex items-center justify-center">
                      <span className="text-[8px]">📱</span>
                    </div>
                    WhatsApp
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => setChannelFilter('web')}
                    className={`cursor-pointer ${channelFilter === 'web' ? 'bg-orange-600/20 text-orange-400' : 'hover:bg-muted'}`}
                  >
                    <div className="w-4 h-4 mr-2 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <span className="text-[8px]">🌐</span>
                    </div>
                    Web Chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ============================================================ */}
          {/* [NEW] Input de Busca Funcional */}
          {/* ============================================================ */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Buscar por nome, telefone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9 bg-muted/50 border-border text-foreground focus:ring-blue-600 h-9 text-sm placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Contador de resultados quando filtrando */}
          {(searchQuery || channelFilter !== 'all') && (
            <div className="mt-2 text-xs text-muted-foreground">
              {filteredConversations.length} de {conversations.length} conversas
            </div>
          )}
        </div>

        {/* Lista Scrollável */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {filteredConversations.length === 0 && !isLoadingList && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {searchQuery || channelFilter !== 'all'
                  ? 'Nenhuma conversa encontrada com esses filtros.'
                  : 'Nenhuma conversa encontrada.'}
              </div>
            )}

            {/* [CHANGED] Usa filteredConversations ao invés de conversations */}
            {filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`
                                    relative p-4 cursor-pointer transition-all border-b border-black/10 dark:border-white/10
                                    hover:bg-muted/50 group
                                    ${selectedId === conv.id ? 'bg-muted' : 'bg-card'}
                                `}
              >
                <div className="flex gap-3 mb-2">
                  <Avatar className="h-10 w-10 border border-border">
                    <AvatarImage src={conv.user_avatar || undefined} />
                    <AvatarFallback className="bg-blue-600 text-white font-bold text-xs">
                      {(conv.user_name || 'U').substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <h3 className="text-sm font-semibold text-foreground truncate pr-2">
                        {conv.user_name}
                      </h3>

                      <div className="flex items-center gap-2">
                        {/* 🔔 Badge HUMANO para conversas que precisam de atendimento */}
                        {conv.status === 'HUMAN_REQUESTED' && (
                          <Badge className="h-5 px-1.5 text-[9px] uppercase tracking-wide font-bold bg-red-600 text-white border-0 animate-pulse">
                            HUMANO
                          </Badge>
                        )}

                        {getChannelBadge(conv.channel)}

                        {conv.unread_count > 0 && (
                          <div className="bg-red-600 text-white text-[10px] font-bold px-1.5 h-4 rounded-full flex items-center justify-center min-w-[18px]">
                            {conv.unread_count}
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground truncate leading-relaxed">
                      {conv.last_message_preview || 'Nova conversa iniciada'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pl-[52px]">
                  <div className="flex items-center gap-1.5">
                    {/* 🔥 ATUALIZADO: Badge colorida do agente */}
                    <Badge
                      className="h-4 px-1.5 text-[9px] border-blue-700 bg-blue-600 text-white"
                    >
                      🤖 {conv.agent_name}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {getTimeAgo(conv.last_message_at)}
                  </span>
                </div>

                {selectedId === conv.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea >
      </div >

      {/* ================= PAINEL DIREITO (CHAT) ================= */}
      < div className="flex-1 bg-background/50 flex flex-col h-full relative overflow-hidden" >
        {!selectedId ? (
          // --- MODO STATS ---
          <div className="flex-1 flex flex-col items-center justify-center p-12 overflow-y-auto">
            <div className="max-w-4xl w-full">
              <h1 className="text-2xl font-bold text-foreground text-center mb-16 tracking-tight">
                Visão Geral do Atendimento
              </h1>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <Card className="bg-card border-none ring-1 ring-border p-8 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-full bg-blue-600/10 flex items-center justify-center mb-6">
                    <MessageSquare className="w-7 h-7 text-blue-600" />
                  </div>
                  <span className="text-5xl font-bold text-foreground mb-3">{stats.total}</span>
                  <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                    Conversas
                  </span>
                </Card>
                <Card className="bg-card border-none ring-1 ring-border p-8 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-full bg-blue-600/10 flex items-center justify-center mb-6">
                    <Zap className="w-7 h-7 text-blue-600" />
                  </div>
                  <span className="text-5xl font-bold text-foreground mb-3">{stats.agents}</span>
                  <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                    Agentes
                  </span>
                </Card>
                <Card className="bg-card border-none ring-1 ring-border p-8 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-full bg-blue-600/10 flex items-center justify-center mb-6">
                    <Share2 className="w-7 h-7 text-blue-600" />
                  </div>
                  <span className="text-5xl font-bold text-foreground mb-3">{stats.channels}</span>
                  <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                    Canais
                  </span>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          // --- MODO CHAT ---
          <>
            {/* Header Fixo */}
            <div className="h-16 border-b border-border bg-card flex items-center justify-between px-6 flex-shrink-0">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarImage src={activeConversation?.user_avatar || undefined} />
                  <AvatarFallback className="bg-primary text-primary-foreground font-bold text-xs">
                    {(activeConversation?.user_name || 'U').substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-sm font-bold text-foreground">{activeConversation?.user_name}</h3>
                  <div className="flex items-center gap-2">
                    {activeConversation && getChannelBadge(activeConversation.channel)}
                    {activeConversation?.user_phone && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {activeConversation.user_phone}
                        </span>
                      </>
                    )}
                    {/* 🔥 NOVO: Mostrar agente no header do chat */}
                    {activeConversation?.agent_name && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                        <Badge
                          className="h-4 px-1.5 text-[9px] border-blue-700 bg-blue-600 text-white"
                        >
                          🤖 {activeConversation.agent_name}
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 🔔 Badge HUMANO quando em atendimento humano */}
              {activeConversation?.status === 'HUMAN_REQUESTED' && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs px-2 py-1">
                  👤 HUMANO
                </Badge>
              )}
            </div>

            {/* Área de Mensagens */}
            <div
              className="flex-1 overflow-y-auto p-6 space-y-6 bg-background/50 min-h-0"
              ref={scrollRef}
            >
              {isLoadingChat ? (
                <div className="flex justify-center items-center h-full text-muted-foreground text-sm">
                  Carregando...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
                  <MessageSquare className="w-8 h-8 opacity-20" />
                  <p className="text-sm">Nenhuma mensagem registrada.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.role === 'user';

                  // ✅ NOVA LÓGICA: Usa sender do JOIN (FK users_v2)
                  // Fallback para regex para mensagens antigas que ainda têm prefixo
                  const hasSenderFromDb = !!msg.sender_user_id && !!msg.sender;
                  const humanMatch = !hasSenderFromDb && msg.content?.match(/^\[👤\s+(.+?)\]\n/);
                  const isHumanMessage = hasSenderFromDb || !!humanMatch;

                  // Nome e avatar do remetente
                  const senderName = hasSenderFromDb
                    ? `${msg.sender?.first_name || ''} ${msg.sender?.last_name || ''}`.trim()
                    : humanMatch
                      ? humanMatch[1]
                      : null;
                  const senderAvatar = hasSenderFromDb ? msg.sender?.avatar_url : null;

                  // Remove o prefixo do conteúdo para exibição (retrocompatibilidade)
                  let displayContent = humanMatch
                    ? msg.content.replace(/^\[👤\s+.+?\]\n/, '')
                    : msg.content;

                  // 🛒 UCP: Detectar e extrair conteúdo de comércio
                  let ucpData: UCPData | null = null;
                  if (!isUser && displayContent) {
                    const extracted = extractUCPData(displayContent);
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

                  // Remove textos desnecessários de mídia
                  const isMediaOnly =
                    displayContent === '📷 Imagem enviada' ||
                    displayContent === '🎤 Áudio enviado' ||
                    displayContent === '[Mensagem de voz]';
                  const hasAudio = !!msg.audio_url;
                  const hasImage = !!msg.image_url;

                  return (
                    <div
                      key={msg.id}
                      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {/* 📷 Avatar para mensagens humanas */}
                      {isHumanMessage && (
                        <div className="flex-shrink-0 mr-2 self-start mt-5">
                          <Avatar className="h-5 w-5 border border-border">
                            <AvatarImage src={senderAvatar || adminAvatar || undefined} />
                            <AvatarFallback className="bg-muted text-muted-foreground text-[8px] font-bold">
                              {(senderName || adminName || 'A').substring(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      )}
                      <div
                        className={`${ucpData ? 'max-w-[95%]' : 'max-w-[75%]'} rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser
                          ? 'bg-blue-600 text-white rounded-tr-sm'
                          : 'bg-secondary text-black dark:text-white border border-border rounded-tl-sm'
                          }`}
                      >
                        {/* 🔔 Badge para identificar remetente (IA ou Admin) */}
                        {!isUser && (
                          <div className="text-[9px] font-semibold mb-1">
                            {isHumanMessage ? (
                              <span className="text-red-400">👤 {senderName || 'Admin'}</span>
                            ) : (
                              <span className="text-blue-600">
                                🤖 {activeConversation?.agent_name || 'Agente'}
                              </span>
                            )}
                          </div>
                        )}

                        {/* 🖼️ Imagem */}
                        {hasImage && (
                          <div className="mb-2 rounded-lg overflow-hidden border border-border">
                            <img
                              src={msg.image_url}
                              alt="Anexo"
                              className="max-w-full h-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => window.open(msg.image_url, '_blank')}
                            />
                          </div>
                        )}

                        {/* 🎤 Áudio com player */}
                        {hasAudio && (
                          <div className="mb-2">
                            <VoiceMessage
                              audioUrl={msg.audio_url!}
                              transcription={!isMediaOnly ? displayContent : undefined}
                            />
                          </div>
                        )}

                        {/* 🛒 UCP Content - Renderização de carrossel/card/checkout */}
                        {ucpData && (
                          <div className="w-full mt-2">
                            {ucpData.type === 'ucp_product_list' && (
                              <ProductCarousel
                                products={ucpData.products}
                                shopDomain={ucpData.shop_domain}
                                query={ucpData.query}
                              />
                            )}
                            {ucpData.type === 'ucp_product_detail' && (
                              <ProductCard product={ucpData.product} size="large" />
                            )}
                            {ucpData.type === 'ucp_checkout' && (
                              <CheckoutButton data={ucpData} />
                            )}
                          </div>
                        )}

                        {/* 📝 Texto (só se não for apenas mídia) */}
                        {!isMediaOnly && !hasAudio && displayContent && (
                          <div
                            className={`prose prose-sm max-w-none ${isUser ? 'prose-invert text-white' : 'text-black dark:text-white dark:prose-invert'} [&_a]:text-blue-300 [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4`}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {displayContent}
                            </ReactMarkdown>
                          </div>
                        )}

                        <div
                          className={`text-[10px] mt-1.5 flex items-center justify-end gap-1 ${isUser ? 'text-blue-100' : isHumanMessage ? 'text-red-300' : 'text-gray-500'}`}
                        >
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {!isUser && <CheckCheck className="w-3 h-3 opacity-70" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Área do Input */}
            <div className="flex-shrink-0 p-4 bg-card border-t border-border z-10">
              {activeConversation?.status === 'HUMAN_REQUESTED' ? (
                /* 🔔 INPUT HABILITADO - Atendimento Humano */
                <>
                  {/* Hidden file input */}
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    className="hidden"
                  />

                  <div className="flex items-center gap-2 max-w-4xl mx-auto">
                    {/* Botão de Imagem */}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingMedia || isRecording}
                      className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Enviar imagem"
                    >
                      {isUploadingMedia ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <ImageIcon className="w-5 h-5" />
                      )}
                    </Button>

                    {/* Botão de Áudio */}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={isUploadingMedia}
                      className={`h-10 w-10 ${isRecording
                        ? 'text-red-500 bg-red-500/20 hover:bg-red-500/30 animate-pulse'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      title={isRecording ? 'Parar gravação' : 'Gravar áudio'}
                    >
                      {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </Button>

                    {/* Input de Texto */}
                    <div className="relative flex-1">
                      <Input
                        placeholder={isRecording ? '🎤 Gravando...' : 'Digite sua resposta...'}
                        value={humanReplyText}
                        onChange={(e) => setHumanReplyText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && humanReplyText.trim()) {
                            handleSendHumanReply();
                          }
                        }}
                        disabled={isSendingReply || isRecording}
                        className="bg-muted/50 border-border pr-12 text-foreground"
                      />
                      <Button
                        size="icon"
                        disabled={isSendingReply || !humanReplyText.trim() || isRecording}
                        onClick={handleSendHumanReply}
                        className="absolute right-1 top-1 h-8 w-8 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between max-w-4xl mx-auto mt-2">
                    <p className="text-[10px] text-red-400 font-medium">
                      ⚠️ Atendimento por <span className="font-bold">{adminName}</span> - Mensagens
                      diretas ao usuário
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCloseHumanHandoff}
                      className="h-8 text-xs px-3 bg-blue-600 text-white hover:bg-blue-700 border-0"
                    >
                      ✓ Devolver para IA
                    </Button>
                  </div>
                </>
              ) : (
                /* INPUT DESABILITADO - Modo Visualização com botão ASSUMIR */
                <>
                  <div className="relative max-w-4xl mx-auto">
                    <Input
                      placeholder="Intervenção Humana (apenas para conversas solicitadas)"
                      disabled
                      className="bg-muted/50 border-border pr-12 text-muted-foreground"
                    />
                    <Button
                      size="icon"
                      disabled
                      className="absolute right-1 top-1 h-8 w-8 bg-blue-600 opacity-50 text-white"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between max-w-4xl mx-auto mt-2">
                    <p className="text-[10px] text-muted-foreground font-medium">
                      🤖 O agente está respondendo automaticamente.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleTakeOver}
                      className="h-8 text-xs px-3 bg-blue-600 text-white hover:bg-blue-700 border-0"
                    >
                      <Hand className="w-4 h-4 mr-1.5" />
                      Assumir
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        )
        }
      </div >
    </div >
  );
}
