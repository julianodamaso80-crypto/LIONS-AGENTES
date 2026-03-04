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
  '[Billing Debug daily] DOLLAR_RATE:',
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
        daily: [],
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
      `SELECT created_at, total_cost_usd, input_tokens, output_tokens
       FROM token_usage_logs
       WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at`,
      [companyId, startDt, endDt],
    );

    // Group by day
    const dailyData: Record<string, { cost: number; calls: number; tokens: number }> = {};

    for (const log of logs || []) {
      const dateStr = (log.created_at || '').substring(0, 10); // "2025-12-28"
      if (!dateStr) continue;

      if (!dailyData[dateStr]) {
        dailyData[dateStr] = { cost: 0, calls: 0, tokens: 0 };
      }
      dailyData[dateStr].cost +=
        parseFloat(log.total_cost_usd || '0') * DOLLAR_RATE * SELL_MULTIPLIER;
      dailyData[dateStr].calls += 1;
      dailyData[dateStr].tokens += (log.input_tokens || 0) + (log.output_tokens || 0);
    }

    // Format response
    const daily = Object.entries(dailyData)
      .map(([date, data]) => ({
        date,
        cost_brl: Math.round(data.cost * 100) / 100,
        calls: data.calls,
        tokens: data.tokens,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      period: periodLabel,
      daily,
    });
  } catch (error) {
    console.error('[Billing API] Usage daily error:', error);
    return NextResponse.json({
      period: 'last_30_days',
      daily: [],
    });
  }
}
