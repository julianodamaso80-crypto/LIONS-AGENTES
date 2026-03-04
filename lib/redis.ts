import Redis from 'ioredis';

// =============================================
// Redis Connection (Railway Redis)
// =============================================

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.URL_DO_REDIS || 'redis://localhost:6379';
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[REDIS] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[REDIS] Connected');
    });

    redis.connect().catch((err) => {
      console.error('[REDIS] Initial connection failed:', err.message);
    });
  }
  return redis;
}

// =============================================
// Cache Helpers
// =============================================

/**
 * Get cached value (parsed from JSON)
 */
export async function cacheGet<T = any>(key: string): Promise<T | null> {
  try {
    const data = await getRedis().get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Set cached value with TTL in seconds
 */
export async function cacheSet(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
  try {
    await getRedis().setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    console.error('[REDIS] Cache set error:', err);
  }
}

/**
 * Delete cached value
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch (err) {
    console.error('[REDIS] Cache delete error:', err);
  }
}

/**
 * Delete all cached values matching a pattern
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const r = getRedis();
    const keys = await r.keys(pattern);
    if (keys.length > 0) {
      await r.del(...keys);
    }
  } catch (err) {
    console.error('[REDIS] Cache delete pattern error:', err);
  }
}

// =============================================
// Rate Limiting
// =============================================

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Check rate limit using sliding window counter
 * @param identifier - IP address, user ID, or other identifier
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowSeconds - Time window in seconds
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number = 60,
  windowSeconds: number = 60,
): Promise<RateLimitResult> {
  const r = getRedis();
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const pipeline = r.pipeline();
  // Remove expired entries
  pipeline.zremrangebyscore(key, 0, windowStart);
  // Add current request
  pipeline.zadd(key, now, `${now}:${Math.random()}`);
  // Count requests in window
  pipeline.zcard(key);
  // Set TTL
  pipeline.expire(key, windowSeconds);

  const results = await pipeline.exec();
  const count = (results?.[2]?.[1] as number) || 0;

  return {
    allowed: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt: new Date(now + windowSeconds * 1000),
  };
}

// =============================================
// Session Store (JWT Token Blacklist)
// =============================================

/**
 * Blacklist a JWT token (for logout)
 */
export async function blacklistToken(token: string, ttlSeconds: number = 604800): Promise<void> {
  await getRedis().setex(`blacklist:${token}`, ttlSeconds, '1');
}

/**
 * Check if a JWT token is blacklisted
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const result = await getRedis().get(`blacklist:${token}`);
  return result === '1';
}

// =============================================
// Session Cache
// =============================================

/**
 * Store user session data in Redis for fast access
 */
export async function setSessionCache(
  sessionId: string,
  data: any,
  ttlSeconds: number = 86400,
): Promise<void> {
  await cacheSet(`session:${sessionId}`, data, ttlSeconds);
}

/**
 * Get user session data from Redis
 */
export async function getSessionCache<T = any>(sessionId: string): Promise<T | null> {
  return cacheGet<T>(`session:${sessionId}`);
}

/**
 * Delete user session from Redis
 */
export async function deleteSessionCache(sessionId: string): Promise<void> {
  await cacheDel(`session:${sessionId}`);
}

/**
 * Get raw Redis instance for custom operations
 */
export function getRedisClient(): Redis {
  return getRedis();
}

export default {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  checkRateLimit,
  blacklistToken,
  isTokenBlacklisted,
  setSessionCache,
  getSessionCache,
  deleteSessionCache,
  getRedisClient,
};
