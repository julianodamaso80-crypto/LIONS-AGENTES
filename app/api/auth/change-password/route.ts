import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashPassword, verifyPassword } from '@/lib/auth';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

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

    console.log('[CHANGE PASSWORD] Using Service Role client');

    // ========================================
    // FETCH USER FROM users_v2 (EXCLUSIVE)
    // ========================================
    const { data: user, error: userError } = await supabaseAdmin
      .from('users_v2')
      .select('id, email, password_hash')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('[CHANGE PASSWORD] User not found in users_v2:', userError);
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

    const { error: updateError } = await supabaseAdmin
      .from('users_v2')
      .update({ password_hash: newHash })
      .eq('id', userId);

    if (updateError) {
      console.error('[CHANGE PASSWORD] Error updating password:', updateError);
      throw updateError;
    }

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
