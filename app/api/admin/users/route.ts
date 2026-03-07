import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll } from '@/lib/db';

/**
 * GET /api/admin/users
 *
 * Returns list of all users WITHOUT sensitive fields.
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
    // FETCH USERS (WITHOUT SENSITIVE FIELDS)
    // =============================================
    // IMPORTANT: Never include password_hash, reset_token, etc.
    try {
      const users = await queryAll(
        'SELECT id, email, first_name, last_name, role, status, company_id, created_at, phone, cpf, is_owner FROM users_v2 ORDER BY created_at DESC'
      );

      return NextResponse.json({ users: users || [] });
    } catch (dbError) {
      console.error('[ADMIN USERS] Error fetching users:', dbError);
      return NextResponse.json({ error: 'Erro ao buscar usuários' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[ADMIN USERS] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao buscar usuários' }, { status: 500 });
  }
}
