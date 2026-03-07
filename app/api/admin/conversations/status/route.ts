import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { updateOne } from '@/lib/db';

/**
 * PUT /api/admin/conversations/status
 * Updates conversation status (takeover, close handoff)
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('scale_admin_session');

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

    try {
      await updateOne('conversations', updateData, { id: conversation_id });
    } catch (dbError: any) {
      console.error('[CONV STATUS] Error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[CONV STATUS] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
