/**
 * Rate Limiting Utility (Redis-backed)
 *
 * Uses Redis sliding window for distributed rate limiting.
 */

import { checkRateLimit as redisCheckRateLimit } from './redis';

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Check rate limit for a given key
 * @param key - Unique identifier (e.g., IP address, email, token)
 * @param maxRequests - Maximum requests allowed in window
 * @param windowMs - Time window in milliseconds
 */
export async function rateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
  const windowSeconds = Math.ceil(windowMs / 1000);

  try {
    const result = await redisCheckRateLimit(key, maxRequests, windowSeconds);
    const resetAt = result.resetAt.getTime();
    const now = Date.now();

    return {
      success: result.allowed,
      remaining: result.remaining,
      resetAt,
      retryAfterSeconds: result.allowed ? 0 : Math.ceil((resetAt - now) / 1000),
    };
  } catch {
    // If Redis is unavailable, allow the request (fail-open)
    return {
      success: true,
      remaining: maxRequests,
      resetAt: Date.now() + windowMs,
      retryAfterSeconds: 0,
    };
  }
}

/**
 * Get rate limit headers for HTTP response
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.resetAt).toISOString(),
    ...(result.retryAfterSeconds > 0 && {
      'Retry-After': result.retryAfterSeconds.toString(),
    }),
  };
}

// Common rate limit configurations
export const RATE_LIMITS = {
  FORGOT_PASSWORD_IP: { maxRequests: 5, windowMs: 60 * 60 * 1000 }, // 5/hour per IP
  FORGOT_PASSWORD_EMAIL: { maxRequests: 3, windowMs: 60 * 60 * 1000 }, // 3/hour per email
  RESET_PASSWORD_IP: { maxRequests: 10, windowMs: 60 * 60 * 1000 }, // 10/hour per IP
  RESET_PASSWORD_TOKEN: { maxRequests: 5, windowMs: 60 * 60 * 1000 }, // 5 attempts per token
  LOGIN_IP: { maxRequests: 10, windowMs: 15 * 60 * 1000 }, // 10/15min per IP
} as const;
