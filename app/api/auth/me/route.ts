import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne } from '@/lib/db';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 *
 * Returns the current user session info
 * Used by hooks to determine user role
 * Also checks if user needs to re-accept terms of use
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    // Try user session first
    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);

    let userId: string | null = null;
    let isMasterAdmin = false;

    if (userSession.userId) {
      userId = userSession.userId;
    } else {
      // If no user session, try admin session
      const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
      if (adminSession.adminId) {
        userId = adminSession.adminId;

        // Check if this is a master admin (from admin_users table)
        const masterCheck = await queryOne(
          'SELECT id FROM admin_users WHERE id = $1',
          [adminSession.adminId],
        );

        isMasterAdmin = !!masterCheck;
      }
    }

    if (!userId) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    // Get user details from database
    const user = await queryOne(
      'SELECT id, email, first_name, last_name, company_id, role, status, is_owner, avatar_url, accepted_terms_version FROM users_v2 WHERE id = $1',
      [userId],
    );

    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    // Check terms acceptance (skip for master admins)
    let termsOutdated = false;
    let activeTerms = null;

    if (!isMasterAdmin) {
      const activeDoc = await queryOne(
        'SELECT id, title, content, version FROM legal_documents WHERE type = $1 AND is_active = $2',
        ['terms_of_use', true],
      );

      if (activeDoc && activeDoc.id !== user.accepted_terms_version) {
        termsOutdated = true;
        activeTerms = activeDoc;
      }
    }

    // Return user info
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        company_id: user.company_id,
        role: user.role,
        status: user.status,
        is_owner: user.is_owner || false,
        avatar_url: user.avatar_url || null,
      },
      termsOutdated,
      activeTerms,
    });
  } catch (error) {
    console.error('[AUTH ME] Error:', error);
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
