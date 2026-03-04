import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryOne, queryAll, deleteWhere } from '@/lib/db';

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
    const userMemory = await queryOne(
      'SELECT * FROM user_memories WHERE user_id = $1',
      [userId],
    );

    // Buscar resumos de sessão
    const sessionSummaries = await queryAll(
      'SELECT * FROM session_summaries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId],
    );

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

    // Deletar fatos e resumos
    try {
      await deleteWhere('user_memories', { user_id: userId });
      await deleteWhere('session_summaries', { user_id: userId });
    } catch (deleteError) {
      console.error('[Memory User] DELETE errors:', deleteError);
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
