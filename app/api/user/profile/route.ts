import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, updateOne } from '@/lib/db';
import { sessionOptions, SessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/profile
 *
 * Returns the authenticated user's full profile.
 * Query params:
 * - full=true: Returns all fields (for settings page)
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    const { searchParams } = new URL(request.url);
    const fullProfile = searchParams.get('full') === 'true';

    if (fullProfile) {
      // Return full profile for settings page
      const data = await queryOne(
        `SELECT u.first_name, u.last_name, u.email, u.phone, u.cpf, u.birth_date, u.avatar_url, c.company_name
         FROM users_v2 u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1`,
        [userId],
      );

      if (!data) {
        console.error('[USER PROFILE] Error: user not found');
        return NextResponse.json({ error: 'Error fetching profile' }, { status: 500 });
      }

      return NextResponse.json({
        first_name: data?.first_name || '',
        last_name: data?.last_name || '',
        email: data?.email || '',
        phone: data?.phone || '',
        cpf: data?.cpf || '',
        birth_date: data?.birth_date || '',
        avatar_url: data?.avatar_url || '',
        companyName: data?.company_name || 'Empresa',
      });
    }

    // Simple profile for sidebar
    const data = await queryOne(
      `SELECT u.first_name, u.last_name, u.email, c.company_name
       FROM users_v2 u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [userId],
    );

    if (!data) {
      console.error('[USER PROFILE] Error: user not found');
      return NextResponse.json({ error: 'Error fetching profile' }, { status: 500 });
    }

    return NextResponse.json({
      name: `${data?.first_name || ''} ${data?.last_name || ''}`.trim(),
      email: data?.email || '',
      companyName: data?.company_name || 'Empresa',
    });
  } catch (error: any) {
    console.error('[USER PROFILE] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/user/profile
 *
 * Updates the authenticated user's profile.
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    const body = await request.json();
    const { first_name, last_name, phone, avatar_url } = body;

    await updateOne(
      'users_v2',
      {
        first_name,
        last_name,
        phone,
        avatar_url,
        updated_at: new Date().toISOString(),
      },
      { id: userId },
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[USER PROFILE] Update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
