/**
 * Rate Limiting Utility
 *
 * In-memory sliding window rate limiter.
 * For production, consider using Upstash Redis.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory store (resets when server restarts)
const rateLimitStore = new Map<string, RateLimitRecord>();

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];

  rateLimitStore.forEach((record, key) => {
    if (record.resetAt < now) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => rateLimitStore.delete(key));
}, 60000); // Cleanup every minute

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
export function rateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  // If no record or window expired, create new
  if (!record || record.resetAt < now) {
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return {
      success: true,
      remaining: maxRequests - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  // Increment count
  record.count += 1;

  // Check if exceeded
  if (record.count > maxRequests) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    return {
      success: false,
      remaining: 0,
      resetAt: record.resetAt,
      retryAfterSeconds,
    };
  }

  return {
    success: true,
    remaining: maxRequests - record.count,
    resetAt: record.resetAt,
    retryAfterSeconds: 0,
  };
}

/**
 * Reset rate limit for a key (e.g., after successful action)
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
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
