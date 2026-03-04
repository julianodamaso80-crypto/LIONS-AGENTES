import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { loginUser } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { logSystemAction, getClientInfo } from '@/lib/logger';
import { sessionOptions, SessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { ipAddress, userAgent } = getClientInfo(request);

  try {
    const body = await request.json();

    const { email, password, rememberMe } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email e senha são obrigatórios' }, { status: 400 });
    }

    const { user, company, error } = await loginUser(email, password);

    if (error || !user) {
      console.error('[LOGIN API] Login failed:', error);

      await logSystemAction({
        actionType: 'LOGIN_FAILED',
        details: { email, error },
        ipAddress,
        userAgent,
        status: 'error',
        errorMessage: error || 'Falha no login',
      });

      return NextResponse.json(
        {
          error: error || 'Erro ao fazer login',
          debug: `Login failed`, // SANITIZED INFO
        },
        { status: 401 },
      );
    }

    // console.log('[LOGIN API] Login successful for:', email);

    // Criar dados da sessão
    const sessionData = createSession(user, rememberMe || false, company);

    await logSystemAction({
      userId: user.id,
      companyId: user.company_id || undefined,
      actionType: 'LOGIN_SUCCESS',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        email: user.email,
        rememberMe,
        companyName: company?.company_name,
      },
      ipAddress,
      userAgent,
      sessionId: sessionData.userId,
      status: 'success',
    });

    // Configurar maxAge baseado em rememberMe
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
    const sessionOpts = {
      ...sessionOptions,
      cookieOptions: {
        ...sessionOptions.cookieOptions,
        maxAge,
      },
    };

    // Salvar sessão criptografada com iron-session
    const cookieStore = await cookies();
    const ironSession = await getIronSession<SessionData>(cookieStore, sessionOpts);

    // Popular a sessão criptografada
    ironSession.userId = sessionData.userId;
    ironSession.email = sessionData.email;
    ironSession.firstName = sessionData.firstName;
    ironSession.lastName = sessionData.lastName;
    ironSession.planId = sessionData.planId;
    ironSession.status = sessionData.status;
    ironSession.companyId = sessionData.companyId;
    ironSession.companyStatus = sessionData.companyStatus;
    ironSession.expiresAt = sessionData.expiresAt;

    await ironSession.save();

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          planId: user.plan_id,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('Login API error:', error);

    await logSystemAction({
      actionType: 'ERROR_OCCURRED',
      details: { error: String(error), endpoint: '/api/auth/login' },
      ipAddress,
      userAgent,
      status: 'error',
      errorMessage: 'Erro interno do servidor',
    });

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
