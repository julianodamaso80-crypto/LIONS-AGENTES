import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryAll } from '@/lib/db';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversations
 *
 * Returns all conversations for the admin's company with user and agent data.
 * Requires: smith_admin_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (!session.adminId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const companyId = session.companyId;
    if (!companyId) {
      return NextResponse.json({ error: 'Empresa não encontrada na sessão' }, { status: 401 });
    }

    // =============================================
    // FETCH CONVERSATIONS
    // =============================================
    const conversationsData = await queryAll(
      `SELECT c.*, a.id AS agent_id_ref, a.name AS agent_name
       FROM conversations c
       LEFT JOIN agents a ON a.id = c.agent_id
       WHERE c.company_id = $1
       ORDER BY c.last_message_at DESC`,
      [companyId]
    );

    // Reshape agent data to match previous format
    const conversationsWithAgents = conversationsData.map((conv) => {
      const { agent_id_ref, agent_name, ...rest } = conv;
      return {
        ...rest,
        agents: agent_id_ref ? { id: agent_id_ref, name: agent_name } : null,
      };
    });

    // =============================================
    // BUSCAR DADOS DOS LEADS (polimórfico)
    // user_id pode ser de leads OU users_v2
    // =============================================
    const userIds = Array.from(new Set(conversationsWithAgents?.map((c: any) => c.user_id).filter(Boolean)));

    let leadMap = new Map();
    let userMap = new Map();

    // Só busca se tiver userIds
    if (userIds.length > 0) {
      // Buscar em leads
      const leadsData = await queryAll(
        'SELECT id, name, email FROM leads WHERE id = ANY($1::uuid[])',
        [userIds]
      );

      // Buscar em users_v2 (para conversas de usuários logados)
      const usersData = await queryAll(
        'SELECT id, first_name, last_name, email, avatar_url FROM users_v2 WHERE id = ANY($1::uuid[])',
        [userIds]
      );

      // Criar mapa de lookup
      leadMap = new Map(leadsData?.map((l) => [l.id, l]) || []);
      userMap = new Map(usersData?.map((u) => [u.id, u]) || []);
    }

    // Enriquecer conversas com dados do usuário/lead
    const enrichedConversations =
      conversationsWithAgents?.map((conv) => {
        const lead = leadMap.get(conv.user_id);
        const user = userMap.get(conv.user_id);

        return {
          ...conv,
          // Se for lead, usa nome do lead. Se for user, usa first_name + last_name
          user_name:
            conv.user_name ||
            lead?.name ||
            (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null),
          user_email: lead?.email || user?.email,
          user_avatar: conv.user_avatar || user?.avatar_url,
        };
      }) || [];

    return NextResponse.json({ conversations: enrichedConversations });
  } catch (error: any) {
    console.error('[ADMIN CONVERSATIONS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
