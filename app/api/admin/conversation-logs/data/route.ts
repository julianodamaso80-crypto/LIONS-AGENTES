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
 * GET /api/admin/conversation-logs/data
 * Returns all data needed for conversation logs page: companies, agents, users
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all related data
    const [companiesResult, agentsResult, usersResult] = await Promise.all([
      supabaseAdmin.from('companies').select('id, company_name').order('company_name'),
      supabaseAdmin.from('agents').select('id, name, company_id'),
      supabaseAdmin.from('users_v2').select('id, email, first_name, last_name'),
    ]);

    if (companiesResult.error) {
      console.error('[CONV LOGS DATA] Companies error:', companiesResult.error);
    }

    return NextResponse.json({
      companies: companiesResult.data || [],
      agents: agentsResult.data || [],
      users: usersResult.data || [],
    });
  } catch (error: any) {
    console.error('[CONV LOGS DATA] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
