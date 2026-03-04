import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, getRateLimitHeaders } from '@/lib/rate-limit';
import { log, sanitizeEmail } from '@/lib/logger';

// Service Role Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * POST /api/auth/reset-password
 *
 * SECURITY FEATURES:
 * - Rate limiting: 10 attempts/hour per IP, 5 per token
 * - Password strength validation (8+ chars, upper, lower, number)
 * - Token invalidation after 5 failed attempts
 * - Uses bcrypt for new passwords
 * - Generic error messages to prevent enumeration
 */
export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0] ||
    request.headers.get('x-real-ip') ||
    'unknown';

  try {
    const body = await request.json();
    const { email, code, newPassword } = body;

    // =============================================
    // INPUT VALIDATION
    // =============================================

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        {
          error: 'Senha inválida',
          details: passwordValidation.errors,
        },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = code.toUpperCase().trim(); // Tokens are uppercase

    // =============================================
    // RATE LIMITING
    // =============================================

    // Check IP rate limit
    const ipLimit = rateLimit(
      `reset:ip:${ip}`,
      RATE_LIMITS.RESET_PASSWORD_IP.maxRequests,
      RATE_LIMITS.RESET_PASSWORD_IP.windowMs,
    );

    if (!ipLimit.success) {
      log.warn('[RESET PASSWORD] IP rate limit exceeded', { ip });
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
        {
          status: 429,
          headers: getRateLimitHeaders(ipLimit),
        },
      );
    }

    log.info('[RESET PASSWORD] Request received', { email: normalizedEmail });

    // =============================================
    // FIND USER AND VALIDATE TOKEN
    // =============================================

    // Try users_v2 first
    const { data: user, error: userError } = await supabaseAdmin
      .from('users_v2')
      .select('id, email, role, reset_token, reset_token_expires_at, reset_attempts')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (!userError && user) {
      return await processReset(supabaseAdmin, 'users_v2', user, normalizedCode, newPassword, ip);
    }

    // Try admin_users (Master Admin)
    const { data: admin, error: adminError } = await supabaseAdmin
      .from('admin_users')
      .select('id, email, reset_token, reset_token_expires_at, reset_attempts')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (!adminError && admin) {
      return await processReset(
        supabaseAdmin,
        'admin_users',
        admin,
        normalizedCode,
        newPassword,
        ip,
        true,
      );
    }

    // User not found - generic error
    log.info('[RESET PASSWORD] Email not found', { email: sanitizeEmail(normalizedEmail) });
    return NextResponse.json(
      { error: 'Código inválido ou expirado. Solicite um novo.' },
      { status: 400 },
    );
  } catch (error: any) {
    log.error('[RESET PASSWORD] Critical error', { error: error.message });
    return NextResponse.json({ error: 'Erro interno ao processar solicitação' }, { status: 500 });
  }
}

/**
 * Process password reset for user or admin
 */
async function processReset(
  supabaseClient: any,
  table: 'users_v2' | 'admin_users',
  record: any,
  code: string,
  newPassword: string,
  ip: string,
  isAdmin: boolean = false,
): Promise<NextResponse> {
  const maxAttempts = RATE_LIMITS.RESET_PASSWORD_TOKEN.maxRequests;
  const currentAttempts = record.reset_attempts || 0;

  // =============================================
  // CHECK IF TOKEN IS INVALIDATED (5+ failures)
  // =============================================

  if (currentAttempts >= maxAttempts) {
    log.warn('[RESET PASSWORD] Token invalidated due to too many attempts', {
      email: sanitizeEmail(record.email),
      attempts: currentAttempts,
    });
    return NextResponse.json(
      { error: 'Token invalidado. Solicite um novo código.' },
      { status: 400 },
    );
  }

  // =============================================
  // VALIDATE TOKEN
  // =============================================

  // Check if token matches
  if (!record.reset_token || record.reset_token !== code) {
    // Increment failed attempts
    await supabaseClient
      .from(table)
      .update({ reset_attempts: currentAttempts + 1 })
      .eq('id', record.id);

    log.warn('[RESET PASSWORD] Invalid token', {
      email: sanitizeEmail(record.email),
      attempts: currentAttempts + 1,
    });

    const remaining = maxAttempts - (currentAttempts + 1);
    if (remaining <= 0) {
      return NextResponse.json(
        { error: 'Token invalidado após muitas tentativas. Solicite um novo código.' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Código inválido ou expirado. Solicite um novo.' },
      { status: 400 },
    );
  }

  // =============================================
  // CHECK EXPIRATION
  // =============================================

  if (!record.reset_token_expires_at || new Date(record.reset_token_expires_at) < new Date()) {
    log.info('[RESET PASSWORD] Token expired', { email: sanitizeEmail(record.email) });
    return NextResponse.json(
      { error: 'Código inválido ou expirado. Solicite um novo.' },
      { status: 400 },
    );
  }

  // =============================================
  // HASH NEW PASSWORD WITH BCRYPT
  // =============================================

  const newHash = await hashPassword(newPassword);

  // =============================================
  // UPDATE PASSWORD AND CLEAR TOKEN
  // =============================================

  const { error: updateError } = await supabaseClient
    .from(table)
    .update({
      password_hash: newHash,
      reset_token: null,
      reset_token_expires_at: null,
      reset_attempts: 0,
      password_migrated_at: new Date().toISOString(), // Mark as bcrypt
    })
    .eq('id', record.id);

  if (updateError) {
    log.error('[RESET PASSWORD] Error updating password', { error: updateError.message });
    return NextResponse.json({ error: 'Erro ao atualizar senha' }, { status: 500 });
  }

  log.info('[RESET PASSWORD] ✅ Password reset successfully', {
    email: sanitizeEmail(record.email),
    hashType: 'bcrypt',
  });

  // Determine user type for redirect
  let userType = 'member';
  if (isAdmin || (record.role && ['admin_company', 'owner', 'admin'].includes(record.role))) {
    userType = 'admin';
  }

  return NextResponse.json({
    success: true,
    message: 'Senha alterada com sucesso!',
    userType,
  });
}
