import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Default settings
const DEFAULT_SETTINGS = {
  whatsapp_summarization_mode: 'sliding_window',
  whatsapp_sliding_window_size: 20,
  whatsapp_message_threshold: 30,
  web_summarization_mode: 'session_end',
  web_message_threshold: 20,
  extract_user_profile: true,
  extract_session_summary: true,
};

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * GET /api/admin/memory/settings?agentId={id}
 * Busca configurações de memória do agente
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');
    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // Buscar configuração existente por agent_id
    const { data, error } = await supabaseAdmin
      .from('memory_settings')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    // Se não existir, criar default para o agente
    if (error || !data) {
      const { data: newData, error: insertError } = await supabaseAdmin
        .from('memory_settings')
        .insert({
          agent_id: agentId,
          ...DEFAULT_SETTINGS,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[Memory Settings] Error creating default:', insertError);
        return NextResponse.json({ error: 'Failed to create default settings' }, { status: 500 });
      }

      return NextResponse.json(newData);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Memory Settings] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/memory/settings
 * Atualiza configurações de memória do agente
 */
export async function PUT(request: NextRequest) {
  try {
    // Auth check
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');
    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      agentId,
      whatsapp_summarization_mode,
      whatsapp_sliding_window_size,
      whatsapp_message_threshold,
      web_summarization_mode,
      web_message_threshold,
      extract_user_profile,
      extract_session_summary,
    } = body;

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // Upsert (insert or update) por agent_id
    const { data, error } = await supabaseAdmin
      .from('memory_settings')
      .upsert(
        {
          agent_id: agentId,
          whatsapp_summarization_mode,
          whatsapp_sliding_window_size,
          whatsapp_message_threshold,
          web_summarization_mode,
          web_message_threshold,
          extract_user_profile,
          extract_session_summary,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'agent_id',
        },
      )
      .select()
      .single();

    if (error) {
      console.error('[Memory Settings] PUT error:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Memory Settings] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
