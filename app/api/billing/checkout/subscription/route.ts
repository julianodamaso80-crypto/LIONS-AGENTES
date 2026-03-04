import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import {
  adminSessionOptions,
  AdminSessionData,
  sessionOptions,
  SessionData,
} from '@/lib/iron-session';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
});

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
      const { data } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', adminSession.adminId)
        .single();

      if (data?.company_id) {
        return { userId: adminSession.adminId, companyId: data.company_id };
      }
    }

    // Try user session
    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    if (userSession.userId) {
      const { data } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', userSession.userId)
        .single();

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
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, name, stripe_price_id, price_brl, is_active')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
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
    const { data: existingSub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .limit(1)
      .single();

    let stripeCustomerId = existingSub?.stripe_customer_id;

    if (!stripeCustomerId) {
      // Buscar dados do owner para criar customer
      const { data: owner } = await supabaseAdmin
        .from('users_v2')
        .select('email, first_name, last_name')
        .eq('company_id', companyId)
        .eq('is_owner', true)
        .single();

      if (!owner?.email) {
        return NextResponse.json(
          { detail: 'Empresa não tem owner com email cadastrado' },
          { status: 400 },
        );
      }

      // Buscar nome da empresa
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('company_name')
        .eq('id', companyId)
        .single();

      // Criar customer no Stripe
      const customer = await stripe.customers.create({
        email: owner.email,
        name: company?.company_name || `${owner.first_name} ${owner.last_name}`,
        metadata: {
          company_id: companyId,
        },
      });

      stripeCustomerId = customer.id;
    }

    // 3. Criar Checkout Session
    const session = await stripe.checkout.sessions.create({
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
