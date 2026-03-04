import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { loginAdmin } from '@/lib/auth';
import { logSystemAction, getClientInfo } from '@/lib/logger';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { ipAddress, userAgent } = getClientInfo(request);

  try {
    const { email, password } = await request.json();

    console.log('[ADMIN LOGIN API] Request received:', { email, passwordLength: password?.length });

    if (!email || !password) {
      return NextResponse.json({ error: 'Email e senha são obrigatórios' }, { status: 400 });
    }

    const { admin, error } = await loginAdmin(email, password);

    console.log('[ADMIN LOGIN API] Login result:', { admin: admin ? 'found' : 'not found', error });

    if (error || !admin) {
      await logSystemAction({
        actionType: 'ADMIN_LOGIN',
        details: { email, error },
        ipAddress,
        userAgent,
        status: 'error',
        errorMessage: error || 'Falha no login do admin',
      });

      return NextResponse.json({ error: error || 'Erro ao fazer login' }, { status: 401 });
    }

    await logSystemAction({
      adminId: admin.id,
      actionType: 'ADMIN_LOGIN',
      resourceType: 'admin',
      resourceId: admin.id,
      details: {
        email: admin.email,
        name: admin.name,
      },
      ipAddress,
      userAgent,
      sessionId: admin.id,
      status: 'success',
    });

    // Configurar sessão criptografada com iron-session
    const maxAge = 8 * 60 * 60; // 8 horas
    const sessionOpts = {
      ...adminSessionOptions,
      cookieOptions: {
        ...adminSessionOptions.cookieOptions,
        maxAge,
      },
    };

    const cookieStore = await cookies();
    const session = await getIronSession<AdminSessionData>(cookieStore, sessionOpts);

    // Popular sessão criptografada
    session.adminId = admin.id;
    session.email = admin.email;
    session.name = admin.name;
    session.role = admin.role === 'company_admin' ? 'company_admin' : 'master_admin';
    session.companyId = admin.companyId || null;
    session.expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();

    await session.save();

    console.log('[ADMIN LOGIN API] Session saved with iron-session');

    return NextResponse.json(
      {
        success: true,
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          companyId: admin.companyId,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('Admin login error:', error);

    await logSystemAction({
      actionType: 'ERROR_OCCURRED',
      details: { error: String(error), endpoint: '/api/admin/login' },
      ipAddress,
      userAgent,
      status: 'error',
      errorMessage: 'Erro ao processar login',
    });

    return NextResponse.json({ error: 'Erro ao processar login' }, { status: 500 });
  }
}
