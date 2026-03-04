import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import {
  adminSessionOptions,
  AdminSessionData,
  sessionOptions,
  SessionData,
} from '@/lib/iron-session';
import { queryOne } from '@/lib/db';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function getCompanyIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId) {
      return adminSession.companyId;
    }

    if (adminSession.adminId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [adminSession.adminId],
      );

      if (data?.company_id) {
        return data.company_id;
      }
    }

    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    if (userSession.userId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [userSession.userId],
      );

      if (data?.company_id) {
        return data.company_id;
      }
    }

    return null;
  } catch (error) {
    console.error('[PreviewChange] Error getting company_id:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const companyId = await getCompanyIdFromSession();

    if (!companyId) {
      return NextResponse.json(
        { detail: 'Não autorizado. Faça login novamente.' },
        { status: 401 },
      );
    }

    const body = await request.json();

    const response = await fetch(
      `${BACKEND_URL}/api/billing/preview-change?company_id=${companyId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[PreviewChange API] Error:', error);
    return NextResponse.json({ detail: error.message || 'Erro interno' }, { status: 500 });
  }
}
