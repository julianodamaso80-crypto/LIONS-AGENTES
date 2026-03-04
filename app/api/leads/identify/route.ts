import { NextRequest, NextResponse } from 'next/server';
import { queryOne, insertOne, updateOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/leads/identify
 *
 * Identifica ou cria um lead baseado no e-mail.
 * Retorna UUID estável para carregar memória da IA.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, name, companyId } = await req.json();

    if (!email || !companyId) {
      return NextResponse.json({ error: 'Email e CompanyID são obrigatórios' }, { status: 400 });
    }

    // Validação básica de e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    }

    // 1. Tenta encontrar lead existente
    const existing = await queryOne<{ id: string; name: string | null }>(
      'SELECT id, name FROM leads WHERE company_id = $1 AND email = $2',
      [companyId, email.toLowerCase().trim()],
    );

    if (existing) {
      // Atualiza last_seen e nome (se o novo for mais completo)
      await updateOne(
        'leads',
        {
          last_seen_at: new Date().toISOString(),
          name: name || existing.name,
        },
        { id: existing.id },
      );

      return NextResponse.json({
        leadId: existing.id,
        isNew: false,
        name: existing.name || name,
      });
    }

    // 2. Cria novo lead
    const newLead = await insertOne('leads', {
      company_id: companyId,
      email: email.toLowerCase().trim(),
      name: name?.trim() || null,
      last_seen_at: new Date().toISOString(),
    });

    if (!newLead) {
      throw new Error('Failed to insert lead');
    }

    return NextResponse.json({
      leadId: newLead.id,
      isNew: true,
      name: name?.trim() || null,
    });
  } catch (error) {
    console.error('[LEADS API] Error identifying lead:', error);
    return NextResponse.json({ error: 'Falha ao processar identificação' }, { status: 500 });
  }
}
