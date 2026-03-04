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
 * GET /api/admin/companies
 * Returns list of companies with all fields.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabaseAdmin
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: companies, error } = await query;

    if (error) {
      console.error('[ADMIN COMPANIES] Error:', error);
      return NextResponse.json({ error: 'Error fetching companies' }, { status: 500 });
    }

    // Buscar subscriptions ativas com dados do plano
    const { data: subscriptions } = await supabaseAdmin
      .from('subscriptions')
      .select('company_id, status, current_period_end, plans(name, price_brl, display_credits)')
      .in('status', ['active', 'past_due']);

    // Buscar saldos de créditos
    const { data: credits } = await supabaseAdmin
      .from('company_credits')
      .select('company_id, balance_brl');

    // Criar mapa de subscription por company_id
    const subscriptionMap: Record<
      string,
      {
        plan_name: string;
        plan_price: number;
        display_credits: number;
        current_period_end: string | null;
        status: string;
      }
    > = {};
    for (const sub of subscriptions || []) {
      const plan = sub.plans as any;
      if (plan) {
        subscriptionMap[sub.company_id] = {
          plan_name: plan.name || '',
          plan_price: parseFloat(plan.price_brl || '0'),
          display_credits: plan.display_credits || 0,
          current_period_end: sub.current_period_end,
          status: sub.status,
        };
      }
    }

    // Criar mapa de créditos por company_id
    const creditsMap: Record<string, number> = {};
    for (const credit of credits || []) {
      creditsMap[credit.company_id] = parseFloat(credit.balance_brl || '0');
    }

    // Adicionar dados de subscription e créditos em cada empresa
    const companiesWithPlan = (companies || []).map((company) => {
      const sub = subscriptionMap[company.id];
      const balanceBrl = creditsMap[company.id] || 0;

      // Calcular créditos proporcionais
      let creditsRemaining = 0;
      if (sub && sub.plan_price > 0) {
        creditsRemaining = Math.floor((balanceBrl / sub.plan_price) * sub.display_credits);
      }

      return {
        ...company,
        subscription: sub || null,
        balance_brl: balanceBrl,
        credits_remaining: creditsRemaining,
      };
    });

    return NextResponse.json({ companies: companiesWithPlan });
  } catch (error: any) {
    console.error('[ADMIN COMPANIES] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/companies
 * Creates a new company.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data, error } = await supabaseAdmin.from('companies').insert([body]).select().single();

    if (error) {
      console.error('[ADMIN COMPANIES] Create error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ company: data }, { status: 201 });
  } catch (error: any) {
    console.error('[ADMIN COMPANIES] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/companies
 * Updates an existing company.
 * Only Master Admin can edit companies.
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!adminCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 });
    }

    // VALIDATION: If max_users is being updated, check current admin count
    if (updateData.max_users !== undefined) {
      const newMaxUsers = parseInt(updateData.max_users);

      if (isNaN(newMaxUsers) || newMaxUsers < 1) {
        return NextResponse.json(
          { error: 'Máximo de administradores deve ser pelo menos 1' },
          { status: 400 },
        );
      }

      // Count current active admins in the company
      const { count: adminCount } = await supabaseAdmin
        .from('users_v2')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', id)
        .in('role', ['admin_company', 'owner', 'admin'])
        .neq('status', 'suspended');

      if ((adminCount || 0) > newMaxUsers) {
        return NextResponse.json(
          {
            error: `Não é possível reduzir para ${newMaxUsers} administradores. Existem ${adminCount} administradores ativos na empresa.`,
          },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from('companies')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[ADMIN COMPANIES] Update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ company: data });
  } catch (error: any) {
    console.error('[ADMIN COMPANIES] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
