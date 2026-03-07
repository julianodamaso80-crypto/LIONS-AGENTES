import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll, query } from '@/lib/db';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/conversations/[id]
 *
 * Updates a conversation (title, updated_at, status).
 * Requires: scale_user_session OR scale_admin_session cookie
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;

    // =============================================
    // AUTHENTICATION CHECK (USER OR ADMIN)
    // =============================================
    const cookieStore = await cookies();
    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    const hasUserSession = !!userSession.userId;
    const hasAdminSession = !!adminSession.adminId;

    if (!hasUserSession && !hasAdminSession) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const userId = userSession.userId || null;

    // =============================================
    // VALIDATE INPUT
    // =============================================
    const body = await request.json();
    const { title, status, updated_at, unread_count } = body;

    // Build update object
    const updateData: Record<string, any> = {};
    if (title !== undefined) updateData.title = title;
    if (status !== undefined) updateData.status = status;
    if (unread_count !== undefined) updateData.unread_count = unread_count;
    if (updated_at !== undefined) updateData.updated_at = updated_at;
    else updateData.updated_at = new Date().toISOString();

    // =============================================
    // UPDATE CONVERSATION
    // =============================================
    // Build SET clause dynamically
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updateData)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    // Build WHERE clause
    let whereClause = `id = $${paramIndex}`;
    values.push(conversationId);
    paramIndex++;

    // If it's a user (not admin), ensure they own the conversation
    if (userId && !hasAdminSession) {
      whereClause += ` AND user_id = $${paramIndex}`;
      values.push(userId);
      paramIndex++;
    }

    const data = await queryOne(
      `UPDATE conversations SET ${setClauses.join(', ')} WHERE ${whereClause} RETURNING *`,
      values,
    );

    if (!data) {
      console.error('[CONVERSATIONS API] Error updating conversation');
      return NextResponse.json({ error: 'Erro ao atualizar conversa' }, { status: 500 });
    }

    return NextResponse.json({ conversation: data });
  } catch (error: any) {
    console.error('[CONVERSATIONS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao atualizar conversa' }, { status: 500 });
  }
}

/**
 * GET /api/conversations/[id]
 *
 * Gets a single conversation with messages.
 * Requires: scale_user_session OR scale_admin_session cookie
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;

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
    // FETCH CONVERSATION WITH MESSAGES
    // =============================================
    const conversation = await queryOne(
      'SELECT * FROM conversations WHERE id = $1',
      [conversationId],
    );

    if (!conversation) {
      console.error('[CONVERSATIONS API] Error fetching conversation');
      return NextResponse.json({ error: 'Erro ao buscar conversa' }, { status: 500 });
    }

    // Fetch messages separately
    const messages = await queryAll(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId],
    );

    return NextResponse.json({ conversation: { ...conversation, messages: messages || [] } });
  } catch (error: any) {
    console.error('[CONVERSATIONS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
