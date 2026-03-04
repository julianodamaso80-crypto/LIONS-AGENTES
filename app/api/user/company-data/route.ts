import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne } from '@/lib/db';
import { sessionOptions, SessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/company-data
 *
 * Returns the logged-in user's company_id and company settings (allow_web_search).
 * Requires: smith_user_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

    if (!session.userId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const userId = session.userId;

    // =============================================
    // FETCH USER -> COMPANY DATA
    // =============================================
    const userData = await queryOne(
      'SELECT company_id FROM users_v2 WHERE id = $1',
      [userId],
    );

    if (!userData?.company_id) {
      return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }

    const companyData = await queryOne(
      'SELECT id, allow_web_search FROM companies WHERE id = $1',
      [userData.company_id],
    );

    if (!companyData) {
      return NextResponse.json({ error: 'Erro ao buscar dados da empresa' }, { status: 500 });
    }

    return NextResponse.json({
      companyId: userData.company_id,
      allowWebSearch: companyData?.allow_web_search || false,
    });
  } catch (error: any) {
    console.error('[USER COMPANY DATA] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
