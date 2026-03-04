import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll, insertOne, query, deleteWhere } from '@/lib/db';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * Helper to get company_id from session (user or admin)
 * Returns isMasterAdmin flag to allow bypass for master admins
 */
async function getCompanyIdFromSession(): Promise<{
  companyId: string | null;
  userId: string | null;
  isMasterAdmin: boolean;
}> {
  const cookieStore = await cookies();

  // Try admin session first
  const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
  if (adminSession.adminId) {
    // Check if master admin (role check or no companyId in session)
    const isMasterAdmin = adminSession.role === 'master_admin' || !adminSession.companyId;

    if (adminSession.companyId) {
      return {
        companyId: adminSession.companyId,
        userId: adminSession.adminId,
        isMasterAdmin: false,
      };
    }

    // Master admin without companyId - fetch from DB (if exists)
    const user = await queryOne(
      'SELECT company_id FROM users_v2 WHERE id = $1',
      [adminSession.adminId]
    );

    // Return with isMasterAdmin=true so we can bypass company checks
    return {
      companyId: user?.company_id || null,
      userId: adminSession.adminId,
      isMasterAdmin: true,
    };
  }

  // Try user session
  const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (userSession.userId && userSession.companyId) {
    return { companyId: userSession.companyId, userId: userSession.userId, isMasterAdmin: false };
  }

  // If user without companyId, fetch from database
  if (userSession.userId) {
    const user = await queryOne(
      'SELECT company_id FROM users_v2 WHERE id = $1',
      [userSession.userId]
    );
    return {
      companyId: user?.company_id || null,
      userId: userSession.userId,
      isMasterAdmin: false,
    };
  }

  return { companyId: null, userId: null, isMasterAdmin: false };
}

/**
 * GET /api/admin/integrations?agentId={id}
 * Fetch integration (WhatsApp) for a specific agent
 * SECURITY: Validates that agent belongs to user's company
 */
export async function GET(request: NextRequest) {
  try {
    // Get company_id from authenticated session
    const { companyId, userId, isMasterAdmin } = await getCompanyIdFromSession();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Master Admin can access any agent, regular users need companyId
    if (!isMasterAdmin && !companyId) {
      return NextResponse.json({ error: 'No company associated with user' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // SECURITY: First verify the agent exists (and belongs to user's company if not master admin)
    const agent = await queryOne(
      'SELECT id, company_id FROM agents WHERE id = $1',
      [agentId]
    );

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Only check company ownership for non-master admins
    if (!isMasterAdmin && agent.company_id !== companyId) {
      console.warn(
        `[INTEGRATIONS API] Unauthorized access attempt: user company ${companyId} tried to access agent of company ${agent.company_id}`,
      );
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Now safe to fetch integration
    try {
      const data = await queryAll(
        'SELECT * FROM integrations WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1',
        [agentId]
      );

      const integration = data && data.length > 0 ? data[0] : null;
      return NextResponse.json({ integration });
    } catch (dbError: any) {
      console.error('[INTEGRATIONS API] Error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[INTEGRATIONS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/integrations
 * Create or update integration (upsert)
 * SECURITY: Uses company_id from session, not from request body
 */
export async function POST(request: NextRequest) {
  try {
    // Get company_id from authenticated session
    const { companyId, userId, isMasterAdmin } = await getCompanyIdFromSession();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Master Admin can modify any agent, regular users need companyId
    if (!isMasterAdmin && !companyId) {
      return NextResponse.json({ error: 'No company associated with user' }, { status: 403 });
    }

    const body = await request.json();
    const {
      agent_id,
      provider,
      identifier,
      instance_id,
      token,
      client_token,
      base_url,
      is_active,
      buffer_enabled,
      buffer_debounce_seconds,
      buffer_max_wait_seconds,
    } = body;

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    // SECURITY: Verify the agent exists (and belongs to user's company if not master admin)
    const agent = await queryOne(
      'SELECT id, company_id FROM agents WHERE id = $1',
      [agent_id]
    );

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Only check company ownership for non-master admins
    if (!isMasterAdmin && agent.company_id !== companyId) {
      console.warn(
        `[INTEGRATIONS API] Unauthorized write attempt: user company ${companyId} tried to modify agent of company ${agent.company_id}`,
      );
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // SECURITY: Use agent's company_id for the integration (Master Admin uses agent's company)
    const integrationCompanyId = isMasterAdmin ? agent.company_id : companyId;

    // SECURITY: Use company_id from agent (for Master Admin) or session
    const payload = {
      agent_id,
      company_id: integrationCompanyId,
      provider: provider || 'z-api',
      identifier: identifier?.trim() || '',
      instance_id: instance_id?.trim() || '',
      token: token?.trim() || '',
      client_token: client_token?.trim() || null,
      base_url: base_url?.trim() || 'https://api.z-api.io/instances',
      is_active: is_active ?? true,
      buffer_enabled: buffer_enabled ?? true,
      buffer_debounce_seconds: buffer_debounce_seconds ?? 3,
      buffer_max_wait_seconds: buffer_max_wait_seconds ?? 10,
      updated_at: new Date().toISOString(),
    };

    try {
      // Upsert using INSERT ... ON CONFLICT
      const keys = Object.keys(payload);
      const values = Object.values(payload);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const columns = keys.join(', ');
      const updateClauses = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

      const upsertQuery = `
        INSERT INTO integrations (${columns})
        VALUES (${placeholders})
        ON CONFLICT (provider, identifier) DO UPDATE SET ${updateClauses}
        RETURNING *
      `;

      const result = await queryOne(upsertQuery, values);
      return NextResponse.json({ integration: result });
    } catch (dbError: any) {
      console.error('[INTEGRATIONS API] Upsert error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[INTEGRATIONS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/integrations?id={integrationId}
 * Delete an integration
 * SECURITY: Validates integration belongs to user's company
 */
export async function DELETE(request: NextRequest) {
  try {
    // Get company_id from authenticated session
    const { companyId, userId, isMasterAdmin } = await getCompanyIdFromSession();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Master Admin can delete any integration, regular users need companyId
    if (!isMasterAdmin && !companyId) {
      return NextResponse.json({ error: 'No company associated with user' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // SECURITY: Build delete query - Master Admin can delete any, regular users only their company's
    try {
      if (isMasterAdmin) {
        await deleteWhere('integrations', { id });
      } else {
        await query(
          'DELETE FROM integrations WHERE id = $1 AND company_id = $2',
          [id, companyId]
        );
      }
    } catch (dbError: any) {
      console.error('[INTEGRATIONS API] Delete error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[INTEGRATIONS API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
