import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, insertOne, query } from '@/lib/db';
import { getIronSession } from 'iron-session';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

async function getMasterAdminSession(request: NextRequest): Promise<AdminSessionData | null> {
    try {
        const res = new Response();
        const session = await getIronSession<AdminSessionData>(request, res, adminSessionOptions);
        if (!session.adminId) return null;
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;

        // Verify it's a master admin (exists in admin_users table)
        const admin = await queryOne(
            'SELECT id FROM admin_users WHERE id = $1',
            [session.adminId]
        );

        if (!admin) return null;
        return session;
    } catch {
        return null;
    }
}

// GET - List all legal documents (Master Admin only)
export async function GET(request: NextRequest) {
    const session = await getMasterAdminSession(request);
    if (!session) {
        return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    try {
        const data = await queryAll(
            'SELECT * FROM legal_documents ORDER BY type ASC, created_at DESC'
        );

        return NextResponse.json({ documents: data });
    } catch (error) {
        console.error('[LEGAL DOCS] Unexpected error:', error);
        return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
    }
}

// POST - Create a new legal document (Master Admin only)
export async function POST(request: NextRequest) {
    const session = await getMasterAdminSession(request);
    if (!session) {
        return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { type, title, content, version, is_active } = body;

        if (!type || !title || !content || !version) {
            return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
        }

        if (!['terms_of_use', 'privacy_policy'].includes(type)) {
            return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
        }

        // If activating this document, deactivate others of the same type
        if (is_active) {
            await query(
                'UPDATE legal_documents SET is_active = false WHERE type = $1 AND is_active = true',
                [type]
            );
        }

        try {
            const data = await insertOne('legal_documents', {
                type,
                title,
                content,
                version,
                is_active: is_active || false,
                created_by: session.adminId,
            });

            return NextResponse.json({ document: data }, { status: 201 });
        } catch (dbError: any) {
            console.error('[LEGAL DOCS] Error creating:', dbError.message);
            return NextResponse.json({ error: 'Erro ao criar documento' }, { status: 500 });
        }
    } catch (error) {
        console.error('[LEGAL DOCS] Unexpected error:', error);
        return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
    }
}
