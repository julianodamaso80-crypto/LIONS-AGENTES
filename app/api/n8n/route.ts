import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
import { logSystemAction, getClientInfo } from '@/lib/logger';
import { sessionOptions, SessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function POST(request: NextRequest) {
  console.log('[N8N API] ========== REQUISIÇÃO RECEBIDA ==========');
  const { ipAddress, userAgent } = getClientInfo(request);

  try {
    // Ler sessão do cookie criptografado
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

    const body = await request.json();
    // console.log('[N8N API] Body recebido (chaves):', Object.keys(body));

    // DEFINIÇÃO ROBUSTA DA COMPANY ID
    // Prioridade: 1. Body (Frontend explícito) -> 2. Session (Cookie)
    const targetCompanyId = body.companyId || session.companyId;

    if (!targetCompanyId) {
      console.error('[N8N API] CRÍTICO: Company ID não identificado (nem body, nem session)');
      return NextResponse.json({ error: 'Identificação da empresa ausente.' }, { status: 400 });
    }

    console.log('[N8N API] Usando Company ID:', targetCompanyId);

    // Buscar informações da company
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('webhook_url, use_langchain')
      .eq('id', targetCompanyId)
      .maybeSingle();

    if (!company) {
      console.error(`[N8N API] Company ${targetCompanyId} não encontrada no banco.`);
      return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 });
    }

    const useLangChain = company.use_langchain || false;

    let targetUrl: string;
    let targetType: string;

    if (useLangChain) {
      targetUrl = process.env.NEXT_PUBLIC_LANGCHAIN_API_URL || 'http://localhost:8000/chat';
      targetType = 'LangChain (FastAPI)';
    } else {
      const webhookUrl = company.webhook_url;
      if (!webhookUrl) {
        return NextResponse.json({ error: 'Webhook não configurado' }, { status: 400 });
      }
      targetUrl = webhookUrl;
      targetType = 'N8N Webhook';
    }

    console.log(`[N8N API] Roteando para: ${targetType} (${targetUrl})`);

    // Payload final para o Backend/N8N
    const enrichedBody = {
      ...body,
      companyId: targetCompanyId, // Garante que o backend receba
      userId: body.userId || session.userId, // Garante user ID
    };

    const apiResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enrichedBody),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`[N8N API] Erro no destino (${apiResponse.status}):`, errorText);
      return NextResponse.json(
        { error: 'Upstream Error', details: errorText },
        { status: apiResponse.status },
      );
    }

    const responseData = await apiResponse.json();
    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[N8N API] Erro fatal:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: String(error) },
      { status: 500 },
    );
  }
}
