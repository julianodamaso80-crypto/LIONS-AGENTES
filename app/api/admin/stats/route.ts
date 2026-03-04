import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/admin/stats
 *
 * Returns dashboard statistics for admin panel.
 * Requires: smith_admin_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // =============================================
    // SERVICE ROLE CLIENT
    // =============================================
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // =============================================
    // FETCH STATISTICS
    // =============================================
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      companiesResult,
      usersResult,
      logsResult,
      failedLoginsResult,
      errorsResult,
      subscriptionsResult,
    ] = await Promise.all([
      supabaseAdmin.from('companies').select('status, monthly_fee'),
      supabaseAdmin.from('users_v2').select('status'),
      supabaseAdmin
        .from('system_logs')
        .select('id', { count: 'exact', head: true })
        .gte('timestamp', last24h),
      supabaseAdmin
        .from('system_logs')
        .select('id', { count: 'exact', head: true })
        .eq('action_type', 'LOGIN_FAILED')
        .gte('timestamp', last24h),
      supabaseAdmin
        .from('system_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'error')
        .gte('timestamp', last24h),
      // Buscar subscriptions ativas com dados do plano
      supabaseAdmin.from('subscriptions').select('id, plans(price_brl)').eq('status', 'active'),
    ]);

    // =============================================
    // CALCULATE STATS
    // =============================================
    const companies = companiesResult.data || [];
    const users = usersResult.data || [];
    const subscriptions = subscriptionsResult.data || [];

    // MRR = soma dos price_brl de todas as subscriptions ativas
    const mrr = subscriptions.reduce((sum, sub) => {
      const plan = sub.plans as any;
      const price = parseFloat(plan?.price_brl || '0');
      return sum + price;
    }, 0);

    const stats = {
      totalCompanies: companies.length,
      activeCompanies: companies.filter((c) => c.status === 'active').length,
      suspendedCompanies: companies.filter((c) => c.status === 'suspended').length,
      mrr: mrr,
      totalUsers: users.length,
      pendingUsers: users.filter((u) => u.status === 'pending').length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      suspendedUsers: users.filter((u) => u.status === 'suspended').length,
      logsLast24h: logsResult.count || 0,
      failedLoginsLast24h: failedLoginsResult.count || 0,
      errorsLast24h: errorsResult.count || 0,
      // Adicionar contagem de subscriptions ativas
      activeSubscriptions: subscriptions.length,
    };

    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('[ADMIN STATS] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao buscar estatísticas' }, { status: 500 });
  }
}
