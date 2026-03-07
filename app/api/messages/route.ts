import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll, insertOne, updateOne } from '@/lib/db';

/**
 * POST /api/messages
 *
 * Creates a new message in a conversation.
 * Requires: scale_user_session OR scale_admin_session cookie
 */
export async function POST(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK (USER OR ADMIN)
    // =============================================
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('scale_user_session');
    const adminCookie = cookieStore.get('scale_admin_session');

    if (!userCookie && !adminCookie) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // =============================================
    // VALIDATE INPUT
    // =============================================
    const body = await request.json();
    const { conversation_id, role, content, type, audio_url, image_url, metadata } = body;

    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id é obrigatório' }, { status: 400 });
    }

    if (!role || !content) {
      return NextResponse.json({ error: 'role e content são obrigatórios' }, { status: 400 });
    }

    // =============================================
    // CREATE MESSAGE
    // =============================================
    const data = await insertOne('messages', {
      conversation_id,
      role,
      content,
      type: type || 'text',
      audio_url: audio_url || metadata?.audio_url || null,
      image_url: image_url || metadata?.image_url || null,
    });

    if (!data) {
      console.error('[MESSAGES API] Error creating message');
      return NextResponse.json({ error: 'Erro ao criar mensagem' }, { status: 500 });
    }

    // Update conversation updated_at
    await updateOne('conversations', { updated_at: new Date().toISOString() }, { id: conversation_id });

    return NextResponse.json({ message: data }, { status: 201 });
  } catch (error: any) {
    console.error('[MESSAGES API] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao criar mensagem' }, { status: 500 });
  }
}

/**
 * GET /api/messages?conversation_id=xxx
 *
 * Gets all messages for a conversation.
 * Requires: scale_user_session OR scale_admin_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('scale_user_session');
    const adminCookie = cookieStore.get('scale_admin_session');

    if (!userCookie && !adminCookie) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // =============================================
    // GET CONVERSATION ID FROM QUERY
    // =============================================
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');

    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id é obrigatório' }, { status: 400 });
    }

    // =============================================
    // FETCH MESSAGES WITH SENDER INFO
    // Usa left join para trazer dados do admin que enviou (sender_user_id)
    // =============================================
    // console.log('[MESSAGES API] Fetching messages for conversation:', conversationId);

    const data = await queryAll(
      `SELECT m.*,
              json_build_object(
                'first_name', u.first_name,
                'last_name', u.last_name,
                'avatar_url', u.avatar_url
              ) AS sender
       FROM messages m
       LEFT JOIN users_v2 u ON u.id = m.sender_user_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId],
    );

    console.log('[MESSAGES API] Result:', { count: data?.length, error: null });

    return NextResponse.json({ messages: data || [] });
  } catch (error: any) {
    console.error('[MESSAGES API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
