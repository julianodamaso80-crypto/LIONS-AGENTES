import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryOne } from '@/lib/db';

/**
 * GET /api/admin/company-info?companyId=xxx
 * Fetches company info by ID
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('scale_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    try {
      const data = await queryOne(
        'SELECT id, company_name FROM companies WHERE id = $1',
        [companyId]
      );

      if (!data) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }

      return NextResponse.json(data);
    } catch (dbError: any) {
      console.error('[ADMIN COMPANY-INFO] Error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[ADMIN COMPANY-INFO] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
