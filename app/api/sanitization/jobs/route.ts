/**
 * Sanitization Proxy - List Jobs
 *
 * GET /api/sanitization/jobs?company_id=xxx
 * Validates iron-session, then fetches jobs from Python backend.
 */
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

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

async function resolveCompanyId(frontendCompanyId?: string | null): Promise<string | null> {
    try {
        const cookieStore = await cookies();

        const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
        if (adminSession.adminId) {
            if (adminSession.role === 'master_admin') {
                if (frontendCompanyId) return frontendCompanyId;
                if (adminSession.companyId) return adminSession.companyId;
                return null;
            }
            if (adminSession.companyId) return adminSession.companyId;
            const data = await queryOne<{ company_id: string }>(
                'SELECT company_id FROM users_v2 WHERE id = $1',
                [adminSession.adminId],
            );
            if (data?.company_id) return data.company_id;
        }

        const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
        if (userSession.userId) {
            if (userSession.companyId) return userSession.companyId;
            const data = await queryOne<{ company_id: string }>(
                'SELECT company_id FROM users_v2 WHERE id = $1',
                [userSession.userId],
            );
            if (data?.company_id) return data.company_id;
        }

        return null;
    } catch (error) {
        console.error('[Sanitization Jobs] Error resolving company_id:', error);
        return null;
    }
}

export async function GET(request: NextRequest) {
    try {
        const frontendCompanyId = request.nextUrl.searchParams.get('company_id');
        const companyId = await resolveCompanyId(frontendCompanyId);

        if (!companyId) {
            return NextResponse.json(
                { detail: 'Authentication required. Please log in.' },
                { status: 401 },
            );
        }

        const response = await fetch(
            `${BACKEND_URL}/api/sanitization/jobs?company_id=${companyId}`,
        );

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[Sanitization Jobs API] Error:', error);
        return NextResponse.json(
            { detail: error.message || 'Erro interno' },
            { status: 500 },
        );
    }
}
