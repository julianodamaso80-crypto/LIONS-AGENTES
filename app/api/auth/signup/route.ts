import { NextRequest, NextResponse } from 'next/server';
import { queryOne, updateOne } from '@/lib/db';
import { createUser, SignupData } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { logSystemAction, getClientInfo } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const { ipAddress, userAgent } = getClientInfo(request);

  try {
    const body = await request.json();

    const inviteToken = body.inviteToken;
    let inviteData: any = null;

    // Se tem invite token, validar
    if (inviteToken) {

      const invite = await queryOne(
        'SELECT id, company_id, role, is_owner_invite, email, name, max_uses, current_uses, expires_at FROM invites WHERE token = $1',
        [inviteToken],
      );

      if (!invite) {
        return NextResponse.json({ error: 'Token de convite inválido' }, { status: 404 });
      }



      // Verificar expiração
      const expiresAt = new Date(invite.expires_at);
      if (expiresAt < new Date()) {
        return NextResponse.json({ error: 'Token de convite expirado' }, { status: 410 });
      }

      // Verificar usos
      if (invite.current_uses >= invite.max_uses) {
        return NextResponse.json({ error: 'Token de convite já foi utilizado' }, { status: 451 });
      }

      // Verificar email nominal (se especificado)
      if (invite.email) {
        const inviteEmail = invite.email.toLowerCase().trim();
        const userEmail = body.email.toLowerCase().trim();

        if (inviteEmail !== userEmail) {
          return NextResponse.json(
            { error: 'Este convite é exclusivo para outro email' },
            { status: 403 },
          );
        }
      }

      inviteData = invite;
    }

    // Prepare signup data
    // If invite exists:
    // - Use invite's role (admin_company or member)
    // - Extract is_owner_invite flag
    // - ALL users start as 'pending' (require approval)
    const signupData: SignupData = {
      firstName: body.firstName,
      lastName: body.lastName,
      cpf: body.cpf,
      phone: body.phone,
      email: body.email,
      birthDate: body.birthDate,
      password: body.password,
      termsAccepted: body.termsAccepted,
      acceptedTermsVersion: body.acceptedTermsVersion || null,
      companyId: inviteData?.company_id,
      status: 'active', // Usuários aprovados automaticamente
      role: inviteData?.role || undefined,
      isOwner: inviteData?.is_owner_invite || false, // ✅ NEW: Extract owner flag
    };


    if (!signupData.termsAccepted) {
      return NextResponse.json(
        { error: 'Você deve aceitar os termos e condições' },
        { status: 400 },
      );
    }

    if (
      !signupData.firstName ||
      !signupData.lastName ||
      !signupData.cpf ||
      !signupData.phone ||
      !signupData.email ||
      !signupData.birthDate ||
      !signupData.password
    ) {
      return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
    }

    if (signupData.password.length < 8) {
      return NextResponse.json(
        { error: 'A senha deve ter no mínimo 8 caracteres' },
        { status: 400 },
      );
    }

    const { user, error } = await createUser(signupData);

    if (error || !user) {

      await logSystemAction({
        actionType: 'SIGNUP',
        details: { email: signupData.email, error },
        ipAddress,
        userAgent,
        status: 'error',
        errorMessage: error || 'Erro ao criar usuário',
      });

      return NextResponse.json(
        { error: error || 'Erro ao criar usuário', debug: error },
        { status: 400 },
      );
    }

    const session = createSession(user, false);

    // Se usou invite, incrementar contador
    if (inviteData) {
      await updateOne('invites', { current_uses: inviteData.current_uses + 1 }, { id: inviteData.id });
    }

    await logSystemAction({
      userId: user.id,
      companyId: user.company_id || undefined,
      actionType: 'SIGNUP',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        viaInvite: !!inviteData,
      },
      ipAddress,
      userAgent,
      sessionId: session.userId,
      status: 'success',
    });

    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
        },
        session,
      },
      { status: 201 },
    );

    response.cookies.set('smith_user_session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Signup API error:', error);

    await logSystemAction({
      actionType: 'ERROR_OCCURRED',
      details: { error: String(error), endpoint: '/api/auth/signup' },
      ipAddress,
      userAgent,
      status: 'error',
      errorMessage: 'Erro interno do servidor',
    });

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
