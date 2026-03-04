import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/agents/[agentId]/public
 *
 * Public endpoint to get agent info for widget embedding.
 * Only returns non-sensitive data (name, avatar, widget_config).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 });
    }

    const agent = await queryOne<{
      id: string;
      company_id: string;
      name: string;
      avatar_url: string | null;
      widget_config: any;
      is_active: boolean;
    }>(
      'SELECT id, company_id, name, avatar_url, widget_config, is_active FROM agents WHERE id = $1',
      [agentId],
    );

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (!agent.is_active) {
      return NextResponse.json({ error: 'Agent is not active' }, { status: 403 });
    }

    // Return only public data + company_id for chat
    return NextResponse.json({
      id: agent.id,
      company_id: agent.company_id,
      name: agent.name,
      avatar_url: agent.avatar_url,
      widget_config: agent.widget_config || {},
    });
  } catch (error) {
    console.error('[API] Error fetching public agent:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
