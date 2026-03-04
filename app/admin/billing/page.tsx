'use client';

import { useEffect, useState } from 'react';
import { Check, X, Star, TrendingUp, Calendar, Zap, MessageSquare, BarChart3, CreditCard, FileText, PieChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ========== TYPES ==========

interface PlanFeature {
  name: string;
  included: boolean;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_brl: number;
  display_credits: number;
  max_agents: number;
  max_knowledge_bases: number;
  max_users: number;
  features: PlanFeature[];
  stripe_price_id: string | null;
}

interface SubscriptionData {
  has_subscription: boolean;
  plan: Plan | null;
  balance_brl: number;
  credits_display: {
    remaining: number;
    used: number;
    total: number;
    percentage: number;
  };
  usage: {
    agents: { used: number; limit: number };
    knowledge_bases: { used: number; limit: number };
  };
  current_period_end: string | null;
  cancel_at: string | null;
}

interface UsageByAgent {
  agent_id: string;
  agent_name: string;
  model_name: string;
  cost_brl: number;
  percentage: number;
  messages_count: number;
}

interface UsageSummary {
  period: string;
  total_cost_brl: number;
  by_agent: UsageByAgent[];
}

interface UsageByService {
  service_type: string;
  service_name: string;
  cost_brl: number;
  percentage: number;
  calls: number;
  tokens_input: number;
  tokens_output: number;
  models: string[];
}

interface UsageServiceData {
  period: string;
  total_cost_brl: number;
  by_service: UsageByService[];
}

interface DailyUsage {
  date: string;
  cost_brl: number;
  calls: number;
  tokens: number;
}

interface DailyUsageData {
  period: string;
  daily: DailyUsage[];
}

// ========== COLORS ==========

const SERVICE_COLORS: Record<string, string> = {
  chat: '#3B82F6',
  benchmark: '#8B5CF6',
  embedding: '#10B981',
  audio: '#F59E0B',
  rag_query: '#6366F1',
  ingestion: '#EC4899',
  vision: '#14B8A6',
  unknown: '#6B7280',
};

const CHART_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#6366F1', '#EC4899'];

// ========== COMPONENT ==========

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageByService, setUsageByService] = useState<UsageServiceData | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('planos');
  const [selectedPeriod, setSelectedPeriod] = useState('30');

  // Custom date range states
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Fetch subscription and plans
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [subRes, plansRes] = await Promise.all([
          fetch('/api/billing/subscription'),
          fetch('/api/billing/plans'),
        ]);

        if (subRes.ok) {
          const data = await subRes.json();
          setSubscription(data);
        }

        if (plansRes.ok) {
          const data = await plansRes.json();
          setPlans(data.plans || []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Fetch consumption data when tab or period changes
  useEffect(() => {
    if (activeTab === 'consumo') {
      // Only fetch if not custom OR if custom dates are set
      if (selectedPeriod !== 'custom' || (customStartDate && customEndDate)) {
        fetchConsumptionData();
      }
    }
  }, [activeTab, selectedPeriod, customStartDate, customEndDate]);

  // Helper para obter data no formato YYYY-MM-DD no timezone local
  const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const fetchConsumptionData = async () => {
    try {
      // Build query params based on period type (usando timezone local)
      let queryParams = '';
      if (selectedPeriod === 'custom' && customStartDate && customEndDate) {
        queryParams = `start_date=${customStartDate}&end_date=${customEndDate}`;
      } else if (selectedPeriod === 'today') {
        // Usa timezone local em vez de UTC
        const today = getLocalDateString(new Date());
        queryParams = `start_date=${today}&end_date=${today}`;
      } else {
        queryParams = `days=${selectedPeriod}`;
      }

      const [usageRes, serviceRes, dailyRes] = await Promise.all([
        fetch(`/api/billing/usage?${queryParams}`),
        fetch(`/api/billing/usage-by-service?${queryParams}`),
        fetch(`/api/billing/usage-daily?${queryParams}`),
      ]);

      if (usageRes.ok) {
        const data = await usageRes.json();
        setUsage(data);
      }

      if (serviceRes.ok) {
        const data = await serviceRes.json();
        setUsageByService(data);
      }

      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailyUsage(data);
      }
    } catch (error) {
      console.error('Error fetching consumption data:', error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('pt-BR').format(value);
  };

  // Converte BRL para créditos usando a mesma lógica do sidebar
  const brlToCredits = (brlValue: number): number => {
    if (!subscription?.plan) return 0;
    const planPrice = subscription.plan.price_brl || 1;
    const displayCredits = subscription.plan.display_credits || 0;
    if (planPrice === 0) return 0;
    return Math.round((brlValue / planPrice) * displayCredits);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_url: `${window.location.origin}/admin/billing`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Erro ao abrir portal');
      }

      const data = await response.json();
      window.location.href = data.portal_url;
    } catch (error: any) {
      alert(error.message || 'Erro ao abrir portal');
    } finally {
      setPortalLoading(false);
    }
  };

  const handlePlanAction = async (plan: Plan) => {
    if (!plan.stripe_price_id) {
      alert('Este plano ainda não está disponível para compra. Entre em contato com o suporte.');
      return;
    }

    setCheckoutLoading(plan.id);

    try {
      const hasSubscription = subscription?.has_subscription;

      if (hasSubscription) {
        const response = await fetch('/api/billing/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            return_url: `${window.location.origin}/admin/billing`,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Erro ao abrir portal de pagamento');
        }

        const data = await response.json();
        window.location.href = data.portal_url;
      } else {
        const response = await fetch('/api/billing/checkout/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: plan.id,
            success_url: `${window.location.origin}/admin/billing?success=true`,
            cancel_url: `${window.location.origin}/admin/billing?canceled=true`,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Erro ao criar sessão de pagamento');
        }

        const data = await response.json();
        window.location.href = data.checkout_url;
      }
    } catch (error: any) {
      console.error('Plan action error:', error);
      alert(error.message || 'Erro ao processar. Tente novamente.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const normalizeFeatures = (features: any): PlanFeature[] => {
    if (!features || !Array.isArray(features)) return [];
    if (features.length > 0 && typeof features[0] === 'object') {
      return features as PlanFeature[];
    }
    return (features as string[]).map((name) => ({ name, included: true }));
  };

  const getPeriodLabel = () => {
    switch (selectedPeriod) {
      case 'today':
        return `Hoje (${new Date().toLocaleDateString('pt-BR')})`;
      case '7':
        return 'últimos 7 dias';
      case '30':
        return 'últimos 30 dias';
      case '90':
        return 'últimos 3 meses';
      case 'custom':
        if (customStartDate && customEndDate) {
          return `${customStartDate.split('-').reverse().join('/')} a ${customEndDate.split('-').reverse().join('/')}`;
        }
        return 'período personalizado';
      default:
        return `últimos ${selectedPeriod} dias`;
    }
  };

  // Calculate totals
  const totalCalls = usageByService?.by_service.reduce((sum, s) => sum + s.calls, 0) || 0;
  const totalTokens =
    usageByService?.by_service.reduce((sum, s) => sum + s.tokens_input + s.tokens_output, 0) || 0;

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
            <CreditCard className="w-8 h-8" /> Meu Plano
          </h1>
          <p className="text-muted-foreground">Gerencie sua assinatura e acompanhe seu consumo</p>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Carregando...</div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="bg-card border border-border p-1">
              <TabsTrigger
                value="planos"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> Planos
              </TabsTrigger>
              <TabsTrigger
                value="consumo"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white flex items-center gap-2"
              >
                <BarChart3 className="w-4 h-4" /> Consumo
              </TabsTrigger>
            </TabsList>

            {/* ========== PLANOS TAB ========== */}
            <TabsContent value="planos" className="space-y-8">
              {/* Cancellation Warning */}
              {subscription?.has_subscription && subscription.cancel_at && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <p className="text-red-400 font-semibold">Cancelamento agendado</p>
                    <p className="text-muted-foreground text-sm">
                      Sua assinatura será cancelada em {formatDate(subscription.cancel_at)}. Acesse
                      o portal para reverter.
                    </p>
                  </div>
                </div>
              )}

              {/* Current Plan Card */}
              {subscription?.has_subscription && subscription.plan && (
                <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Star className="w-5 h-5 text-yellow-400" />
                        <h2 className="text-2xl font-bold text-foreground">{subscription.plan.name}</h2>
                      </div>
                      <p className="text-3xl font-bold text-foreground">
                        {formatCurrency(subscription.plan.price_brl)}
                        <span className="text-base font-normal text-muted-foreground">/mês</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Próxima cobrança</p>
                      <p className="text-foreground font-medium">
                        {formatDate(subscription.current_period_end)}
                      </p>
                    </div>
                  </div>

                  {/* Credits Bar */}
                  <div className="bg-background/30 rounded-xl p-4 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-black dark:text-gray-300">Créditos</span>
                      <span className="text-foreground font-bold">
                        {formatNumber(subscription.credits_display.remaining)} /{' '}
                        {formatNumber(subscription.credits_display.total)}
                      </span>
                    </div>
                    <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${subscription.credits_display.percentage > 20
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                          : subscription.credits_display.percentage > 5
                            ? 'bg-gradient-to-r from-yellow-500 to-yellow-400'
                            : 'bg-gradient-to-r from-red-500 to-red-400'
                          }`}
                        style={{
                          width: `${Math.min(100, subscription.credits_display.percentage)}%`,
                        }}
                      />
                    </div>
                    <p className="text-right text-sm text-muted-foreground mt-1">
                      {subscription.credits_display.percentage}% restante
                    </p>
                  </div>

                  {/* Usage Stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-background/30 rounded-lg p-3">
                      <p className="text-sm text-muted-foreground">Agentes ativos</p>
                      <p className="text-xl font-bold text-foreground">
                        {subscription.usage.agents.used} / {subscription.usage.agents.limit}
                      </p>
                    </div>
                    <div className="bg-background/30 rounded-lg p-3">
                      <p className="text-sm text-muted-foreground">Bases de Conhecimento</p>
                      <p className="text-xl font-bold text-foreground">
                        {subscription.usage.knowledge_bases.used} /{' '}
                        {subscription.usage.knowledge_bases.limit}
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={openPortal}
                    disabled={portalLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium mt-4"
                  >
                    {portalLoading ? 'Abrindo Portal...' : '🔄 Gerenciar Plano'}
                  </Button>
                </div>
              )}

              {/* No subscription */}
              {subscription && !subscription.has_subscription && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-8 text-center">
                  <h2 className="text-2xl font-bold text-yellow-400 mb-2">
                    Você ainda não tem um plano
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    Escolha um plano abaixo para começar a usar o Smith AI
                  </p>
                </div>
              )}

              {/* Available Plans */}
              <div>
                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                  Planos Disponíveis
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {plans.map((plan) => {
                    const isCurrentPlan = subscription?.plan?.id === plan.id;
                    const features = normalizeFeatures(plan.features);

                    return (
                      <div
                        key={plan.id}
                        className={`bg-card border rounded-xl p-6 ${isCurrentPlan
                          ? 'border-blue-500 ring-2 ring-blue-500/20'
                          : 'border-border'
                          }`}
                      >
                        <div className="mb-4">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                            {isCurrentPlan && (
                              <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full">
                                ⭐ ATUAL
                              </span>
                            )}
                          </div>
                          {plan.description && (
                            <p className="text-sm text-muted-foreground">{plan.description}</p>
                          )}
                        </div>

                        <div className="mb-4">
                          <span className="text-2xl font-bold text-foreground">
                            {formatCurrency(plan.price_brl)}
                          </span>
                          <span className="text-muted-foreground text-sm">/mês</span>
                        </div>

                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 mb-4">
                          <p className="text-emerald-400 text-sm">
                            💰 {formatNumber(plan.display_credits)} créditos
                          </p>
                        </div>

                        <div className="space-y-2 mb-4">
                          {features.slice(0, 5).map((feature, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-sm">
                              {feature.included ? (
                                <Check className="w-4 h-4 text-green-400" />
                              ) : (
                                <X className="w-4 h-4 text-red-400" />
                              )}
                              <span
                                className={feature.included ? 'text-black dark:text-gray-300' : 'text-muted-foreground'}
                              >
                                {feature.name}
                              </span>
                            </div>
                          ))}
                        </div>

                        <Button
                          onClick={() => handlePlanAction(plan)}
                          disabled={isCurrentPlan || checkoutLoading === plan.id}
                          className={`w-full text-white font-medium ${isCurrentPlan
                            ? 'bg-gray-600 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                          {checkoutLoading === plan.id
                            ? 'Processando...'
                            : isCurrentPlan
                              ? 'Plano Atual'
                              : subscription?.has_subscription
                                ? '🔄 Gerenciar Plano'
                                : 'Assinar'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            {/* ========== CONSUMO TAB ========== */}
            <TabsContent value="consumo" className="space-y-6">
              {/* Period Selector */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-400" />
                  Dashboard de Consumo
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <select
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                  >
                    <option value="today">Hoje</option>
                    <option value="7">Últimos 7 dias</option>
                    <option value="30">Últimos 30 dias</option>
                    <option value="90">Últimos 3 meses</option>
                    <option value="custom">📅 Personalizado</option>
                  </select>

                  {selectedPeriod === 'custom' && (
                    <>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-muted-foreground">até</span>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-600 border border-blue-500 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-blue-100 text-sm">Créditos Usados</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {formatNumber(brlToCredits(usageByService?.total_cost_brl || 0))}
                  </p>
                  <p className="text-xs text-blue-100 mt-1">{getPeriodLabel()}</p>
                </div>

                <div className="bg-blue-600 border border-blue-500 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-blue-100 text-sm">Chamadas</span>
                  </div>
                  <p className="text-2xl font-bold text-white">{formatNumber(totalCalls)}</p>
                  <p className="text-xs text-blue-100 mt-1">requisições à API</p>
                </div>

                <div className="bg-blue-600 border border-blue-500 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <BarChart3 className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-blue-100 text-sm">Tokens</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {formatNumber(Math.round(totalTokens / 1000))}K
                  </p>
                  <p className="text-xs text-blue-100 mt-1">tokens processados</p>
                </div>
              </div>

              {/* Daily Chart */}
              {dailyUsage && dailyUsage.daily.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-bold text-foreground mb-4">📈 Consumo Diário</h3>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailyUsage.daily}>
                        <defs>
                          <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2D2D2D" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatShortDate}
                          stroke="#6B7280"
                          fontSize={12}
                        />
                        <YAxis
                          stroke="#6B7280"
                          fontSize={12}
                          tickFormatter={(value) => `${brlToCredits(value)}`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1A1A1A',
                            border: '1px solid #2D2D2D',
                            borderRadius: '8px',
                          }}
                          labelFormatter={(label) => formatDate(label)}
                          formatter={(value: number) => [
                            formatNumber(brlToCredits(value)),
                            'Créditos',
                          ]}
                        />
                        <Area
                          type="monotone"
                          dataKey="cost_brl"
                          stroke="#3B82F6"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorCost)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Two Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* By Service */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-bold text-foreground mb-4">⚙️ Por Serviço</h3>

                  {usageByService && usageByService.by_service.length > 0 ? (
                    <div className="space-y-4">
                      {usageByService.by_service.map((service) => (
                        <div key={service.service_type} className="flex items-center gap-4">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: SERVICE_COLORS[service.service_type] || '#6B7280',
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-foreground truncate">
                                {service.service_name}
                              </span>
                              <span className="text-sm text-muted-foreground ml-2">
                                {formatNumber(brlToCredits(service.cost_brl))} créditos (
                                {service.percentage}%)
                              </span>
                            </div>
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${service.percentage}%`,
                                  backgroundColor:
                                    SERVICE_COLORS[service.service_type] || '#6B7280',
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="pt-4 border-t border-border flex justify-between items-center">
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-lg font-bold text-foreground">
                          {formatNumber(brlToCredits(usageByService.total_cost_brl))} créditos
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">Nenhum consumo no período</p>
                  )}
                </div>

                {/* By Agent */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-bold text-foreground mb-4">👥 Por Agente</h3>

                  {usage && usage.by_agent.length > 0 ? (
                    <div className="space-y-4">
                      {usage.by_agent.map((agent, idx) => (
                        <div key={agent.agent_id} className="flex items-center gap-4">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-foreground truncate">
                                {agent.agent_name}
                              </span>
                              <span className="text-sm text-muted-foreground ml-2">
                                {formatNumber(brlToCredits(agent.cost_brl))} créditos (
                                {agent.percentage}%)
                              </span>
                            </div>
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${agent.percentage}%`,
                                  backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="pt-4 border-t border-[#2D2D2D] flex justify-between items-center">
                        <span className="text-gray-400">Total</span>
                        <span className="text-lg font-bold text-white">
                          {formatNumber(brlToCredits(usage.total_cost_brl))} créditos
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-8">Nenhum consumo no período</p>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
