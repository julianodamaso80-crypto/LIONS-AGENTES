import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, updateOne } from '@/lib/db';
import {
    sessionOptions,
    adminSessionOptions,
    SessionData,
    AdminSessionData,
} from '@/lib/iron-session';

/**
 * POST /api/user/accept-terms
 *
 * Updates the user's accepted_terms_version and terms_accepted_at
 * Requires authenticated session (user or company admin)
 */
export async function POST(request: NextRequest) {
    try {
        const cookieStore = await cookies();

        // Get user ID from session
        let userId: string | null = null;

        const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
        if (userSession.userId) {
            userId = userSession.userId;
        } else {
            const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
            if (adminSession.adminId) {
                userId = adminSession.adminId;
            }
        }

        if (!userId) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
        }

        const body = await request.json();
        const { documentId } = body;

        if (!documentId) {
            return NextResponse.json({ error: 'documentId é obrigatório' }, { status: 400 });
        }

        // Verify this is the active terms_of_use document
        const activeDoc = await queryOne(
            `SELECT id FROM legal_documents WHERE id = $1 AND type = 'terms_of_use' AND is_active = true`,
            [documentId],
        );

        if (!activeDoc) {
            return NextResponse.json({ error: 'Documento inválido ou não ativo' }, { status: 400 });
        }

        // Update user's accepted terms version
        try {
            await updateOne(
                'users_v2',
                {
                    accepted_terms_version: documentId,
                    terms_accepted_at: new Date().toISOString(),
                },
                { id: userId },
            );
        } catch (updateError: any) {
            console.error('[ACCEPT TERMS] Error updating:', updateError.message);
            return NextResponse.json({ error: 'Erro ao atualizar aceite' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[ACCEPT TERMS] Unexpected error:', error);
        return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
    }
}
