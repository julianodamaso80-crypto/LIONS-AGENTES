import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

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
    const { data: admin, error: adminError } = await supabaseAdmin
      .from('users_v2')
      .select('id, company_id, role, is_owner')
      .eq('id', adminId)
      .single();

    if (adminError || !admin) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    // Check if admin is admin_company, owner or admin
    if (admin.role !== 'admin_company' && admin.role !== 'owner' && admin.role !== 'admin') {
      return NextResponse.json({ error: 'Only company admins can approve users' }, { status: 403 });
    }

    // Get user to approve and verify same company
    const { data: user, error: userError } = await supabaseAdmin
      .from('users_v2')
      .select('id, company_id, status, email, first_name, role, is_owner')
      .eq('id', userId)
      .single();

    if (userError || !user) {
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
    const { error: updateError } = await supabaseAdmin
      .from('users_v2')
      .update({ status: 'active' })
      .eq('id', userId);

    if (updateError) {
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
