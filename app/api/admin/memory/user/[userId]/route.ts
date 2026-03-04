import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * GET /api/admin/memory/user/[userId]
 * Busca memória de um usuário específico (fatos + resumos)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    // Auth check
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');
    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Buscar fatos do usuário
    const { data: userMemory, error: memoryError } = await supabaseAdmin
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Buscar resumos de sessão
    const { data: sessionSummaries, error: summariesError } = await supabaseAdmin
      .from('session_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      user_memory: userMemory || null,
      session_summaries: sessionSummaries || [],
      has_memory: !!userMemory,
      total_summaries: sessionSummaries?.length || 0,
    });
  } catch (error) {
    console.error('[Memory User] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/memory/user/[userId]
 * Apaga memória de um usuário (fatos + resumos)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    // Auth check
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');
    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Deletar fatos
    const { error: memoryError } = await supabaseAdmin
      .from('user_memories')
      .delete()
      .eq('user_id', userId);

    // Deletar resumos
    const { error: summariesError } = await supabaseAdmin
      .from('session_summaries')
      .delete()
      .eq('user_id', userId);

    if (memoryError || summariesError) {
      console.error('[Memory User] DELETE errors:', { memoryError, summariesError });
      return NextResponse.json({ error: 'Failed to delete user memory' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'User memory deleted successfully',
    });
  } catch (error) {
    console.error('[Memory User DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
