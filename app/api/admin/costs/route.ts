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
    const { data: reportData, error: reportError } = await supabaseAdmin.rpc(
      'get_token_usage_report',
      { start_date: start, end_date: end },
    );

    if (reportError) {
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
    const { data: companyData, error: companyError } = await supabaseAdmin.rpc(
      'get_token_usage_by_company',
      { start_date: start, end_date: end },
    );

    if (companyError) {
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
