import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Service Role Client (bypassa RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

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
    const { data: existing } = await supabaseAdmin
      .from('leads')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      // Atualiza last_seen e nome (se o novo for mais completo)
      await supabaseAdmin
        .from('leads')
        .update({
          last_seen_at: new Date().toISOString(),
          name: name || existing.name,
        })
        .eq('id', existing.id);

      return NextResponse.json({
        leadId: existing.id,
        isNew: false,
        name: existing.name || name,
      });
    }

    // 2. Cria novo lead
    const { data: newLead, error } = await supabaseAdmin
      .from('leads')
      .insert({
        company_id: companyId,
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        last_seen_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[LEADS API] Insert error:', error);
      throw error;
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
