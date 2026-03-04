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

async function getCompanyIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId) {
      return adminSession.companyId;
    }

    if (adminSession.adminId) {
      const { data } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', adminSession.adminId)
        .single();

      if (data?.company_id) {
        return data.company_id;
      }
    }

    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);
    if (userSession.userId) {
      const { data } = await supabaseAdmin
        .from('users_v2')
        .select('company_id')
        .eq('id', userSession.userId)
        .single();

      if (data?.company_id) {
        return data.company_id;
      }
    }

    return null;
  } catch (error) {
    console.error('[Portal] Error getting company_id:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const companyId = await getCompanyIdFromSession();

    if (!companyId) {
      return NextResponse.json(
        { detail: 'Não autorizado. Faça login novamente.' },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { return_url } = body;

    if (!return_url) {
      return NextResponse.json({ detail: 'return_url é obrigatório' }, { status: 400 });
    }

    // Get stripe_customer_id from subscription
    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .limit(1)
      .single();

    if (error || !subscription?.stripe_customer_id) {
      return NextResponse.json(
        {
          detail:
            'Nenhuma assinatura encontrada. Você precisa ter uma assinatura para acessar o portal.',
        },
        { status: 400 },
      );
    }

    // Create portal session directly with Stripe
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: return_url,
    });

    console.log(`[Portal] Created session for company ${companyId}`);

    return NextResponse.json({
      portal_url: portalSession.url,
      session_id: portalSession.id,
    });
  } catch (error: any) {
    console.error('[Portal API] Error:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json({ detail: `Erro Stripe: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ detail: error.message || 'Erro interno' }, { status: 500 });
  }
}
