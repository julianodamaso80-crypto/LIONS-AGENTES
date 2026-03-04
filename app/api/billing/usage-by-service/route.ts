import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';
import { queryOne, queryAll } from '@/lib/db';

const DOLLAR_RATE = parseFloat(process.env.DOLLAR_RATE || '6.00');
const SELL_MULTIPLIER = 2.68; // Multiplicador de venda para o cliente

// Debug log para verificar valores
console.log(
  '[Billing Debug] DOLLAR_RATE:',
  process.env.DOLLAR_RATE,
  '| Parsed:',
  DOLLAR_RATE,
  '| MULTIPLIER:',
  SELL_MULTIPLIER,
);

const SERVICE_NAMES: Record<string, string> = {
  chat: '💬 Chat',
  benchmark: '📊 Benchmark',
  embedding: '🧠 Embedding',
  audio: '🎤 Áudio/Whisper',
  rag_query: '🔍 Busca RAG',
  ingestion: '📄 Ingestão de Docs',
  vision: '👁️ Visão/Imagem',
  unknown: '❓ Outro',
};

async function getCompanyIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId) {
      return adminSession.companyId;
    }

    if (adminSession.adminId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [adminSession.adminId],
      );

      if (data?.company_id) {
        return data.company_id;
      }
    }

    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    if (userSession.userId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [userSession.userId],
      );

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
        by_service: [],
      });
    }

    // Calculate date range
    let startDt: string;
    let endDt: string;
    let periodLabel: string;

    if (startDate && endDate) {
      startDt = `${startDate}T00:00:00-03:00`;
      endDt = `${endDate}T23:59:59-03:00`;
      periodLabel = `${startDate}_to_${endDate}`;
    } else {
      const now = new Date();
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      startDt = start.toISOString();
      endDt = now.toISOString();
      periodLabel = `last_${days}_days`;
    }

    // Fetch usage logs
    const logs = await queryAll(
      `SELECT service_type, model_name, total_cost_usd, input_tokens, output_tokens
       FROM token_usage_logs
       WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [companyId, startDt, endDt],
    );

    // Group by service
    const usageByService: Record<
      string,
      {
        cost: number;
        calls: number;
        tokensIn: number;
        tokensOut: number;
        models: Set<string>;
      }
    > = {};

    for (const log of logs || []) {
      const service = log.service_type || 'unknown';
      if (!usageByService[service]) {
        usageByService[service] = {
          cost: 0,
          calls: 0,
          tokensIn: 0,
          tokensOut: 0,
          models: new Set(),
        };
      }
      usageByService[service].cost +=
        parseFloat(log.total_cost_usd || '0') * DOLLAR_RATE * SELL_MULTIPLIER;
      usageByService[service].calls += 1;
      usageByService[service].tokensIn += log.input_tokens || 0;
      usageByService[service].tokensOut += log.output_tokens || 0;
      if (log.model_name) usageByService[service].models.add(log.model_name);
    }

    // Calculate total
    const totalCost = Object.values(usageByService).reduce((sum, u) => sum + u.cost, 0);

    // Format response
    const byService = Object.entries(usageByService)
      .map(([serviceType, usage]) => ({
        service_type: serviceType,
        service_name:
          SERVICE_NAMES[serviceType] ||
          `🔧 ${serviceType.charAt(0).toUpperCase() + serviceType.slice(1)}`,
        cost_brl: Math.round(usage.cost * 100) / 100,
        calls: usage.calls,
        tokens_input: usage.tokensIn,
        tokens_output: usage.tokensOut,
        models: Array.from(usage.models),
        percentage: totalCost > 0 ? Math.round((usage.cost / totalCost) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.cost_brl - a.cost_brl);

    return NextResponse.json({
      period: periodLabel,
      total_cost_brl: Math.round(totalCost * 100) / 100,
      by_service: byService,
    });
  } catch (error) {
    console.error('[Billing API] Usage by service error:', error);
    return NextResponse.json({
      period: 'last_30_days',
      total_cost_brl: 0,
      by_service: [],
    });
  }
}
