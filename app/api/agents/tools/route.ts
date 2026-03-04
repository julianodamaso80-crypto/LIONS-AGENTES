import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { createClient } from '@supabase/supabase-js';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * Helper: Get authenticated session
 * Returns different data based on session type:
 * - Master Admin (smith_admin_session): isMasterAdmin=true, no company restriction
 * - Company User (smith_user_session): isMasterAdmin=false, has companyId
 */
async function getAuthenticatedSession() {
  const cookieStore = await cookies();

  // Check for admin session FIRST (master admin)
  const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
  if (adminSession.adminId) {
    // Master admin - no company restriction
    return {
      isMasterAdmin: true,
      userId: adminSession.adminId,
      companyId: null, // Master can access all
    };
  }

  // Check for user session (company user/admin)
  const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (userSession.userId) {
    const userId = userSession.userId;

    // Create Service Role client to get user's company
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users_v2')
      .select('company_id')
      .eq('id', userId)
      .single();

    if (userError || !userData?.company_id) {
      return { error: 'Empresa não encontrada', status: 404 };
    }

    return {
      isMasterAdmin: false,
      userId,
      companyId: userData.company_id,
    };
  }

  return { error: 'Não autorizado', status: 401 };
}

/**
 * Helper: Create Supabase Admin client
 */
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Helper: Validate that agent belongs to user's company (only for non-master admins)
 */
async function validateAgentOwnership(
  supabaseAdmin: any,
  agentId: string,
  companyId: string | null,
  isMasterAdmin: boolean,
) {
  // Master admin can access any agent
  if (isMasterAdmin) {
    return { valid: true };
  }

  if (!companyId) {
    return { valid: false, error: 'Company ID não encontrado', status: 400 };
  }

  const { data: agent, error } = await supabaseAdmin
    .from('agents')
    .select('id, company_id')
    .eq('id', agentId)
    .single();

  if (error || !agent) {
    return { valid: false, error: 'Agente não encontrado', status: 404 };
  }

  if (agent.company_id !== companyId) {
    return { valid: false, error: 'Acesso negado a este agente', status: 403 };
  }

  return { valid: true };
}

/**
 * GET /api/agents/tools
 *
 * Lists HTTP tools for a specific agent.
 * Requires: smith_admin_session (master) or smith_user_session (company user)
 * Query params: agentId (required)
 */
export async function GET(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const auth = await getAuthenticatedSession();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { isMasterAdmin, companyId } = auth;
    const supabaseAdmin = getSupabaseAdmin();

    // =============================================
    // VALIDATE AGENT ID
    // =============================================
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID required' }, { status: 400 });
    }

    // =============================================
    // VALIDATE AGENT OWNERSHIP (non-master only)
    // =============================================
    const ownership = await validateAgentOwnership(
      supabaseAdmin,
      agentId,
      companyId,
      isMasterAdmin,
    );
    if (!ownership.valid) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    // =============================================
    // FETCH TOOLS
    // =============================================
    const { data, error } = await supabaseAdmin
      .from('agent_http_tools')
      .select('*')
      .eq('agent_id', agentId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[AGENTS/TOOLS API] Error fetching tools:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('[AGENTS/TOOLS API] Error in GET:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * POST /api/agents/tools
 *
 * Creates a new HTTP tool for an agent.
 * Requires: smith_admin_session (master) or smith_user_session (company user)
 * Body: { agent_id, name, description, ... }
 */
export async function POST(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const auth = await getAuthenticatedSession();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { isMasterAdmin, companyId } = auth;
    const supabaseAdmin = getSupabaseAdmin();

    // =============================================
    // PARSE BODY
    // =============================================
    const body = await request.json();
    const { id, agent_id, ...insertData } = body;

    if (!agent_id) {
      return NextResponse.json({ error: 'Agent ID required' }, { status: 400 });
    }

    // =============================================
    // VALIDATE AGENT OWNERSHIP
    // =============================================
    const ownership = await validateAgentOwnership(
      supabaseAdmin,
      agent_id,
      companyId,
      isMasterAdmin,
    );
    if (!ownership.valid) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    // =============================================
    // CREATE TOOL
    // =============================================
    const { data, error } = await supabaseAdmin
      .from('agent_http_tools')
      .insert({
        ...insertData,
        agent_id,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('[AGENTS/TOOLS API] Error creating tool:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[AGENTS/TOOLS API] Error in POST:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * PUT /api/agents/tools
 *
 * Updates an existing HTTP tool.
 * Requires: smith_admin_session (master) or smith_user_session (company user)
 * Body: { id, ... updates }
 */
export async function PUT(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const auth = await getAuthenticatedSession();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { isMasterAdmin, companyId } = auth;
    const supabaseAdmin = getSupabaseAdmin();

    // =============================================
    // PARSE BODY
    // =============================================
    const body = await request.json();
    const { id, agent_id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Tool ID required' }, { status: 400 });
    }

    // =============================================
    // GET TOOL AND VALIDATE OWNERSHIP
    // =============================================
    const { data: existingTool, error: toolError } = await supabaseAdmin
      .from('agent_http_tools')
      .select('agent_id')
      .eq('id', id)
      .single();

    if (toolError || !existingTool) {
      return NextResponse.json({ error: 'Tool não encontrada' }, { status: 404 });
    }

    const ownership = await validateAgentOwnership(
      supabaseAdmin,
      existingTool.agent_id,
      companyId,
      isMasterAdmin,
    );
    if (!ownership.valid) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    // =============================================
    // UPDATE TOOL
    // =============================================
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('agent_http_tools')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[AGENTS/TOOLS API] Error updating tool:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[AGENTS/TOOLS API] Error in PUT:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/tools
 *
 * Soft deletes a tool (sets is_active = false).
 * Requires: smith_admin_session (master) or smith_user_session (company user)
 * Query params: id (required)
 */
export async function DELETE(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const auth = await getAuthenticatedSession();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { isMasterAdmin, companyId } = auth;
    const supabaseAdmin = getSupabaseAdmin();

    // =============================================
    // VALIDATE TOOL ID
    // =============================================
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Tool ID required' }, { status: 400 });
    }

    // =============================================
    // GET TOOL AND VALIDATE OWNERSHIP
    // =============================================
    const { data: existingTool, error: toolError } = await supabaseAdmin
      .from('agent_http_tools')
      .select('agent_id')
      .eq('id', id)
      .single();

    if (toolError || !existingTool) {
      return NextResponse.json({ error: 'Tool não encontrada' }, { status: 404 });
    }

    const ownership = await validateAgentOwnership(
      supabaseAdmin,
      existingTool.agent_id,
      companyId,
      isMasterAdmin,
    );
    if (!ownership.valid) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    // =============================================
    // SOFT DELETE
    // =============================================
    const { error } = await supabaseAdmin
      .from('agent_http_tools')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('[AGENTS/TOOLS API] Error deleting tool:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[AGENTS/TOOLS API] Error in DELETE:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
