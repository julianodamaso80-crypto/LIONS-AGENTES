/**
 * Sanitization Proxy - Upload
 *
 * POST /api/sanitization/upload
 * Validates iron-session, then forwards multipart upload to Python backend.
 *
 * Auth logic:
 * - Master admin: uses company_id from frontend (manages multiple companies)
 * - Company admin: forces company_id from session (security)
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
import { createClient } from '@supabase/supabase-js';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
);

/**
 * Resolves company_id based on session + optional frontend param.
 * - Master admin: trusts frontendCompanyId (they manage multiple companies)
 * - Company admin: returns their own company_id (ignores frontend param)
 * - User session: returns their own company_id
 * Returns null if not authenticated.
 */
async function resolveCompanyId(frontendCompanyId?: string | null): Promise<string | null> {
    try {
        const cookieStore = await cookies();

        // 1. Check admin session
        const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

        if (adminSession.adminId) {
            if (adminSession.role === 'master_admin') {
                // Master admin: use frontendCompanyId (they manage multiple companies)
                if (frontendCompanyId) return frontendCompanyId;
                // Fallback: try their own company
                if (adminSession.companyId) return adminSession.companyId;
                return null;
            }

            // Company admin: use their own company_id (security)
            if (adminSession.companyId) return adminSession.companyId;

            // Lookup from DB
            const { data } = await supabaseAdmin
                .from('users_v2')
                .select('company_id')
                .eq('id', adminSession.adminId)
                .single();

            if (data?.company_id) return data.company_id;
        }

        // 2. Check user session
        const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
        if (userSession.userId) {
            if (userSession.companyId) return userSession.companyId;

            const { data } = await supabaseAdmin
                .from('users_v2')
                .select('company_id')
                .eq('id', userSession.userId)
                .single();

            if (data?.company_id) return data.company_id;
        }

        return null;
    } catch (error) {
        console.error('[Sanitization Upload] Error resolving company_id:', error);
        return null;
    }
}

export async function POST(request: NextRequest) {
    try {
        const incomingFormData = await request.formData();

        // Extract company_id from form data (sent by frontend for master admin)
        const frontendCompanyId = incomingFormData.get('company_id') as string | null;

        const companyId = await resolveCompanyId(frontendCompanyId);

        if (!companyId) {
            return NextResponse.json(
                { detail: 'Authentication required. Please log in.' },
                { status: 401 },
            );
        }

        // Build new form data with resolved company_id
        const newFormData = new FormData();

        incomingFormData.forEach((value, key) => {
            if (key !== 'company_id') {
                newFormData.append(key, value);
            }
        });

        // Inject the resolved company_id (trusted)
        newFormData.append('company_id', companyId);

        const response = await fetch(`${BACKEND_URL}/api/sanitization/upload`, {
            method: 'POST',
            body: newFormData,
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[Sanitization Upload API] Error:', error);
        return NextResponse.json(
            { detail: error.message || 'Erro interno' },
            { status: 500 },
        );
    }
}
