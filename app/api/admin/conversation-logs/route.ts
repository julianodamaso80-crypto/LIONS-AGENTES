import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll } from '@/lib/db';

/**
 * GET /api/admin/conversation-logs
 * Returns conversation logs with related data for the admin logs page.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('scale_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('company_id');

    let logs;
    if (companyId && companyId !== 'all') {
      logs = await queryAll(
        'SELECT * FROM conversation_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100',
        [companyId],
      );
    } else {
      logs = await queryAll(
        'SELECT * FROM conversation_logs ORDER BY created_at DESC LIMIT 100',
      );
    }

    return NextResponse.json({ logs: logs || [] });
  } catch (error: any) {
    console.error('[CONVERSATION LOGS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
