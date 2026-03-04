import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import {
  adminSessionOptions,
  AdminSessionData,
  sessionOptions,
  SessionData,
} from '@/lib/iron-session';
import { queryOne } from '@/lib/db';
import Stripe from 'stripe';

let _stripe: Stripe | null = null;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-12-15.clover' });
  return _stripe;
}

interface SessionInfo {
  userId: string | null;
  companyId: string | null;
}

async function getSessionInfo(): Promise<SessionInfo> {
  try {
    const cookieStore = await cookies();

    // Try admin session first
    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId && adminSession.adminId) {
      return { userId: adminSession.adminId, companyId: adminSession.companyId };
    }

    // If admin session has adminId, try to get company_id from users_v2
    if (adminSession.adminId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [adminSession.adminId],
      );

      if (data?.company_id) {
        return { userId: adminSession.adminId, companyId: data.company_id };
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
        return { userId: userSession.userId, companyId: data.company_id };
      }
    }

    return { userId: null, companyId: null };
  } catch (error) {
    console.error('[Checkout] Error getting session:', error);
    return { userId: null, companyId: null };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, companyId } = await getSessionInfo();

    if (!companyId || !userId) {
      return NextResponse.json(
        { detail: 'Não autorizado. Faça login novamente.' },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { plan_id, success_url, cancel_url } = body;

    if (!plan_id || !success_url || !cancel_url) {
      return NextResponse.json(
        { detail: 'Parâmetros obrigatórios: plan_id, success_url, cancel_url' },
        { status: 400 },
      );
    }

    // 1. Buscar plano
    const plan = await queryOne(
      'SELECT id, name, stripe_price_id, price_brl, is_active FROM plans WHERE id = $1',
      [plan_id],
    );

    if (!plan) {
      return NextResponse.json({ detail: 'Plano não encontrado' }, { status: 404 });
    }

    if (!plan.is_active) {
      return NextResponse.json({ detail: 'Plano não está ativo' }, { status: 400 });
    }

    if (!plan.stripe_price_id) {
      return NextResponse.json(
        { detail: 'Plano não tem preço Stripe configurado' },
        { status: 400 },
      );
    }

    // 2. Buscar ou criar Stripe Customer
    // Primeiro verificar se já existe na tabela subscriptions
    const existingSub = await queryOne(
      'SELECT stripe_customer_id FROM subscriptions WHERE company_id = $1 LIMIT 1',
      [companyId],
    );

    let stripeCustomerId = existingSub?.stripe_customer_id;

    if (!stripeCustomerId) {
      // Buscar dados do owner para criar customer
      const owner = await queryOne(
        "SELECT email, first_name, last_name FROM users_v2 WHERE company_id = $1 AND is_owner = true",
        [companyId],
      );

      if (!owner?.email) {
        return NextResponse.json(
          { detail: 'Empresa não tem owner com email cadastrado' },
          { status: 400 },
        );
      }

      // Buscar nome da empresa
      const company = await queryOne(
        'SELECT company_name FROM companies WHERE id = $1',
        [companyId],
      );

      // Criar customer no Stripe
      const customer = await getStripe().customers.create({
        email: owner.email,
        name: company?.company_name || `${owner.first_name} ${owner.last_name}`,
        metadata: {
          company_id: companyId,
        },
      });

      stripeCustomerId = customer.id;
    }

    // 3. Criar Checkout Session
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price: plan.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url,
      metadata: {
        company_id: companyId,
        plan_id: plan_id,
      },
      subscription_data: {
        metadata: {
          company_id: companyId,
          plan_id: plan_id,
        },
      },
    });

    console.log(
      `[Stripe Checkout] Created session ${session.id} for company ${companyId}, plan ${plan.name}`,
    );

    return NextResponse.json({
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (error: any) {
    console.error('[Checkout API] Error:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json({ detail: `Erro Stripe: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ detail: error.message || 'Erro interno' }, { status: 500 });
  }
}
