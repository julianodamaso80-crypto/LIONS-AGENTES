import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

// GET - Fetch active legal documents (PUBLIC - no auth required)
// Used by registration page to display terms content
// Query params: ?type=terms_of_use or ?type=privacy_policy
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');

        let data;
        if (type) {
            if (!['terms_of_use', 'privacy_policy'].includes(type)) {
                return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
            }
            data = await queryAll(
                'SELECT id, type, title, content, version, updated_at FROM legal_documents WHERE is_active = true AND type = $1',
                [type]
            );
        } else {
            data = await queryAll(
                'SELECT id, type, title, content, version, updated_at FROM legal_documents WHERE is_active = true'
            );
        }

        // If requesting a specific type, return single document
        if (type) {
            return NextResponse.json({ document: data?.[0] || null });
        }

        // Otherwise return all active documents
        return NextResponse.json({ documents: data });
    } catch (error) {
        console.error('[LEGAL DOCS PUBLIC] Unexpected error:', error);
        return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
    }
}
