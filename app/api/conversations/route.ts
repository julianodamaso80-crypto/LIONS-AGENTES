import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll, insertOne, countWhere } from '@/lib/db';
import { sessionOptions, SessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/conversations
 *
 * Creates a new conversation for the authenticated user.
 * Requires: scale_user_session cookie
 */
export async function POST(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK (USER SESSION)
    // =============================================
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

    if (!session.userId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const userId = session.userId;

    // =============================================
    // VALIDATE INPUT
    // =============================================
    const body = await request.json();
    const { title, session_id, agent_id } = body;

    // =============================================
    // GET USER'S COMPANY
    // =============================================
    const userData = await queryOne<{ company_id: string }>(
      'SELECT company_id FROM users_v2 WHERE id = $1',
      [userId],
    );

    if (!userData?.company_id) {
      return NextResponse.json({ error: 'Empresa do usuário não encontrada' }, { status: 400 });
    }

    // =============================================
    // CREATE CONVERSATION
    // =============================================
    const data = await insertOne('conversations', {
      user_id: userId,
      company_id: userData.company_id,
      agent_id: agent_id || null,
      session_id: session_id || null,
      title: title || 'Nova Conversa',
      status: 'active',
    });

    if (!data) {
      console.error('[CONVERSATIONS API] Error creating conversation');
      return NextResponse.json({ error: 'Erro ao criar conversa' }, { status: 500 });
    }

    return NextResponse.json({ conversation: data }, { status: 201 });
  } catch (error: any) {
    console.error('[CONVERSATIONS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao criar conversa' }, { status: 500 });
  }
}

/**
 * GET /api/conversations
 *
 * Gets all conversations for the authenticated user.
 * Requires: scale_user_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK (USER SESSION)
    // =============================================
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

    if (!session.userId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const userId = session.userId;

    // =============================================
    // GET QUERY PARAMS
    // =============================================
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');

    // =============================================
    // FETCH CONVERSATIONS
    // =============================================
    if (sessionId) {
      // Fetch specific conversation by session_id with messages
      const conversation = await queryOne(
        'SELECT id, agent_id, session_id, status, title, created_at, updated_at FROM conversations WHERE session_id = $1 AND user_id = $2',
        [sessionId, userId],
      );

      if (!conversation) {
        return NextResponse.json({ conversation: null, messages: [] });
      }

      // Fetch messages for this conversation
      try {
        const messages = await queryAll(
          'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
          [conversation.id],
        );

        return NextResponse.json({
          conversation,
          messages: messages || [],
        });
      } catch (messagesError) {
        console.error('[CONVERSATIONS API] Error fetching messages:', messagesError);
        return NextResponse.json({
          conversation,
          messages: [],
        });
      }
    }

    // Get limit from query params (default 50)
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const includeCounts = searchParams.get('include_counts') === 'true';

    // Fetch all conversations for user with agent info
    const data = await queryAll(
      'SELECT c.*, a.name as agent_name FROM conversations c LEFT JOIN agents a ON a.id = c.agent_id WHERE c.user_id = $1 ORDER BY c.updated_at DESC LIMIT $2',
      [userId, limit],
    );

    // Transform to match previous format (agents nested object)
    const conversations = (data || []).map((row: any) => {
      const { agent_name, ...rest } = row;
      return { ...rest, agents: agent_name ? { name: agent_name } : null };
    });

    // Add message counts if requested
    let conversationsWithCounts = conversations;
    if (includeCounts && conversations.length > 0) {
      conversationsWithCounts = await Promise.all(
        conversations.map(async (conv: any) => {
          const count = await countWhere('messages', { conversation_id: conv.id });
          return { ...conv, message_count: count || 0 };
        }),
      );
    }

    return NextResponse.json({ conversations: conversationsWithCounts });
  } catch (error: any) {
    console.error('[CONVERSATIONS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao buscar conversas' }, { status: 500 });
  }
}
