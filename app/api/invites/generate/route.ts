import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { sendInviteEmail } from '@/lib/email';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * POST /api/invites/generate
 *
 * Generate a new invite token and send email
 * Master Admin: Can set any role and any companyId
 * Company Admin: Can set role but companyId is forced to their company
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const body = await request.json();
    const { role: inviteRole, companyId: requestedCompanyId, email, name, isOwner } = body;

    // Validate role
    if (inviteRole && !['admin_company', 'member'].includes(inviteRole)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be admin_company or member' },
        { status: 400 },
      );
    }

    // Email is required for nominal invites
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email is required for nominal invites' },
        { status: 400 },
      );
    }

    // ✅ VALIDATION: Check if email already exists in users_v2 table
    const normalizedEmail = email.toLowerCase().trim();

    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from('users_v2')
      .select('id, email')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json(
        { error: 'Este e-mail já está cadastrado no sistema' },
        { status: 409 },
      );
    }

    if (existingUserError && existingUserError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is what we want
      console.error('[INVITE GENERATE] Error checking existing email:', existingUserError);
    }

    // Check for master admin session
    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    let finalCompanyId: string;
    let finalRole: string = inviteRole || 'member';
    let isMasterAdmin = false;
    let companyName = '';

    if (adminSession.adminId) {
      // Master Admin can set any company and any role
      isMasterAdmin = true;

      if (!requestedCompanyId) {
        return NextResponse.json({ error: 'Master admin must specify companyId' }, { status: 400 });
      }

      finalCompanyId = requestedCompanyId;

      // Get company info including max_users for limit validation
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('company_name, max_users')
        .eq('id', finalCompanyId)
        .single();

      companyName = company?.company_name || 'Empresa';
      const maxAdmins = company?.max_users || 5;

      // VALIDATION: Check admin limit for admin_company invites
      if (inviteRole === 'admin_company') {
        const { count: adminCount } = await supabaseAdmin
          .from('users_v2')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', finalCompanyId)
          .in('role', ['admin_company', 'owner', 'admin'])
          .neq('status', 'suspended');

        if ((adminCount || 0) >= maxAdmins) {
          return NextResponse.json(
            { error: `Limite de ${maxAdmins} administradores atingido para esta empresa` },
            { status: 403 },
          );
        }
      }

      // VALIDATION: Only Master can create Owner
      if (isOwner && inviteRole === 'admin_company') {
        // console.log('[INVITE GENERATE] Master creating Admin Company Owner');
      } else if (isOwner && inviteRole === 'member') {
        return NextResponse.json({ error: 'Members cannot be owners' }, { status: 400 });
      }

      console.log('[INVITE GENERATE] Master admin generating nominal invite:', {
        companyId: finalCompanyId,
        role: finalRole,
        isOwner: isOwner || false,
        email,
      });
    } else {
      // Company Admin - verify session and force their company
      const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);

      if (!userSession.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const userId = userSession.userId;

      // Get user and company info with is_owner
      const { data: user, error: userError } = await supabaseAdmin
        .from('users_v2')
        .select('id, company_id, role, is_owner, companies:company_id(company_name)')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Check if user is admin_company
      if (user.role !== 'admin_company') {
        return NextResponse.json(
          { error: 'Only company admins can generate invites' },
          { status: 403 },
        );
      }

      // VALIDATION 1: Only Owner can create Admin Company
      if (inviteRole === 'admin_company' && !user.is_owner) {
        return NextResponse.json(
          { error: 'Apenas Admin Company Owner pode convidar outros administradores' },
          { status: 403 },
        );
      }

      // VALIDATION 2: Company Admin cannot create Owner (only Master can)
      if (isOwner) {
        return NextResponse.json(
          { error: 'Apenas Master Admin pode criar Admin Company Owner' },
          { status: 403 },
        );
      }

      // Force company to user's company
      finalCompanyId = user.company_id;
      companyName = (user.companies as any)?.company_name || 'Empresa';

      // VALIDATION 3: Check admin limit for admin_company invites
      if (inviteRole === 'admin_company') {
        const { data: companyData } = await supabaseAdmin
          .from('companies')
          .select('max_users')
          .eq('id', finalCompanyId)
          .single();

        const maxAdmins = companyData?.max_users || 5;

        const { count: adminCount } = await supabaseAdmin
          .from('users_v2')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', finalCompanyId)
          .in('role', ['admin_company', 'owner', 'admin'])
          .neq('status', 'suspended');

        if ((adminCount || 0) >= maxAdmins) {
          return NextResponse.json(
            { error: `Limite de ${maxAdmins} administradores atingido para esta empresa` },
            { status: 403 },
          );
        }
      }

      console.log('[INVITE GENERATE] Company admin generating nominal invite:', {
        companyId: finalCompanyId,
        role: finalRole,
        isOwner: false, // Company Admin can never create owners
        isAdminOwner: user.is_owner,
        email,
        userId,
      });
    }

    // Generate unique token
    const token = randomBytes(32).toString('hex');

    // Calculate expiration (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Nominal invites have max_uses = 1 (one person only)
    const maxUses = 1;

    // DEBUG: Log owner flag calculation
    const calculatedIsOwner = (isOwner && inviteRole === 'admin_company') || false;
    console.log('[INVITE GENERATE] 🔍 Owner flag debug:', {
      isOwner_received: isOwner,
      inviteRole,
      finalRole,
      calculatedIsOwner,
      willSaveAsOwner: calculatedIsOwner,
    });

    // Insert invite with email, name, and owner flag
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('invites')
      .insert({
        company_id: finalCompanyId,
        token,
        role: finalRole,
        is_owner_invite: calculatedIsOwner, // Use calculated value
        email: email.toLowerCase().trim(),
        name: name || null,
        created_by: isMasterAdmin ? null : null,
        max_uses: maxUses,
        current_uses: 0,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (inviteError || !invite) {
      console.error('[INVITE GENERATE] Error:', inviteError);
      return NextResponse.json({ error: 'Failed to generate invite' }, { status: 500 });
    }

    console.log('[INVITE GENERATE] ✅ Invite saved with is_owner_invite:', invite.is_owner_invite);

    // Build invite link
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const inviteLink = `${baseUrl}/register?token=${token}`;

    // Send email
    let emailWarning = null;
    const emailResult = await sendInviteEmail({
      to: email.toLowerCase().trim(),
      name: name || undefined,
      inviteLink,
      role: finalRole as 'admin_company' | 'member',
      companyName,
    });

    if (!emailResult.success) {
      console.error('[INVITE GENERATE] Email failed:', emailResult.error);
      emailWarning =
        'Convite criado, mas o email não pôde ser enviado. Compartilhe o link manualmente.';
    }

    return NextResponse.json({
      success: true,
      token,
      inviteLink,
      role: finalRole,
      email: email.toLowerCase().trim(),
      name: name || null,
      expiresAt: invite.expires_at,
      maxUses: invite.max_uses,
      emailSent: emailResult.success,
      warning: emailWarning,
    });
  } catch (error: any) {
    console.error('[INVITE GENERATE] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
