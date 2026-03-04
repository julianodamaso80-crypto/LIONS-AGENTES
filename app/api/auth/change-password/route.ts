import { NextRequest, NextResponse } from 'next/server';
import { queryOne, updateOne } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';

/**
 * POST /api/auth/change-password
 *
 * Standard password change for users_v2 table ONLY.
 * Used by: Regular Members, Company Admins
 *
 * Master Admin should use /api/admin/change-password instead.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, currentPassword, newPassword } = body;

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    console.log('[CHANGE PASSWORD] Using direct PostgreSQL client');

    // ========================================
    // FETCH USER FROM users_v2 (EXCLUSIVE)
    // ========================================
    const user = await queryOne(
      'SELECT id, email, password_hash FROM users_v2 WHERE id = $1',
      [userId],
    );

    if (!user) {
      console.error('[CHANGE PASSWORD] User not found in users_v2');
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    console.log('[CHANGE PASSWORD] User found:', user.email);

    // ========================================
    // VERIFY CURRENT PASSWORD
    // ========================================
    const isValid = await verifyPassword(currentPassword, user.password_hash);

    if (!isValid) {
      console.log('[CHANGE PASSWORD] ⛔ Current password incorrect');
      return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 401 });
    }

    // ========================================
    // UPDATE PASSWORD IN users_v2
    // ========================================
    const newHash = await hashPassword(newPassword);

    await updateOne('users_v2', { password_hash: newHash }, { id: userId });

    console.log('[CHANGE PASSWORD] ✅ Password updated for:', user.email);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[CHANGE PASSWORD] Critical error:', error);
    return NextResponse.json(
      { error: 'Erro interno ao processar troca de senha' },
      { status: 500 },
    );
  }
}
