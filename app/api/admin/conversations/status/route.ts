import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * PUT /api/admin/conversations/status
 * Updates conversation status (takeover, close handoff)
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { conversation_id, status, reason } = body;

    if (!conversation_id || !status) {
      return NextResponse.json(
        { error: 'conversation_id and status are required' },
        { status: 400 },
      );
    }

    const updateData: any = { status };
    if (reason) {
      updateData.human_handoff_reason = reason;
    }

    const { error } = await supabaseAdmin
      .from('conversations')
      .update(updateData)
      .eq('id', conversation_id);

    if (error) {
      console.error('[CONV STATUS] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[CONV STATUS] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
