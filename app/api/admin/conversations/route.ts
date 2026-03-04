import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
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
    // SERVICE ROLE CLIENT
    // =============================================
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // =============================================
    // FETCH CONVERSATIONS
    // =============================================
    const { data: conversationsData, error } = await supabaseAdmin
      .from('conversations')
      .select(
        `
                *,
                agents:agent_id (
                    id,
                    name
                )
            `,
      )
      .eq('company_id', companyId)
      .order('last_message_at', { ascending: false });

    if (error) {
      console.error('[ADMIN CONVERSATIONS API] Error:', error);
      return NextResponse.json({ error: 'Erro ao buscar conversas' }, { status: 500 });
    }

    // =============================================
    // BUSCAR DADOS DOS LEADS (polimórfico)
    // user_id pode ser de leads OU users_v2
    // =============================================
    const userIds = Array.from(new Set(conversationsData?.map((c) => c.user_id).filter(Boolean)));

    let leadMap = new Map();
    let userMap = new Map();

    // Só busca se tiver userIds
    if (userIds.length > 0) {
      // Buscar em leads
      const { data: leadsData } = await supabaseAdmin
        .from('leads')
        .select('id, name, email')
        .in('id', userIds);

      // Buscar em users_v2 (para conversas de usuários logados)
      const { data: usersData } = await supabaseAdmin
        .from('users_v2')
        .select('id, first_name, last_name, email, avatar_url')
        .in('id', userIds);

      // Criar mapa de lookup
      leadMap = new Map(leadsData?.map((l) => [l.id, l]) || []);
      userMap = new Map(usersData?.map((u) => [u.id, u]) || []);
    }

    // Enriquecer conversas com dados do usuário/lead
    const enrichedConversations =
      conversationsData?.map((conv) => {
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
