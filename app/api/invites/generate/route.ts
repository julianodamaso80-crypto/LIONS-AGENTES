import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll, insertOne, query } from '@/lib/db';
import { randomBytes } from 'crypto';
import { sendInviteEmail } from '@/lib/email';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

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

    // VALIDATION: Check if email already exists in users_v2 table
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await queryOne(
      'SELECT id, email FROM users_v2 WHERE email = $1',
      [normalizedEmail],
    );

    if (existingUser) {
      return NextResponse.json(
        { error: 'Este e-mail já está cadastrado no sistema' },
        { status: 409 },
      );
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
      const company = await queryOne(
        'SELECT company_name, max_users FROM companies WHERE id = $1',
        [finalCompanyId],
      );

      companyName = company?.company_name || 'Empresa';
      const maxAdmins = company?.max_users || 5;

      // VALIDATION: Check admin limit for admin_company invites
      if (inviteRole === 'admin_company') {
        const countResult = await queryOne(
          `SELECT COUNT(*)::int as count FROM users_v2
           WHERE company_id = $1
             AND role = ANY($2::text[])
             AND status != 'suspended'`,
          [finalCompanyId, ['admin_company', 'owner', 'admin']],
        );

        const adminCount = countResult?.count || 0;

        if (adminCount >= maxAdmins) {
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
      const user = await queryOne(
        `SELECT u.id, u.company_id, u.role, u.is_owner, c.company_name
         FROM users_v2 u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1`,
        [userId],
      );

      if (!user) {
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
      companyName = user.company_name || 'Empresa';

      // VALIDATION 3: Check admin limit for admin_company invites
      if (inviteRole === 'admin_company') {
        const companyData = await queryOne(
          'SELECT max_users FROM companies WHERE id = $1',
          [finalCompanyId],
        );

        const maxAdmins = companyData?.max_users || 5;

        const countResult = await queryOne(
          `SELECT COUNT(*)::int as count FROM users_v2
           WHERE company_id = $1
             AND role = ANY($2::text[])
             AND status != 'suspended'`,
          [finalCompanyId, ['admin_company', 'owner', 'admin']],
        );

        const adminCount = countResult?.count || 0;

        if (adminCount >= maxAdmins) {
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
    console.log('[INVITE GENERATE] Owner flag debug:', {
      isOwner_received: isOwner,
      inviteRole,
      finalRole,
      calculatedIsOwner,
      willSaveAsOwner: calculatedIsOwner,
    });

    // Insert invite with email, name, and owner flag
    const invite = await insertOne('invites', {
      company_id: finalCompanyId,
      token,
      role: finalRole,
      is_owner_invite: calculatedIsOwner,
      email: email.toLowerCase().trim(),
      name: name || null,
      created_by: isMasterAdmin ? null : null,
      max_uses: maxUses,
      current_uses: 0,
      expires_at: expiresAt.toISOString(),
    });

    if (!invite) {
      console.error('[INVITE GENERATE] Error: insert returned null');
      return NextResponse.json({ error: 'Failed to generate invite' }, { status: 500 });
    }

    console.log('[INVITE GENERATE] Invite saved with is_owner_invite:', invite.is_owner_invite);

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
