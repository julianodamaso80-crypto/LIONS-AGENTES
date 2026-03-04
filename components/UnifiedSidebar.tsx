'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Plus, Menu, X, Home, History, Settings, LogOut } from 'lucide-react';
import { Conversation } from '@/lib/types';
import { clearSession } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/ThemeToggle';

interface UnifiedSidebarProps {
  userId: string;
  currentSessionId?: string;
  onSelectConversation?: (sessionId: string) => void;
  onNewConversation?: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    label: 'Chat',
    href: '/dashboard/chat',
    icon: <MessageSquare size={18} />,
  },
  {
    label: 'Histórico',
    href: '/dashboard/historico',
    icon: <History size={18} />,
  },
  {
    label: 'Configurações',
    href: '/dashboard/configuracoes',
    icon: <Settings size={18} />,
  },
];

export function UnifiedSidebar({
  userId,
  currentSessionId,
  onSelectConversation,
  onNewConversation,
}: UnifiedSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const [userProfile, setUserProfile] = useState({ name: '', email: '', companyName: '' });

  useEffect(() => {
    if (userId) {
      loadConversations();
      loadUserProfile();
    }
  }, [userId, currentSessionId]);

  const loadUserProfile = async () => {
    try {
      const response = await fetch('/api/user/profile');
      if (response.ok) {
        const data = await response.json();
        setUserProfile({
          name: data.name || '',
          email: data.email || '',
          companyName: data.companyName || 'Empresa',
        });
      }
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
    }
  };

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/conversations?limit=8');
      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error('Erro ao carregar conversas:', error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) return 'Hoje';
    if (diffInHours < 48) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const handleNewConversation = () => {
    if (onNewConversation) {
      onNewConversation();
    }
    router.push('/dashboard/chat');
    setIsOpen(false);
  };

  const handleSelectConversation = (sessionId: string) => {
    if (onSelectConversation) {
      onSelectConversation(sessionId);
    }
    setIsOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      });

      clearSession();
      router.push('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      clearSession();
      router.push('/login');
    }
  };

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const isOnChatPage = pathname === '/dashboard/chat';

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-colors lg:hidden backdrop-blur-sm"
      >
        {isOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex flex-col h-full">
          {/* HEADER SIDEBAR */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-3 px-2 mb-6">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 p-0.5 flex-shrink-0">
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                  <img
                    src="/smith-logo.png"
                    alt="Smith AI"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              <div className="flex flex-col min-w-0">
                <span className="font-bold text-lg tracking-wide text-foreground leading-none">
                  SMITH AI
                </span>
                <span className="text-sm font-semibold text-blue-400 truncate">
                  {userProfile.companyName}
                </span>
                <div className="flex flex-col mt-1">
                  <span className="text-xs text-muted-foreground truncate">{userProfile.name}</span>
                  <span className="text-[10px] text-muted-foreground/70 truncate">{userProfile.email}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleNewConversation}
              className="w-full flex items-center gap-2 px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
            >
              <Plus size={18} />
              <span className="font-medium">Nova Conversa</span>
            </button>
          </div>

          {/* LISTA DE CONVERSAS */}
          <div className="flex-1 overflow-y-auto">
            {isOnChatPage && conversations.length > 0 && (
              <div className="p-4 border-b border-border">
                <h3 className="text-xs uppercase text-muted-foreground mb-2 font-semibold">
                  Conversas Recentes
                </h3>
                <div className="space-y-1">
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv.session_id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors group ${conv.session_id === currentSessionId
                        ? 'bg-blue-600/10 border border-blue-600/30'
                        : 'hover:bg-accent border border-transparent'
                        }`}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare
                          size={16}
                          className={`mt-1 flex-shrink-0 ${conv.session_id === currentSessionId ? 'text-blue-600' : 'text-muted-foreground'}`}
                        />
                        <div className="flex-1 min-w-0">
                          {/* LINHA DE TÍTULO + DATA */}
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p
                              className={`text-sm font-medium truncate flex-1 ${conv.session_id === currentSessionId ? 'text-foreground' : 'text-muted-foreground'}`}
                            >
                              {conv.title || 'Nova conversa'}
                            </p>
                            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                              {formatDate(conv.updated_at)}
                            </span>
                          </div>

                          {/* 🔥 BADGE DO AGENTE (Se existir) */}
                          {conv.agents?.name && (
                            <div className="flex">
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 h-4 border-border bg-accent text-blue-400 font-normal rounded-sm"
                              >
                                {conv.agents.name}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <nav className="p-4">
              <h3 className="text-xs uppercase text-muted-foreground mb-2 font-semibold">Menu</h3>
              <div className="space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isActive(item.href)
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                  >
                    {item.icon}
                    <span className="font-medium text-sm">{item.label}</span>
                  </Link>
                ))}
              </div>
            </nav>
          </div>

          <div className="p-4 border-t border-border">
            <div className="flex justify-center mb-4">
              <span className="text-[10px] text-muted-foreground">
                Sistema Smith v6.1
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shrink-0 border border-border">
                <span className="text-sm font-medium text-foreground">
                  {userProfile.name ? userProfile.name.charAt(0).toUpperCase() : 'U'}
                </span>
              </div>

              <button
                onClick={handleLogout}
                className="flex-1 flex items-center gap-2 px-3 h-10 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              >
                <LogOut size={16} />
                <span className="text-sm font-medium">Sair</span>
              </button>

              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/40 z-30 lg:hidden backdrop-blur-sm"
        />
      )}
    </>
  );
}
