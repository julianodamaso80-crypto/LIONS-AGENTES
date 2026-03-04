/**
 * Sanitization Proxy - Download Sanitized File
 *
 * GET /api/sanitization/download/[jobId]?company_id=xxx
 * Validates iron-session, then streams the file from Python backend.
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
        console.error('[Sanitization Download] Error resolving company_id:', error);
        return null;
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const { jobId } = await params;
        const frontendCompanyId = request.nextUrl.searchParams.get('company_id');
        const companyId = await resolveCompanyId(frontendCompanyId);

        if (!companyId) {
            return NextResponse.json(
                { detail: 'Authentication required. Please log in.' },
                { status: 401 },
            );
        }

        const response = await fetch(
            `${BACKEND_URL}/api/sanitization/download/${jobId}?company_id=${companyId}`,
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Erro ao baixar arquivo' }));
            return NextResponse.json(errorData, { status: response.status });
        }

        // Stream the binary response back to the client
        const contentDisposition = response.headers.get('Content-Disposition');
        const contentType = response.headers.get('Content-Type') || 'text/markdown';

        const headers: Record<string, string> = {
            'Content-Type': contentType,
        };

        if (contentDisposition) {
            headers['Content-Disposition'] = contentDisposition;
        }

        const blob = await response.blob();
        return new NextResponse(blob, {
            status: 200,
            headers,
        });
    } catch (error: any) {
        console.error('[Sanitization Download API] Error:', error);
        return NextResponse.json(
            { detail: error.message || 'Erro interno' },
            { status: 500 },
        );
    }
}
