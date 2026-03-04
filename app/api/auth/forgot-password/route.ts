import { NextRequest, NextResponse } from 'next/server';
import { queryOne, updateOne } from '@/lib/db';
import { sendRecoveryEmail } from '@/lib/email';
import { generateSecureToken } from '@/lib/auth';
import { rateLimit, RATE_LIMITS, getRateLimitHeaders } from '@/lib/rate-limit';
import { log, sanitizeEmail } from '@/lib/logger';

/**
 * POST /api/auth/forgot-password
 *
 * SECURITY FEATURES:
 * - Rate limiting: 5 req/hour per IP, 3 req/hour per email
 * - Secure 8-char alphanumeric tokens (2.8T combinations)
 * - Timing attack prevention (random delay)
 * - Enumeration prevention (same response for any email)
 *
 * Always returns 200 to prevent user enumeration.
 */
export async function POST(request: NextRequest) {
  // Get client IP for rate limiting
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0] ||
    request.headers.get('x-real-ip') ||
    'unknown';

  try {
    const body = await request.json();
    const { email } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Email inválido' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // =============================================
    // RATE LIMITING
    // =============================================

    // Check IP rate limit
    const ipLimit = await rateLimit(
      `forgot:ip:${ip}`,
      RATE_LIMITS.FORGOT_PASSWORD_IP.maxRequests,
      RATE_LIMITS.FORGOT_PASSWORD_IP.windowMs,
    );

    if (!ipLimit.success) {
      log.warn('[FORGOT PASSWORD] Rate limit exceeded', { ip, email: normalizedEmail });
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
        {
          status: 429,
          headers: getRateLimitHeaders(ipLimit),
        },
      );
    }

    // Check email rate limit
    const emailLimit = await rateLimit(
      `forgot:email:${normalizedEmail}`,
      RATE_LIMITS.FORGOT_PASSWORD_EMAIL.maxRequests,
      RATE_LIMITS.FORGOT_PASSWORD_EMAIL.windowMs,
    );

    if (!emailLimit.success) {
      log.warn('[FORGOT PASSWORD] Email rate limit exceeded', { email: normalizedEmail });
      return NextResponse.json(
        { error: 'Muitas tentativas para este email. Aguarde antes de tentar novamente.' },
        {
          status: 429,
          headers: getRateLimitHeaders(emailLimit),
        },
      );
    }

    log.info('[FORGOT PASSWORD] Request received', { email: normalizedEmail });

    // =============================================
    // TIMING ATTACK PREVENTION
    // =============================================

    // Add random delay to prevent timing attacks
    const randomDelay = Math.floor(Math.random() * 200) + 100; // 100-300ms
    await new Promise((resolve) => setTimeout(resolve, randomDelay));

    // =============================================
    // GENERATE SECURE TOKEN
    // =============================================

    // Generate 8-char alphanumeric token (2.8 trillion combinations)
    const code = generateSecureToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    // =============================================
    // PROCESS REQUEST (users_v2 first, then admin_users)
    // =============================================

    // Try users_v2 first
    const user = await queryOne(
      'SELECT id, email FROM users_v2 WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail],
    );

    if (user) {
      log.info('[FORGOT PASSWORD] User found', { email: sanitizeEmail(user.email) });

      // Update reset token and reset attempts counter
      try {
        await updateOne('users_v2', {
          reset_token: code,
          reset_token_expires_at: expiresAt,
          reset_attempts: 0, // Reset counter for new token
        }, { id: user.id });

        log.info('[FORGOT PASSWORD] Token saved, sending email');
        await sendRecoveryEmail(user.email, code);
      } catch (updateError: any) {
        log.error('[FORGOT PASSWORD] Error saving token', { error: updateError.message });
      }
    } else {
      // Try admin_users (Master Admin)
      const admin = await queryOne(
        'SELECT id, email FROM admin_users WHERE LOWER(email) = LOWER($1)',
        [normalizedEmail],
      );

      if (admin) {
        log.info('[FORGOT PASSWORD] Admin found', { email: sanitizeEmail(admin.email) });

        try {
          await updateOne('admin_users', {
            reset_token: code,
            reset_token_expires_at: expiresAt,
            reset_attempts: 0,
          }, { id: admin.id });

          log.info('[FORGOT PASSWORD] Admin token saved, sending email');
          await sendRecoveryEmail(admin.email, code);
        } catch (updateError: any) {
          // Silently fail - security
        }
      } else {
        // User not found - log but return success (security)
        log.info('[FORGOT PASSWORD] Email not found (returning success anyway)', {
          email: sanitizeEmail(normalizedEmail),
        });
      }
    }

    // =============================================
    // ALWAYS RETURN SAME SUCCESS MESSAGE
    // =============================================

    return NextResponse.json(
      {
        success: true,
        message: 'Se este email estiver cadastrado, você receberá as instruções de recuperação.',
      },
      {
        headers: getRateLimitHeaders(ipLimit),
      },
    );
  } catch (error: any) {
    log.error('[FORGOT PASSWORD] Critical error', { error: error.message });
    return NextResponse.json({ error: 'Erro interno ao processar solicitação' }, { status: 500 });
  }
}
