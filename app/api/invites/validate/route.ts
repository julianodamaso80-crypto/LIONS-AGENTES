import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * POST /api/invites/validate
 *
 * Valida um token de convite e retorna informações da empresa
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Buscar invite pelo token com dados da empresa
    const invite = await queryOne(
      `SELECT i.id, i.company_id, i.role, i.email, i.name, i.max_uses, i.current_uses, i.expires_at,
              c.company_name
       FROM invites i
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.token = $1`,
      [token],
    );

    if (!invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite token', valid: false },
        { status: 404 },
      );
    }

    // Verificar se expirou
    const now = new Date();
    const expiresAt = new Date(invite.expires_at);

    if (expiresAt < now) {
      return NextResponse.json(
        { error: 'Invite token has expired', valid: false },
        { status: 410 }, // 410 Gone
      );
    }

    // Verificar se excedeu número de usos
    if (invite.current_uses >= invite.max_uses) {
      return NextResponse.json(
        { error: 'Invite token has reached maximum uses', valid: false },
        { status: 410 },
      );
    }

    // Token válido - retornar informações
    return NextResponse.json({
      valid: true,
      companyId: invite.company_id,
      companyName: invite.company_name || 'Unknown Company',
      inviteId: invite.id,
      role: invite.role || 'member',
      email: invite.email || null,
      name: invite.name || null,
    });
  } catch (error: any) {
    console.error('[INVITE VALIDATE] Error:', error);
    return NextResponse.json({ error: 'Internal server error', valid: false }, { status: 500 });
  }
}
