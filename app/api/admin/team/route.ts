import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryAll } from '@/lib/db';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/team
 * Returns team members for the authenticated company admin
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (!session.adminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = session.companyId;
    if (!companyId) {
      return NextResponse.json({ error: 'Company not found in session' }, { status: 400 });
    }

    // Get active and suspended users
    let teamData;
    try {
      teamData = await queryAll(
        `SELECT id, email, first_name, last_name, role, status, is_owner, created_at
         FROM users_v2
         WHERE company_id = $1 AND status = ANY($2::text[])
         ORDER BY is_owner DESC, created_at DESC`,
        [companyId, ['active', 'suspended']]
      );
    } catch (teamError) {
      console.error('[TEAM API] Error:', teamError);
      return NextResponse.json({ error: 'Error loading team' }, { status: 500 });
    }

    // Get pending users
    let pendingData;
    try {
      pendingData = await queryAll(
        `SELECT id, email, first_name, last_name, role, status, is_owner, created_at
         FROM users_v2
         WHERE company_id = $1 AND status = 'pending'
         ORDER BY created_at DESC`,
        [companyId]
      );
    } catch (pendingError) {
      console.error('[TEAM API] Error loading pending:', pendingError);
    }

    return NextResponse.json({
      users: teamData || [],
      pendingUsers: pendingData || [],
    });
  } catch (error: any) {
    console.error('[TEAM API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
