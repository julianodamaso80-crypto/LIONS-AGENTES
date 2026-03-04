import { NextRequest, NextResponse } from 'next/server';

// Força a rota a ser dinâmica para suportar streaming
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Pega o corpo da requisição do frontend
    const body = await req.json();

    // 2. Define a URL do Backend (ajuste a porta se necessário, padrão 8000)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

    console.log(`🔌 [PROXY] Conectando ao backend: ${backendUrl}/chat/stream`);

    // 3. Faz a chamada ao Backend FastAPI
    const response = await fetch(`${backendUrl}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // @ts-ignore - 'duplex' é necessário para streaming em algumas versões do Node
      duplex: 'half',
    });

    if (!response.ok) {
      console.error(`❌ [PROXY] Erro no backend: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: `Backend error: ${response.statusText}` },
        { status: response.status },
      );
    }

    if (!response.body) {
      return NextResponse.json({ error: 'No response body' }, { status: 500 });
    }

    // console.log('✅ [PROXY] Stream iniciado com sucesso');

    // 4. Retorna a resposta como Stream para o cliente (Browser)
    return new NextResponse(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('❌ [PROXY] Erro fatal:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
