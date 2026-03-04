import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rpc } from '@/lib/db';

/**
 * GET /api/admin/costs
 * Fetches token usage report and company totals using RPC functions
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    if (!start || !end) {
      return NextResponse.json({ error: 'start and end dates are required' }, { status: 400 });
    }

    // Fetch aggregated report
    let reportData;
    try {
      reportData = await rpc('get_token_usage_report', { start_date: start, end_date: end });
    } catch (reportError: any) {
      console.error('[ADMIN COSTS] Report RPC error:', reportError);
      return NextResponse.json(
        {
          error: reportError.message,
          report: [],
          companyTotals: [],
        },
        { status: 200 },
      ); // Return 200 with error message for graceful handling
    }

    // Fetch company totals
    let companyData;
    try {
      companyData = await rpc('get_token_usage_by_company', { start_date: start, end_date: end });
    } catch (companyError) {
      console.error('[ADMIN COSTS] Company RPC error:', companyError);
    }

    return NextResponse.json({
      report: reportData || [],
      companyTotals: companyData || [],
    });
  } catch (error: any) {
    console.error('[ADMIN COSTS] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
