import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';

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

    // Find conversation by session_id
    const conv = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM conversations WHERE session_id = $1 LIMIT 1',
      [sessionId],
    );

    if (!conv) {
      // No conversation found - return empty messages
      return NextResponse.json({ messages: [], status: 'open' });
    }

    // Fetch messages for this conversation
    const messages = await queryAll(
      `SELECT m.id,
              m.role,
              m.content,
              m.image_url,
              m.audio_url,
              m.created_at,
              m.sender_user_id,
              json_build_object(
                'first_name', u.first_name,
                'last_name', u.last_name
              ) AS sender
       FROM messages m
       LEFT JOIN users_v2 u ON u.id = m.sender_user_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conv.id],
    );

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
