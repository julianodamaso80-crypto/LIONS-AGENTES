import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll, queryOne } from '@/lib/db';

/**
 * GET /api/admin/stats
 *
 * Returns dashboard statistics for admin panel.
 * Requires: scale_admin_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('scale_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // =============================================
    // FETCH STATISTICS
    // =============================================
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      companies,
      users,
      logsCount,
      failedLoginsCount,
      errorsCount,
      subscriptions,
    ] = await Promise.all([
      queryAll('SELECT status, monthly_fee FROM companies'),
      queryAll('SELECT status FROM users_v2'),
      queryOne<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM system_logs WHERE timestamp >= $1',
        [last24h]
      ),
      queryOne<{ count: number }>(
        "SELECT COUNT(*)::int as count FROM system_logs WHERE action_type = 'LOGIN_FAILED' AND timestamp >= $1",
        [last24h]
      ),
      queryOne<{ count: number }>(
        "SELECT COUNT(*)::int as count FROM system_logs WHERE status = 'error' AND timestamp >= $1",
        [last24h]
      ),
      // Buscar subscriptions ativas com dados do plano
      queryAll(
        `SELECT s.id, p.price_brl
         FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE s.status = 'active'`
      ),
    ]);

    // =============================================
    // CALCULATE STATS
    // =============================================

    // MRR = soma dos price_brl de todas as subscriptions ativas
    const mrr = (subscriptions || []).reduce((sum, sub) => {
      const price = parseFloat(sub.price_brl || '0');
      return sum + price;
    }, 0);

    const stats = {
      totalCompanies: (companies || []).length,
      activeCompanies: (companies || []).filter((c) => c.status === 'active').length,
      suspendedCompanies: (companies || []).filter((c) => c.status === 'suspended').length,
      mrr: mrr,
      totalUsers: (users || []).length,
      pendingUsers: (users || []).filter((u) => u.status === 'pending').length,
      activeUsers: (users || []).filter((u) => u.status === 'active').length,
      suspendedUsers: (users || []).filter((u) => u.status === 'suspended').length,
      logsLast24h: logsCount?.count || 0,
      failedLoginsLast24h: failedLoginsCount?.count || 0,
      errorsLast24h: errorsCount?.count || 0,
      // Adicionar contagem de subscriptions ativas
      activeSubscriptions: (subscriptions || []).length,
    };

    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('[ADMIN STATS] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao buscar estatísticas' }, { status: 500 });
  }
}
