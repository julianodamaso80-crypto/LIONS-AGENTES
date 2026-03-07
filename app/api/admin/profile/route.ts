import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { updateOne } from '@/lib/db';

/**
 * PUT /api/admin/profile
 * Updates admin profile (first_name, last_name, avatar_url)
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('scale_admin_session');
    const userCookie = cookieStore.get('scale_user_session');

    if (!adminCookie && !userCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, first_name, last_name, avatar_url } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    try {
      await updateOne('users_v2', {
        first_name,
        last_name,
        avatar_url,
      }, { id: userId });
    } catch (dbError: any) {
      console.error('[ADMIN PROFILE] Update error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[ADMIN PROFILE] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
