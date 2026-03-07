import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll } from '@/lib/db';

/**
 * GET /api/admin/logs/data
 *
 * Returns system logs and related entity data for the admin logs page.
 * Requires: scale_admin_session cookie
 *
 * Query params:
 * - dateFilter: 'today' | '7days' | '30days' | '90days'
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
    // GET DATE FILTER FROM QUERY
    // =============================================
    const { searchParams } = new URL(request.url);
    const dateFilter = searchParams.get('dateFilter') || '7days';
    const dateThreshold = getDateThreshold(dateFilter);

    // =============================================
    // FETCH DATA
    // =============================================
    const [logs, users, admins, companies] = await Promise.all([
      queryAll(
        'SELECT * FROM system_logs WHERE timestamp >= $1 ORDER BY timestamp DESC LIMIT 1000',
        [dateThreshold]
      ),
      // IMPORTANT: Never include password_hash or sensitive fields
      queryAll('SELECT id, email, first_name, last_name, company_id FROM users_v2'),
      queryAll('SELECT id, email, name FROM admin_users'),
      queryAll('SELECT id, company_name FROM companies'),
    ]);

    // =============================================
    // BUILD LOOKUP MAPS
    // =============================================
    const usersMap: Record<string, any> = {};
    if (users) {
      users.forEach((user) => {
        usersMap[user.id] = user;
      });
    }

    const adminsMap: Record<string, any> = {};
    if (admins) {
      admins.forEach((admin) => {
        adminsMap[admin.id] = admin;
      });
    }

    const companiesMap: Record<string, any> = {};
    if (companies) {
      companies.forEach((company) => {
        companiesMap[company.id] = company;
      });
    }

    return NextResponse.json({
      logs: logs || [],
      users: usersMap,
      admins: adminsMap,
      companies: companiesMap,
    });
  } catch (error: any) {
    console.error('[ADMIN LOGS DATA] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao buscar logs' }, { status: 500 });
  }
}

/**
 * Calculate date threshold based on filter
 */
function getDateThreshold(filter: string): string {
  const now = new Date();
  switch (filter) {
    case 'today':
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
    case '7days':
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    case '30days':
      now.setDate(now.getDate() - 30);
      return now.toISOString();
    case '90days':
      now.setDate(now.getDate() - 90);
      return now.toISOString();
    default:
      now.setDate(now.getDate() - 7);
      return now.toISOString();
  }
}
