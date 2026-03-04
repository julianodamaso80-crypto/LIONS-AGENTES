import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryOne, insertOne, query } from '@/lib/db';

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
    const data = await queryOne(
      'SELECT * FROM memory_settings WHERE agent_id = $1',
      [agentId],
    );

    // Se não existir, criar default para o agente
    if (!data) {
      const newData = await insertOne('memory_settings', {
        agent_id: agentId,
        ...DEFAULT_SETTINGS,
      });

      if (!newData) {
        console.error('[Memory Settings] Error creating default settings');
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
    const result = await query(
      `INSERT INTO memory_settings (
        agent_id, whatsapp_summarization_mode, whatsapp_sliding_window_size,
        whatsapp_message_threshold, web_summarization_mode, web_message_threshold,
        extract_user_profile, extract_session_summary, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (agent_id) DO UPDATE SET
        whatsapp_summarization_mode = EXCLUDED.whatsapp_summarization_mode,
        whatsapp_sliding_window_size = EXCLUDED.whatsapp_sliding_window_size,
        whatsapp_message_threshold = EXCLUDED.whatsapp_message_threshold,
        web_summarization_mode = EXCLUDED.web_summarization_mode,
        web_message_threshold = EXCLUDED.web_message_threshold,
        extract_user_profile = EXCLUDED.extract_user_profile,
        extract_session_summary = EXCLUDED.extract_session_summary,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        agentId,
        whatsapp_summarization_mode,
        whatsapp_sliding_window_size,
        whatsapp_message_threshold,
        web_summarization_mode,
        web_message_threshold,
        extract_user_profile,
        extract_session_summary,
        new Date().toISOString(),
      ],
    );

    const data = result.rows[0] || null;

    if (!data) {
      console.error('[Memory Settings] PUT error: no row returned');
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Memory Settings] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
