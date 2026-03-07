import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne, queryAll } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { adminSessionOptions, AdminSessionData } from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/change-password
 *
 * EXCLUSIVE endpoint for Master Admin password change.
 * Only interacts with admin_users table.
 *
 * Security:
 * - Requires valid scale_admin_session cookie
 * - Only searches in admin_users table
 * - Never touches users_v2
 */
export async function POST(request: NextRequest) {
  try {
    // ========================================
    // AUTHENTICATION: Verify admin session
    // ========================================
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (!session.adminId) {
      console.log('[ADMIN CHANGE PASSWORD] ⛔ No admin session');
      return NextResponse.json({ error: 'Sessão administrativa não encontrada' }, { status: 401 });
    }

    const adminId = session.adminId;
    console.log('[ADMIN CHANGE PASSWORD] Admin session validated, adminId:', adminId);

    // ========================================
    // PARSE REQUEST BODY
    // ========================================
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'Nova senha deve ter pelo menos 6 caracteres' },
        { status: 400 },
      );
    }

    console.log('[ADMIN CHANGE PASSWORD] ✅ Using direct PostgreSQL (bypasses RLS)');

    // ========================================
    // FETCH ADMIN FROM admin_users (EXCLUSIVE)
    // ========================================
    const admin = await queryOne(
      'SELECT id, email, password_hash FROM admin_users WHERE id = $1',
      [adminId]
    );

    if (!admin) {
      console.error('[ADMIN CHANGE PASSWORD] Admin not found in admin_users');
      return NextResponse.json({ error: 'Administrador não encontrado' }, { status: 404 });
    }

    console.log('[ADMIN CHANGE PASSWORD] Admin found:', admin.email);
    console.log('[ADMIN CHANGE PASSWORD] Password hash exists:', !!admin.password_hash);

    // ========================================
    // VERIFY CURRENT PASSWORD
    // ========================================
    try {
      const isValid = await verifyPassword(currentPassword, admin.password_hash);

      if (!isValid) {
        console.log('[ADMIN CHANGE PASSWORD] ⛔ Current password incorrect');
        return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 401 });
      }
      console.log('[ADMIN CHANGE PASSWORD] ✅ Password verified');
    } catch (verifyError) {
      console.error('[ADMIN CHANGE PASSWORD] Error verifying password:', verifyError);
      return NextResponse.json({ error: 'Erro ao verificar senha atual' }, { status: 500 });
    }

    // ========================================
    // UPDATE PASSWORD IN admin_users
    // ========================================
    try {
      const newHash = await hashPassword(newPassword);
      console.log('[ADMIN CHANGE PASSWORD] New hash generated, updating database...');

      const updatedData = await queryAll(
        'UPDATE admin_users SET password_hash = $1 WHERE id = $2 RETURNING id, email',
        [newHash, adminId]
      );

      // Verify that update actually happened
      if (!updatedData || updatedData.length === 0) {
        console.error(
          '[ADMIN CHANGE PASSWORD] ❌ No rows updated! AdminId:',
          adminId,
        );
        return NextResponse.json(
          { error: 'Falha ao atualizar senha - verifique permissões do banco' },
          { status: 500 },
        );
      }

      console.log('[ADMIN CHANGE PASSWORD] ✅ Password updated successfully!', {
        email: updatedData[0]?.email,
        rowsAffected: updatedData.length,
      });
      return NextResponse.json({ success: true });
    } catch (hashError) {
      console.error('[ADMIN CHANGE PASSWORD] Error hashing new password:', hashError);
      return NextResponse.json({ error: 'Erro ao processar nova senha' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[ADMIN CHANGE PASSWORD] Critical error:', error);
    return NextResponse.json(
      { error: 'Erro interno ao processar troca de senha' },
      { status: 500 },
    );
  }
}
