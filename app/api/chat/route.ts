import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat
 *
 * Proxy simples para o backend Python (/chat).
 * Usado pelo Widget embeddable que espera resposta JSON completa.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Usa a variável de ambiente do Backend
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    // Repassa para o endpoint /chat (não stream) do Python
    const response = await fetch(`${backendUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // Se o backend der erro (4xx ou 5xx), repassa o erro para o frontend
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || 'Erro no processamento da IA' },
        { status: response.status },
      );
    }

    // Retorna o JSON completo da resposta (ChatResponse)
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ [API CHAT] Erro no proxy:', error);
    return NextResponse.json(
      { error: 'Falha interna ao conectar com o serviço de IA' },
      { status: 500 },
    );
  }
}
