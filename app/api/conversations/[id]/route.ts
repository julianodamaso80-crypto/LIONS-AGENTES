import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
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
 * Requires: smith_user_session OR smith_admin_session cookie
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
    let query = supabaseAdmin.from('conversations').update(updateData).eq('id', conversationId);

    // If it's a user (not admin), ensure they own the conversation
    if (userId && !hasAdminSession) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.select().single();

    if (error) {
      console.error('[CONVERSATIONS API] Error updating:', error);
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
 * Requires: smith_user_session OR smith_admin_session cookie
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;

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
    // FETCH CONVERSATION WITH MESSAGES
    // =============================================
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('*, messages(*)')
      .eq('id', conversationId)
      .single();

    if (error) {
      console.error('[CONVERSATIONS API] Error fetching:', error);
      return NextResponse.json({ error: 'Erro ao buscar conversa' }, { status: 500 });
    }

    return NextResponse.json({ conversation });
  } catch (error: any) {
    console.error('[CONVERSATIONS API] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
