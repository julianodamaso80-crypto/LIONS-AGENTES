import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll } from '@/lib/db';

/**
 * GET /api/admin/conversation-logs/data
 * Returns all data needed for conversation logs page: companies, agents, users
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('scale_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all related data
    const [companies, agents, users] = await Promise.all([
      queryAll('SELECT id, company_name FROM companies ORDER BY company_name'),
      queryAll('SELECT id, name, company_id FROM agents'),
      queryAll('SELECT id, email, first_name, last_name FROM users_v2'),
    ]);

    return NextResponse.json({
      companies: companies || [],
      agents: agents || [],
      users: users || [],
    });
  } catch (error: any) {
    console.error('[CONV LOGS DATA] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
