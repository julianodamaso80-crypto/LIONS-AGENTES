import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, updateOne, deleteWhere } from '@/lib/db';
import { getIronSession } from 'iron-session';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

async function getMasterAdminSession(request: NextRequest): Promise<AdminSessionData | null> {
    try {
        const res = new Response();
        const session = await getIronSession<AdminSessionData>(request, res, adminSessionOptions);
        if (!session.adminId) return null;
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;

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

// PUT - Update a legal document
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getMasterAdminSession(request);
    if (!session) {
        return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    try {
        const { id } = await params;
        const body = await request.json();
        const { type, title, content, version, is_active } = body;

        if (!type || !title || !content || !version) {
            return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
        }

        // If activating this document, deactivate others of the same type
        if (is_active) {
            await query(
                'UPDATE legal_documents SET is_active = false WHERE type = $1 AND is_active = true AND id != $2',
                [type, id]
            );
        }

        try {
            const data = await updateOne('legal_documents', {
                type,
                title,
                content,
                version,
                is_active: is_active || false,
            }, { id });

            if (!data) {
                return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 });
            }

            return NextResponse.json({ document: data });
        } catch (dbError: any) {
            console.error('[LEGAL DOCS] Error updating:', dbError.message);
            return NextResponse.json({ error: 'Erro ao atualizar documento' }, { status: 500 });
        }
    } catch (error) {
        console.error('[LEGAL DOCS] Unexpected error:', error);
        return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
    }
}

// DELETE - Delete a legal document
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getMasterAdminSession(request);
    if (!session) {
        return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 });
    }

    try {
        const { id } = await params;

        try {
            await deleteWhere('legal_documents', { id });
        } catch (dbError: any) {
            console.error('[LEGAL DOCS] Error deleting:', dbError.message);
            return NextResponse.json({ error: 'Erro ao excluir documento' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[LEGAL DOCS] Unexpected error:', error);
        return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
    }
}
