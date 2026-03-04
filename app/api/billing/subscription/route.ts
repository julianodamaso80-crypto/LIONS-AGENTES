import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';
import { queryOne, queryAll, countWhere } from '@/lib/db';

async function getCompanyIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    // Try admin session first
    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId) {
      return adminSession.companyId;
    }

    // If admin session has adminId, try to get company_id from users_v2
    if (adminSession.adminId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [adminSession.adminId],
      );

      if (data?.company_id) {
        return data.company_id;
      }
    }

    // Try user session
    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    if (userSession.userId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [userSession.userId],
      );

      if (data?.company_id) {
        return data.company_id;
      }
    }

    return null;
  } catch (error) {
    console.error('[Billing] Error getting company_id:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const companyId = await getCompanyIdFromSession();

    if (!companyId) {
      console.log('[Billing] No company_id found in session');
      return NextResponse.json({
        has_subscription: false,
        plan: null,
        balance_brl: 0,
        credits_display: { remaining: 0, used: 0, total: 0, percentage: 0 },
        usage: { agents: { used: 0, limit: 0 }, knowledge_bases: { used: 0, limit: 0 } },
        current_period_end: null,
      });
    }

    // 1. Buscar subscription ativa ou past_due com dados do plano
    const subscription = await queryOne(
      `SELECT s.*, p.id as plan_id, p.name as plan_name, p.price_brl as plan_price_brl,
              p.monthly_price as plan_monthly_price, p.display_credits as plan_display_credits,
              p.credits_limit as plan_credits_limit, p.max_agents as plan_max_agents,
              p.max_knowledge_bases as plan_max_knowledge_bases, p.features as plan_features
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.company_id = $1 AND s.status = ANY($2::text[])
       LIMIT 1`,
      [companyId, ['active', 'past_due']],
    );

    if (!subscription) {
      return NextResponse.json({
        has_subscription: false,
        status: null,
        plan: null,
        balance_brl: 0,
        credits_display: { remaining: 0, used: 0, total: 0, percentage: 0 },
        usage: { agents: { used: 0, limit: 0 }, knowledge_bases: { used: 0, limit: 0 } },
        current_period_end: null,
      });
    }

    // Build plan object from joined data
    const plan: any = {
      id: subscription.plan_id,
      name: subscription.plan_name,
      price_brl: subscription.plan_price_brl,
      monthly_price: subscription.plan_monthly_price,
      display_credits: subscription.plan_display_credits,
      credits_limit: subscription.plan_credits_limit,
      max_agents: subscription.plan_max_agents,
      max_knowledge_bases: subscription.plan_max_knowledge_bases,
      features: subscription.plan_features,
    };

    // 2. Buscar saldo de créditos
    const credits = await queryOne(
      'SELECT balance_brl FROM company_credits WHERE company_id = $1',
      [companyId],
    );

    const balanceBrl = parseFloat(credits?.balance_brl || '0');

    // 3. Calcular créditos proporcionais
    const planPrice = parseFloat(plan.price_brl || plan.monthly_price || '0');
    const displayCredits = plan.display_credits || plan.credits_limit || 0;

    let creditsPercentage = 0;
    let creditsRemaining = 0;
    let creditsUsed = 0;

    if (planPrice > 0) {
      creditsPercentage = (balanceBrl / planPrice) * 100;
      creditsRemaining = Math.floor((balanceBrl / planPrice) * displayCredits);
      creditsUsed = displayCredits - creditsRemaining;
    }

    // 4. Contar agentes ativos
    const agentsUsed = await countWhere('agents', { company_id: companyId, is_active: true });

    // 5. Contar documentos (bases de conhecimento)
    const kbsUsed = await countWhere('documents', { company_id: companyId });

    // 6. Limites do plano
    const maxAgents = plan.max_agents || 3;
    const maxKbs = plan.max_knowledge_bases || 5;

    // 7. Normalizar features
    let features = plan.features || [];
    if (Array.isArray(features) && features.length > 0 && typeof features[0] === 'string') {
      features = features.map((f: string) => ({ name: f, included: true }));
    }

    return NextResponse.json({
      has_subscription: true,
      status: subscription.status, // 'active' or 'past_due'
      plan: {
        id: plan.id,
        name: plan.name,
        price_brl: planPrice,
        display_credits: displayCredits,
        features: features,
      },
      balance_brl: balanceBrl,
      credits_display: {
        remaining: Math.max(0, creditsRemaining),
        used: Math.max(0, creditsUsed),
        total: displayCredits,
        percentage: Math.round(Math.min(100, Math.max(0, creditsPercentage)) * 10) / 10,
      },
      usage: {
        agents: { used: agentsUsed || 0, limit: maxAgents },
        knowledge_bases: { used: kbsUsed || 0, limit: maxKbs },
      },
      current_period_end: subscription.current_period_end,
      cancel_at: subscription.cancel_at,
    });
  } catch (error) {
    console.error('[Billing API] Error:', error);
    return NextResponse.json({
      has_subscription: false,
      status: null,
      plan: null,
      balance_brl: 0,
      credits_display: { remaining: 0, used: 0, total: 0, percentage: 0 },
      usage: { agents: { used: 0, limit: 0 }, knowledge_bases: { used: 0, limit: 0 } },
      current_period_end: null,
    });
  }
}
