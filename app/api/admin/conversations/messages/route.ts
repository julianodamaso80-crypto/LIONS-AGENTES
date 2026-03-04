import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/admin/conversations/messages
 * Sends a message from admin (human takeover)
 *
 * Security:
 * 1. Validates admin session via iron-session
 * 2. Validates admin has access to the conversation's company (multi-tenant)
 * 3. Saves message with sender_user_id for audit trail
 * 4. Forwards to Python backend via ADMIN_API_KEY for WhatsApp delivery
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    // 1. Get admin session using iron-session (secure)
    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (!adminSession.adminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const senderUserId = adminSession.adminId;

    const body = await request.json();
    const { conversation_id, content, image_url, audio_url, type = 'text' } = body;

    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
    }

    // 2. Multi-tenant security: Verify admin has access to this conversation's company
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('company_id, session_id, user_phone, channel')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error('[ADMIN MESSAGES] Conversation not found:', convError);
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Master admin can access all companies, company_admin only their own company
    if (
      adminSession.role !== 'master_admin' &&
      conversation.company_id !== adminSession.companyId
    ) {
      console.warn(
        `[ADMIN MESSAGES] Forbidden: Admin ${adminSession.adminId} tried to access company ${conversation.company_id}`,
      );
      return NextResponse.json(
        { error: 'Forbidden - Access denied to this company' },
        { status: 403 },
      );
    }

    // Remove prefixo [👤 Nome] se existir (compatibilidade com frontend antigo)
    const cleanContent = content ? content.replace(/^\[👤\s+.+?\]\n/, '') : '';

    // 3. Insert message with sender_user_id for attribution
    const { data: newMessage, error: insertError } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id,
        role: 'assistant',
        content: cleanContent,
        image_url: image_url || null,
        audio_url: audio_url || null,
        type,
        sender_user_id: senderUserId, // ✅ FK para users_v2 - audit trail
      })
      .select()
      .single();

    if (insertError) {
      console.error('[ADMIN MESSAGES] Insert error:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Update conversation preview
    await supabaseAdmin
      .from('conversations')
      .update({
        last_message_preview: cleanContent.substring(0, 100),
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversation_id);

    // 4. Forward to Python backend for WhatsApp delivery (if WhatsApp channel)
    if (conversation.channel === 'whatsapp' && conversation.session_id && conversation.user_phone) {
      try {
        const payload: Record<string, string> = {
          session_id: conversation.session_id,
          phone: conversation.user_phone,
        };

        // Add content based on type
        if (image_url) {
          payload.image_url = image_url;
        } else if (audio_url) {
          payload.audio_url = audio_url;
        } else if (cleanContent) {
          payload.message = cleanContent;
        }

        const response = await fetch(`${BACKEND_URL}/api/webhook/send-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-API-Key': process.env.ADMIN_API_KEY || '',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ADMIN MESSAGES] WhatsApp forward failed:', response.status, errorText);
          // Don't fail the request - message was saved, just WhatsApp failed
        }
      } catch (whatsappError) {
        console.error('[ADMIN MESSAGES] WhatsApp forward error:', whatsappError);
        // Don't fail the request - message was saved
      }
    }

    return NextResponse.json({ message: newMessage });
  } catch (error: any) {
    console.error('[ADMIN MESSAGES] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
