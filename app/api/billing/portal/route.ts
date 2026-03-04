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

async function getCompanyIdFromSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();

    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);
    if (adminSession.companyId) {
      return adminSession.companyId;
    }

    if (adminSession.adminId) {
      const data = await queryOne(
        'SELECT company_id FROM users_v2 WHERE id = $1',
        [adminSession.adminId],
      );

      if (data?.company_id) {
        return data.company_id;
      }
    }

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
    const subscription = await queryOne(
      'SELECT stripe_customer_id FROM subscriptions WHERE company_id = $1 LIMIT 1',
      [companyId],
    );

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        {
          detail:
            'Nenhuma assinatura encontrada. Você precisa ter uma assinatura para acessar o portal.',
        },
        { status: 400 },
      );
    }

    // Create portal session directly with Stripe
    const portalSession = await getStripe().billingPortal.sessions.create({
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
