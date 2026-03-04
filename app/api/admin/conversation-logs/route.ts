import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * GET /api/admin/conversation-logs
 * Returns conversation logs with related data for the admin logs page.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('company_id');

    // Build query
    let query = supabaseAdmin
      .from('conversation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (companyId && companyId !== 'all') {
      query = query.eq('company_id', companyId);
    }

    const { data: logs, error } = await query;

    if (error) {
      console.error('[CONVERSATION LOGS API] Error:', error);
      return NextResponse.json({ error: 'Error fetching logs' }, { status: 500 });
    }

    return NextResponse.json({ logs: logs || [] });
  } catch (error: any) {
    console.error('[CONVERSATION LOGS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
