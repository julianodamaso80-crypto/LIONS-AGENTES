import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, updateOne } from '@/lib/db';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/team/approve
 *
 * Approve a pending user
 * Requires: Company admin authentication
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (!session.adminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminId = session.adminId;

    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get admin user and verify they're a company admin
    const admin = await queryOne(
      'SELECT id, company_id, role, is_owner FROM users_v2 WHERE id = $1',
      [adminId]
    );

    if (!admin) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    // Check if admin is admin_company, owner or admin
    if (admin.role !== 'admin_company' && admin.role !== 'owner' && admin.role !== 'admin') {
      return NextResponse.json({ error: 'Only company admins can approve users' }, { status: 403 });
    }

    // Get user to approve and verify same company
    const user = await queryOne(
      'SELECT id, company_id, status, email, first_name, role, is_owner FROM users_v2 WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // VALIDATION: Only Master Admin can approve Owners
    // (Master Admin doesn't have a company_id)
    if (user.is_owner && user.role === 'admin_company' && admin.company_id) {
      return NextResponse.json(
        { error: 'Apenas Master Admin pode aprovar Admin Company Owner' },
        { status: 403 },
      );
    }

    // Verify same company
    if (user.company_id !== admin.company_id) {
      return NextResponse.json(
        { error: 'Cannot approve users from other companies' },
        { status: 403 },
      );
    }

    // Update user status to active
    try {
      await updateOne('users_v2', { status: 'active' }, { id: userId });
    } catch (updateError) {
      console.error('[APPROVE USER] Error:', updateError);
      return NextResponse.json({ error: 'Failed to approve user' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `User ${user.first_name} approved successfully`,
    });
  } catch (error: any) {
    console.error('[APPROVE USER] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
