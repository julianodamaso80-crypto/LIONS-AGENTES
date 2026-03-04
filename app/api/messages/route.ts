import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/messages
 *
 * Creates a new message in a conversation.
 * Requires: smith_user_session OR smith_admin_session cookie
 */
export async function POST(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK (USER OR ADMIN)
    // =============================================
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('smith_user_session');
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!userCookie && !adminCookie) {
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
    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id,
        role,
        content,
        type: type || 'text',
        audio_url: audio_url || metadata?.audio_url || null,
        image_url: image_url || metadata?.image_url || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[MESSAGES API] Error creating message:', error);
      return NextResponse.json({ error: 'Erro ao criar mensagem' }, { status: 500 });
    }

    // Update conversation updated_at
    await supabaseAdmin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation_id);

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
 * Requires: smith_user_session OR smith_admin_session cookie
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('smith_user_session');
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!userCookie && !adminCookie) {
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

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select(
        `
                *,
                sender:sender_user_id (
                    first_name,
                    last_name,
                    avatar_url
                )
            `,
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    console.log('[MESSAGES API] Result:', { count: data?.length, error: error?.message });

    if (error) {
      console.error('[MESSAGES API] Error fetching messages:', error);
      return NextResponse.json({ error: 'Erro ao buscar mensagens' }, { status: 500 });
    }

    return NextResponse.json({ messages: data || [] });
  } catch (error: any) {
    console.error('[MESSAGES API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
