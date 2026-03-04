import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DOLLAR_RATE = parseFloat(process.env.DOLLAR_RATE || '6.00');
const SELL_MULTIPLIER = 2.68; // Multiplicador de venda para o cliente

// Debug log para verificar valores
console.log(
  '[Billing Debug usage] DOLLAR_RATE:',
  process.env.DOLLAR_RATE,
  '| Parsed:',
  DOLLAR_RATE,
  '| MULTIPLIER:',
  SELL_MULTIPLIER,
);

async function getCompanyIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId) {
      return adminSession.companyId;
    }

    if (adminSession.adminId) {
      const { data } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', adminSession.adminId)
        .single();

      if (data?.company_id) {
        return data.company_id;
      }
    }

    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    if (userSession.userId) {
      const { data } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', userSession.userId)
        .single();

      if (data?.company_id) {
        return data.company_id;
      }
    }

    return null;
  } catch (error) {
    console.error('[Billing] Error getting company_id:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    const companyId = await getCompanyIdFromSession();

    if (!companyId) {
      return NextResponse.json({
        period: 'last_30_days',
        total_cost_brl: 0,
        by_agent: [],
      });
    }

    // Calculate date range
    // 🔧 FIX: Usar timezone do Brasil (GMT-3) para filtros de data
    let startDt: string;
    let endDt: string;
    let periodLabel: string;

    if (startDate && endDate) {
      // Usar offset -03:00 para horário de Brasília
      startDt = `${startDate}T00:00:00-03:00`;
      endDt = `${endDate}T23:59:59-03:00`;
      periodLabel = `${startDate}_to_${endDate}`;
    } else {
      // Para períodos relativos, usar horário local do servidor
      const now = new Date();
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      startDt = start.toISOString();
      endDt = now.toISOString();
      periodLabel = `last_${days}_days`;
    }

    // Fetch usage logs
    const { data: logs, error } = await supabaseAdmin
      .from('token_usage_logs')
      .select('agent_id, service_type, model_name, total_cost_usd')
      .eq('company_id', companyId)
      .gte('created_at', startDt)
      .lte('created_at', endDt);

    if (error) {
      console.error('[Billing] Error fetching usage:', error);
      return NextResponse.json({
        period: periodLabel,
        total_cost_brl: 0,
        by_agent: [],
      });
    }

    // Fetch agents
    const { data: agents } = await supabaseAdmin
      .from('agents')
      .select('id, name')
      .eq('company_id', companyId);

    const agentsMap: Record<string, string> = {};
    for (const agent of agents || []) {
      agentsMap[agent.id] = agent.name;
    }

    // Group by agent (excluding benchmark and ingestion)
    const excludedServices = ['benchmark', 'ingestion'];
    const usageByAgent: Record<string, { cost: number; calls: number; model: string }> = {};

    for (const log of logs || []) {
      if (excludedServices.includes(log.service_type || '')) continue;

      const agentId = log.agent_id || 'unknown';
      if (!usageByAgent[agentId]) {
        usageByAgent[agentId] = { cost: 0, calls: 0, model: log.model_name || 'unknown' };
      }
      usageByAgent[agentId].cost +=
        parseFloat(log.total_cost_usd || '0') * DOLLAR_RATE * SELL_MULTIPLIER;
      usageByAgent[agentId].calls += 1;
    }

    // Calculate total
    const totalCost = Object.values(usageByAgent).reduce((sum, u) => sum + u.cost, 0);

    // Format response
    const byAgent = Object.entries(usageByAgent)
      .map(([agentId, usage]) => ({
        agent_id: agentId,
        agent_name:
          agentsMap[agentId] || (agentId === 'unknown' ? 'Sem Agente' : 'Agente Desconhecido'),
        model_name: usage.model,
        cost_brl: Math.round(usage.cost * 100) / 100,
        percentage: totalCost > 0 ? Math.round((usage.cost / totalCost) * 1000) / 10 : 0,
        messages_count: usage.calls,
      }))
      .sort((a, b) => b.cost_brl - a.cost_brl);

    return NextResponse.json({
      period: periodLabel,
      total_cost_brl: Math.round(totalCost * 100) / 100,
      by_agent: byAgent,
    });
  } catch (error) {
    console.error('[Billing API] Usage error:', error);
    return NextResponse.json({
      period: 'last_30_days',
      total_cost_brl: 0,
      by_agent: [],
    });
  }
}
