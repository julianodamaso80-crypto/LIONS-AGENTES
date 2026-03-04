import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll, insertOne, updateOne } from '@/lib/db';
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

    // Get user's company
    const userData = await queryOne<{ company_id: string }>(
      'SELECT company_id FROM users_v2 WHERE id = $1',
      [userId],
    );

    if (!userData?.company_id) {
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
 * Helper: Validate that agent belongs to user's company (only for non-master admins)
 */
async function validateAgentOwnership(
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

  const agent = await queryOne<{ id: string; company_id: string }>(
    'SELECT id, company_id FROM agents WHERE id = $1',
    [agentId],
  );

  if (!agent) {
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
    const data = await queryAll(
      'SELECT * FROM agent_http_tools WHERE agent_id = $1 AND is_active = true ORDER BY created_at DESC',
      [agentId],
    );

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
    const data = await insertOne('agent_http_tools', {
      ...insertData,
      agent_id,
      is_active: true,
    });

    if (!data) {
      console.error('[AGENTS/TOOLS API] Error creating tool');
      return NextResponse.json({ error: 'Erro ao criar tool' }, { status: 500 });
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
    const existingTool = await queryOne<{ agent_id: string }>(
      'SELECT agent_id FROM agent_http_tools WHERE id = $1',
      [id],
    );

    if (!existingTool) {
      return NextResponse.json({ error: 'Tool não encontrada' }, { status: 404 });
    }

    const ownership = await validateAgentOwnership(
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

    const data = await queryOne(
      (() => {
        const keys = Object.keys(updates);
        const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        return `UPDATE agent_http_tools SET ${setClauses} WHERE id = $${keys.length + 1} RETURNING *`;
      })(),
      [...Object.values(updates), id],
    );

    if (!data) {
      console.error('[AGENTS/TOOLS API] Error updating tool');
      return NextResponse.json({ error: 'Erro ao atualizar tool' }, { status: 500 });
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
    const existingTool = await queryOne<{ agent_id: string }>(
      'SELECT agent_id FROM agent_http_tools WHERE id = $1',
      [id],
    );

    if (!existingTool) {
      return NextResponse.json({ error: 'Tool não encontrada' }, { status: 404 });
    }

    const ownership = await validateAgentOwnership(
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
    await updateOne(
      'agent_http_tools',
      {
        is_active: false,
        updated_at: new Date().toISOString(),
      },
      { id },
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[AGENTS/TOOLS API] Error in DELETE:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
