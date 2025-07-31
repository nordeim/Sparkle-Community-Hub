// src/lib/rate-limiter.ts
import { Redis } from 'ioredis'

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: Date
  retryAfter?: number
}

interface RateLimitOptions {
  windowMs: number
  maxRequests: number
  namespace?: string
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

export class RateLimiter {
  private redis: Redis | null = null
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map()

  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL)
    }
  }

  async checkLimit(
    identifier: string,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    const {
      windowMs,
      maxRequests,
      namespace = 'default',
    } = options

    const key = `ratelimit:${namespace}:${identifier}`
    const now = Date.now()
    const windowStart = now - windowMs

    if (this.redis) {
      return this.checkLimitWithRedis(key, windowStart, now, windowMs, maxRequests)
    } else {
      return this.checkLimitWithMemory(key, now, windowMs, maxRequests)
    }
  }

  private async checkLimitWithRedis(
    key: string,
    windowStart: number,
    now: number,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const multi = this.redis!.multi()

    // Remove old entries
    multi.zremrangebyscore(key, '-inf', windowStart)
    
    // Count current entries
    multi.zcard(key)
    
    // Add current request
    multi.zadd(key, now, `${now}-${Math.random()}`)
    
    // Set expiry
    multi.expire(key, Math.ceil(windowMs / 1000))

    const results = await multi.exec()
    const count = (results?.[1]?.[1] as number) || 0

    const success = count < maxRequests
    const remaining = Math.max(0, maxRequests - count - 1)
    const reset = new Date(now + windowMs)

    if (!success) {
      // Get oldest entry to calculate retry after
      const oldestEntry = await this.redis!.zrange(key, 0, 0, 'WITHSCORES')
      if (oldestEntry.length >= 2) {
        const oldestTime = parseInt(oldestEntry[1])
        const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000)
        
        return {
          success: false,
          limit: maxRequests,
          remaining: 0,
          reset,
          retryAfter,
        }
      }
    }

    return {
      success,
      limit: maxRequests,
      remaining,
      reset,
    }
  }

  private checkLimitWithMemory(
    key: string,
    now: number,
    windowMs: number,
    maxRequests: number
  ): RateLimitResult {
    const record = this.memoryStore.get(key)
    
    if (!record || record.resetTime < now) {
      this.memoryStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      })
      
      return {
        success: true,
        limit: maxRequests,
        remaining: maxRequests - 1,
        reset: new Date(now + windowMs),
      }
    }

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000)
      
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        reset: new Date(record.resetTime),
        retryAfter,
      }
    }

    record.count++
    
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - record.count,
      reset: new Date(record.resetTime),
    }
  }

  // Clean up old entries periodically
  startCleanup(intervalMs: number = 60000) {
    setInterval(() => {
      const now = Date.now()
      for (const [key, record] of this.memoryStore.entries()) {
        if (record.resetTime < now) {
          this.memoryStore.delete(key)
        }
      }
    }, intervalMs)
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter()
