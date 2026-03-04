import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryAll, queryOne, insertOne, updateOne, query } from '@/lib/db';

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

    let companies: any[];
    try {
      if (status && status !== 'all') {
        companies = await queryAll(
          'SELECT * FROM companies WHERE status = $1 ORDER BY created_at DESC',
          [status]
        );
      } else {
        companies = await queryAll(
          'SELECT * FROM companies ORDER BY created_at DESC'
        );
      }
    } catch (dbError) {
      console.error('[ADMIN COMPANIES] Error:', dbError);
      return NextResponse.json({ error: 'Error fetching companies' }, { status: 500 });
    }

    // Buscar subscriptions ativas com dados do plano
    const subscriptions = await queryAll(
      `SELECT s.company_id, s.status, s.current_period_end, p.name AS plan_name, p.price_brl, p.display_credits
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.status = ANY($1::text[])`,
      [['active', 'past_due']]
    );

    // Buscar saldos de créditos
    const credits = await queryAll(
      'SELECT company_id, balance_brl FROM company_credits'
    );

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
      subscriptionMap[sub.company_id] = {
        plan_name: sub.plan_name || '',
        plan_price: parseFloat(sub.price_brl || '0'),
        display_credits: sub.display_credits || 0,
        current_period_end: sub.current_period_end,
        status: sub.status,
      };
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

    try {
      const data = await insertOne('companies', body);
      return NextResponse.json({ company: data }, { status: 201 });
    } catch (dbError: any) {
      console.error('[ADMIN COMPANIES] Create error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }
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
      const countResult = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM users_v2
         WHERE company_id = $1
         AND role = ANY($2::text[])
         AND status != $3`,
        [id, ['admin_company', 'owner', 'admin'], 'suspended']
      );
      const adminCount = countResult?.count || 0;

      if (adminCount > newMaxUsers) {
        return NextResponse.json(
          {
            error: `Não é possível reduzir para ${newMaxUsers} administradores. Existem ${adminCount} administradores ativos na empresa.`,
          },
          { status: 400 },
        );
      }
    }

    try {
      const data = await updateOne('companies', updateData, { id });

      if (!data) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }

      return NextResponse.json({ company: data });
    } catch (dbError: any) {
      console.error('[ADMIN COMPANIES] Update error:', dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[ADMIN COMPANIES] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
