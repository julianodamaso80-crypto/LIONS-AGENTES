import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/widget/messages?session_id=xxx
 *
 * Public API for widget to fetch messages by session_id.
 * Used for polling to get admin messages during Human Handoff.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');

    if (!sessionId) {
      return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
    }

    // Service Role Client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Find conversation by session_id
    const { data: conv, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id, status')
      .eq('session_id', sessionId)
      .limit(1)
      .single();

    if (convError || !conv) {
      // No conversation found - return empty messages
      return NextResponse.json({ messages: [], status: 'open' });
    }

    // Fetch messages for this conversation
    const { data: messages, error: msgError } = await supabaseAdmin
      .from('messages')
      .select(
        `
                id,
                role,
                content,
                image_url,
                audio_url,
                created_at,
                sender_user_id,
                sender:sender_user_id (
                    first_name,
                    last_name
                )
            `,
      )
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    if (msgError) {
      console.error('[WIDGET MESSAGES API] Error:', msgError);
      return NextResponse.json({ error: 'Error fetching messages' }, { status: 500 });
    }

    return NextResponse.json({
      messages: messages || [],
      status: conv.status, // 'open', 'HUMAN_REQUESTED', etc.
      conversationId: conv.id,
    });
  } catch (error: any) {
    console.error('[WIDGET MESSAGES API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
