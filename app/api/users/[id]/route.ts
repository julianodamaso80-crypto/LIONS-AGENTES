import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryOne } from '@/lib/db';

/**
 * GET /api/users/[id]
 *
 * Returns basic user info for displaying sender name/avatar.
 * Used by Realtime message enrichment.
 * Requires: smith_admin_session cookie
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // =============================================
    // AUTHENTICATION CHECK (USER OR ADMIN)
    // =============================================
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('smith_user_session');
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!userCookie && !adminCookie) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!id) {
      return NextResponse.json({ error: 'ID é obrigatório' }, { status: 400 });
    }

    // =============================================
    // FETCH USER BASIC INFO
    // =============================================
    const data = await queryOne(
      'SELECT id, first_name, last_name, avatar_url FROM users_v2 WHERE id = $1',
      [id],
    );

    if (!data) {
      console.error('[USERS API] Error: user not found');
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    return NextResponse.json({ user: data });
  } catch (error: any) {
    console.error('[USERS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
