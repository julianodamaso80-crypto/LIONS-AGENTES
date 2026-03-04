import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/admin/users
 *
 * Returns list of all users WITHOUT sensitive fields.
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
    // FETCH USERS (WITHOUT SENSITIVE FIELDS)
    // =============================================
    // IMPORTANT: Never include password_hash, reset_token, etc.
    const { data: users, error } = await supabaseAdmin
      .from('users_v2')
      .select(
        'id, email, first_name, last_name, role, status, company_id, created_at, phone, cpf, is_owner',
      )
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ADMIN USERS] Error fetching users:', error);
      return NextResponse.json({ error: 'Erro ao buscar usuários' }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error: any) {
    console.error('[ADMIN USERS] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao buscar usuários' }, { status: 500 });
  }
}
