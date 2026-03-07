import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll } from '@/lib/db';
import { sessionOptions, SessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents
 *
 * Lists active agents for the logged-in user's company.
 * Requires: scale_user_session cookie
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
    // GET USER'S COMPANY
    // =============================================
    const userData = await queryOne<{ company_id: string }>(
      'SELECT company_id FROM users_v2 WHERE id = $1',
      [userId],
    );

    if (!userData?.company_id) {
      return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }

    // =============================================
    // FETCH ACTIVE AGENTS
    // =============================================
    const agents = await queryAll(
      'SELECT id, name, is_subagent, allow_direct_chat FROM agents WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC',
      [userData.company_id],
    );

    if (!agents) {
      console.error('[AGENTS API] Error fetching agents');
      return NextResponse.json({ error: 'Erro ao buscar agentes' }, { status: 500 });
    }

    // Filter out subagents that don't have allow_direct_chat enabled
    const chatAgents = (agents || []).filter(
      (a: any) => !a.is_subagent || a.allow_direct_chat
    );

    return NextResponse.json({ agents: chatAgents });
  } catch (error: any) {
    console.error('[AGENTS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
