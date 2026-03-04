'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  Users,
  UserCheck,
  LayoutDashboard,
  LogOut,
  Shield,
  FileText,
  MessageSquare,
  Bot,
  MessageCircle,
  DollarSign,
  Settings,
  CreditCard,
  Lock,
} from 'lucide-react';
import { getAdminSession, clearAdminSession } from '@/lib/adminSession';
import { Button } from '@/components/ui/button';
import { useAdminRole } from '@/hooks/useAdminRole';
import { TermsAcceptanceModal } from '@/components/TermsAcceptanceModal';
import { ThemeToggle } from '@/components/ThemeToggle';

interface SubscriptionData {
  has_subscription: boolean;
  status: 'active' | 'past_due' | null;
  plan: { name: string; price_brl: number; display_credits: number } | null;
  credits_display: { remaining: number; used: number; total: number; percentage: number };
  usage: {
    agents: { used: number; limit: number };
    knowledge_bases: { used: number; limit: number };
  };
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { role, isLoading: roleLoading, companyId, isOwner } = useAdminRole();
  const [adminName, setAdminName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [termsOutdated, setTermsOutdated] = useState(false);
  const [activeTerms, setActiveTerms] = useState<{
    id: string; title: string; content: string; version: string;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch company name for Company Admin via API
  useEffect(() => {
    const fetchCompanyName = async () => {
      if (role === 'company_admin' && companyId) {
        try {
          const response = await fetch('/api/admin/me', { credentials: 'include' });
          if (response.ok) {
            const data = await response.json();
            if (data.company?.company_name) {
              setCompanyName(data.company.company_name);
            }
          }
        } catch (error) {
          console.error('[ADMIN LAYOUT] Error fetching company name:', error);
        }
      }
    };

    if (!roleLoading) {
      fetchCompanyName();
    }
  }, [role, companyId, roleLoading]);

  // Fetch subscription data for Company Admin
  useEffect(() => {
    const fetchSubscription = async () => {
      if (role === 'company_admin') {
        try {
          const response = await fetch('/api/billing/subscription', { credentials: 'include' });
          if (response.ok) {
            const data = await response.json();
            setSubscription(data);
          }
        } catch (error) {
          console.error('[ADMIN LAYOUT] Error fetching subscription:', error);
        }
      }
    };

    if (!roleLoading) {
      fetchSubscription();
    }
  }, [role, roleLoading]);

  // Check if company admin needs to re-accept terms
  useEffect(() => {
    const checkTerms = async () => {
      if (role === 'company_admin') {
        try {
          const res = await fetch('/api/auth/me', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            if (data.termsOutdated && data.activeTerms) {
              setTermsOutdated(true);
              setActiveTerms(data.activeTerms);
            }
          }
        } catch (error) {
          console.error('[ADMIN LAYOUT] Error checking terms:', error);
        }
      }
    };
    if (!roleLoading && role) {
      checkTerms();
    }
  }, [role, roleLoading]);

  useEffect(() => {
    if (!mounted) return;

    if (pathname === '/admin/login') {
      setLoading(false);
      return;
    }

    // Check for admin session in localStorage (not cookie - it's HttpOnly)
    const adminSession = getAdminSession();

    if (adminSession) {
      setAdminName(adminSession.name || 'Admin');
      setLoading(false);
      return;
    }

    // If no admin session, check if it's a company admin via useAdminRole
    // The useAdminRole hook will handle the user session check via API
    setAdminName('Loading...');
    setLoading(false);
  }, [mounted, pathname]);

  // Route protection for company admins
  useEffect(() => {
    if (roleLoading || !role) return;

    // Update admin name if we detected a company admin
    if (role === 'company_admin' && adminName === 'Loading...') {
      setAdminName('Company Admin');
    }

    // Master-only routes
    const masterOnlyRoutes = [
      '/admin/companies',
      '/admin/all-users',
      '/admin/pending-users',
      '/admin/logs',
      '/admin/conversation-logs',
      '/admin/legal-documents',
    ];

    // If company admin trying to access master-only route, redirect
    if (role === 'company_admin' && masterOnlyRoutes.some((route) => pathname.startsWith(route))) {
      router.push('/admin/team');
      return;
    }

    // If member trying to access admin routes, redirect
    if (role === 'member' && pathname.startsWith('/admin')) {
      router.push('/dashboard');
    }
  }, [role, roleLoading, pathname, router, adminName]);

  const handleLogout = async () => {
    try {
      // Try both logout endpoints
      await fetch('/api/admin/logout', { method: 'POST' });
      await fetch('/api/auth/logout', { method: 'POST' });

      clearAdminSession();

      // Clear all cookies
      document.cookie.split(';').forEach((c) => {
        document.cookie = c
          .replace(/^ +/, '')
          .replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
      });

      router.push('/admin/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (!mounted || (loading && pathname !== '/admin/login')) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Carregando...</div>
      </div>
    );
  }

  if (pathname === '/admin/login') {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  // Define menus based on role
  const masterMenuItems = [
    { href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/admin/companies', icon: Building2, label: 'Empresas' },
    { href: '/admin/pending-users', icon: UserCheck, label: 'Aprovações Pendentes' },
    { href: '/admin/all-users', icon: Users, label: 'Todos os Usuários' },
    {
      href: '/admin/finops',
      icon: DollarSign,
      label: 'FinOps',
      submenu: [
        { href: '/admin/finops/usage', label: 'Consumo LLM' },
        { href: '/admin/finops/pricing', label: 'Tabela de Custos' },
        { href: '/admin/finops/plans', label: 'Planos' },
      ],
    },
    { href: '/admin/logs', icon: FileText, label: 'Logs do Sistema' },
    { href: '/admin/conversation-logs', icon: MessageSquare, label: 'Logs de Conversação' },
    { href: '/admin/legal-documents', icon: FileText, label: 'Termos e Políticas' },
    { href: '/admin/settings', icon: Settings, label: 'Configurações' },
  ];

  const companyAdminMenuItems = [
    { href: '/admin/team', icon: Users, label: 'Minha Equipe' },
    { href: '/admin/conversations', icon: MessageSquare, label: 'Conversas' },
    { href: '/admin/agent', icon: Bot, label: 'Configurar Agente' },
    { href: '/admin/documents', icon: FileText, label: 'Base de Conhecimento' },
    // { href: '/admin/integrations', icon: MessageCircle, label: 'Integrações' }, // HIDDEN: Menu não utilizado
    // Meu Plano só aparece para owners
    ...(isOwner ? [{ href: '/admin/billing', icon: CreditCard, label: 'Meu Plano' }] : []),
    { href: '/admin/settings', icon: Settings, label: 'Configurações' },
  ];

  // Select menu based on role
  const menuItems = role === 'master' ? masterMenuItems : companyAdminMenuItems;

  // Items locked when no subscription OR payment failed (past_due)
  // User can only access: Meu Plano & Configurações
  const lockedHrefs = ['/admin/team', '/admin/conversations', '/admin/agent', '/admin/documents'];
  const isPastDue = subscription?.status === 'past_due';
  const noSubscription = !subscription?.has_subscription;
  const isLocked = (href: string) =>
    role === 'company_admin' && (noSubscription || isPastDue) && lockedHrefs.includes(href);

  return (
    <div className="h-screen bg-background flex text-foreground overflow-hidden">
      <aside className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center overflow-hidden">
              <img src="/smith-logo.png" alt="Smith Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-foreground font-bold text-lg">
                Painel Admin
              </h1>
              <div className="flex flex-col mt-0.5">
                <p className="text-[10px] text-black dark:text-muted-foreground font-medium truncate max-w-[140px]">
                  Logado como {adminName}
                </p>
                {role && role !== 'master' && (
                  <p className="text-[10px] text-blue-400 font-medium truncate max-w-[140px]">
                    {companyName || 'Carregando...'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
          {menuItems.map((item: any) => {
            const hasSubmenu = item.submenu && item.submenu.length > 0;
            const isExpanded = expandedMenus.includes(item.href);
            const isActive = hasSubmenu ? pathname.startsWith(item.href) : pathname === item.href;

            if (hasSubmenu) {
              return (
                <div key={item.href}>
                  <button
                    onClick={() => {
                      setExpandedMenus((prev) =>
                        prev.includes(item.href)
                          ? prev.filter((h) => h !== item.href)
                          : [...prev, item.href],
                      );
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      <span className="font-medium">{item.label}</span>
                    </div>
                    <svg
                      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="ml-6 mt-1 space-y-1">
                      {item.submenu.map((sub: any) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={`block px-4 py-2 rounded-lg text-sm transition-colors ${pathname === sub.href
                            ? 'text-white bg-blue-600 shadow-sm'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                            }`}
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const itemLocked = isLocked(item.href);

            if (itemLocked) {
              return (
                <div
                  key={item.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-muted-foreground/50 cursor-not-allowed opacity-50"
                  title={
                    isPastDue
                      ? 'Regularize o pagamento para acessar'
                      : 'Assine um plano para acessar'
                  }
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5" />
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <Lock className="w-4 h-4" />
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
          {/* Credits Widget - Only for Company Admin */}
          {role === 'company_admin' &&
            subscription &&
            subscription.has_subscription &&
            subscription.plan &&
            (isOwner ? (
              <Link
                href="/admin/billing"
                className="block mb-4 p-3 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/20 rounded-lg hover:border-blue-500/40 transition-colors"
              >
                {/* Plano */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">Plano</span>
                  <span className="text-sm font-semibold text-black dark:text-white flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-blue-500" /> {subscription.plan.name}
                  </span>
                </div>

                {/* Créditos */}
                <div className="mb-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Créditos</span>
                    <span className="text-foreground font-medium">
                      {subscription.credits_display.remaining?.toLocaleString('pt-BR') || 0} /{' '}
                      {subscription.credits_display.total?.toLocaleString('pt-BR') || 0}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${Math.min(100, subscription.credits_display.percentage || 0)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Agentes */}
                <div className="mb-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Agentes</span>
                    <span className="text-foreground font-medium">
                      {subscription.usage.agents.used} / {subscription.usage.agents.limit}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${subscription.usage.agents.limit > 0 ? (subscription.usage.agents.used / subscription.usage.agents.limit) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Bases de Conhecimento */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Bases conhec.</span>
                    <span className="text-foreground font-medium">
                      {subscription.usage.knowledge_bases.used} /{' '}
                      {subscription.usage.knowledge_bases.limit}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${subscription.usage.knowledge_bases.limit > 0 ? (subscription.usage.knowledge_bases.used / subscription.usage.knowledge_bases.limit) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <p className="text-center text-[10px] text-muted-foreground mt-2">
                  {subscription.credits_display.percentage?.toFixed(0) || 0}% restante
                </p>
              </Link>
            ) : (
              /* Non-owners see the widget but cannot click */
              <div className="block mb-4 p-3 bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-primary/20 rounded-lg opacity-90">
                {/* Plano */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">Plano</span>
                  <span className="text-sm font-semibold text-black dark:text-white flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-blue-500" /> {subscription.plan.name}
                  </span>
                </div>

                {/* Créditos */}
                <div className="mb-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Créditos</span>
                    <span className="text-foreground font-medium">
                      {subscription.credits_display.remaining?.toLocaleString('pt-BR') || 0} /{' '}
                      {subscription.credits_display.total?.toLocaleString('pt-BR') || 0}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${Math.min(100, subscription.credits_display.percentage || 0)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Agentes */}
                <div className="mb-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Agentes</span>
                    <span className="text-foreground font-medium">
                      {subscription.usage.agents.used} / {subscription.usage.agents.limit}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${subscription.usage.agents.limit > 0 ? (subscription.usage.agents.used / subscription.usage.agents.limit) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Bases de Conhecimento */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Bases conhec.</span>
                    <span className="text-foreground font-medium">
                      {subscription.usage.knowledge_bases.used} /{' '}
                      {subscription.usage.knowledge_bases.limit}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${subscription.usage.knowledge_bases.limit > 0 ? (subscription.usage.knowledge_bases.used / subscription.usage.knowledge_bases.limit) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <p className="text-center text-[10px] text-muted-foreground mt-2">
                  {subscription.credits_display.percentage?.toFixed(0) || 0}% restante
                </p>
              </div>
            ))}

          {/* Version Info moved to bottom */}
          <div className="mt-auto pt-4 text-center">
            <p className="text-[10px] text-muted-foreground">
              Sistema Smith v6.1
            </p>
          </div>
        </nav>

        <div className="p-4 border-t border-border">



          <div className="flex items-center gap-2">
            <Button
              onClick={handleLogout}
              variant="outline"
              className="flex-1 bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
            <div className="flex-shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside >

      <main
        className={`flex-1 h-full flex flex-col relative ${pathname?.startsWith('/admin/conversations') ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
      >
        {/* Payment Failed Banner */}
        {role === 'company_admin' && subscription?.status === 'past_due' && (
          <div className="bg-destructive/10 border-b border-destructive/30 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="text-destructive font-semibold text-sm">
                  Pagamento falhou na renovação do plano
                </p>
                <p className="text-muted-foreground text-xs">
                  Atualize seu método de pagamento para continuar usando o serviço
                </p>
              </div>
            </div>
            <Button
              onClick={async () => {
                try {
                  const res = await fetch('/api/billing/portal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ return_url: window.location.href }),
                  });
                  const data = await res.json();
                  if (data.portal_url) window.location.href = data.portal_url;
                } catch (e) {
                  console.error('Error opening portal:', e);
                }
              }}
              size="sm"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Gerenciar Método de Pagamento
            </Button>
          </div>
        )}
        {children}
      </main>
      {
        termsOutdated && activeTerms && (
          <TermsAcceptanceModal
            activeTerms={activeTerms}
            onAccepted={() => setTermsOutdated(false)}
          />
        )
      }
    </div >
  );
}
