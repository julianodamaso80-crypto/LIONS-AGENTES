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
 * PUT /api/admin/users/status
 * Updates user status (active, suspended)
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (!session.adminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, status, companyId: targetCompanyId } = body;

    if (!userId || !status) {
      return NextResponse.json({ error: 'userId and status are required' }, { status: 400 });
    }

    if (!['active', 'suspended'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be active or suspended' },
        { status: 400 },
      );
    }

    // For company admins, verify they can only update users in their company
    if (session.companyId && session.role !== 'master_admin') {
      const { data: user } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', userId)
        .single();

      if (user?.company_id !== session.companyId) {
        return NextResponse.json(
          { error: 'Cannot update users from other companies' },
          { status: 403 },
        );
      }
    }

    const { error } = await supabaseAdmin
      .from('users_v2')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      console.error('[USER STATUS API] Error:', error);
      return NextResponse.json({ error: 'Error updating user status' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: status === 'suspended' ? 'Usuário suspenso' : 'Usuário ativado',
    });
  } catch (error: any) {
    console.error('[USER STATUS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/users/status
 * Approve or reject pending user (for master admin use)
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, action, companyId } = body;

    if (!userId || !action) {
      return NextResponse.json({ error: 'userId and action are required' }, { status: 400 });
    }

    if (action === 'approve') {
      if (!companyId) {
        return NextResponse.json({ error: 'companyId is required for approval' }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from('users_v2')
        .update({
          status: 'active',
          company_id: companyId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        console.error('[USER STATUS API] Approve error:', error);
        return NextResponse.json({ error: 'Error approving user' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Usuário aprovado' });
    }

    if (action === 'reject') {
      const { error } = await supabaseAdmin
        .from('users_v2')
        .update({
          status: 'suspended',
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        console.error('[USER STATUS API] Reject error:', error);
        return NextResponse.json({ error: 'Error rejecting user' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Usuário rejeitado' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[USER STATUS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
