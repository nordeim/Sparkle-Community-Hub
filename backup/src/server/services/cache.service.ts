// src/server/services/cache.service.ts
import { Redis } from 'ioredis'

export class CacheService {
  private redis: Redis | null = null
  private localCache: Map<string, { value: any; expiry: number }> = new Map()

  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL)
      console.log('✅ Redis cache connected')
    } else {
      console.warn('⚠️  Redis not configured, using in-memory cache')
    }

    // Clean up expired entries every minute
    setInterval(() => this.cleanupLocalCache(), 60000)
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      // Try local cache first
      const local = this.localCache.get(key)
      if (local && local.expiry > Date.now()) {
        return local.value as T
      }

      // Try Redis if available
      if (this.redis) {
        const value = await this.redis.get(key)
        if (value) {
          const parsed = JSON.parse(value)
          // Store in local cache for faster access
          this.localCache.set(key, {
            value: parsed,
            expiry: Date.now() + 60000, // 1 minute local cache
          })
          return parsed as T
        }
      }

      return null
    } catch (error) {
      console.error('Cache get error:', error)
      return null
    }
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    try {
      const serialized = JSON.stringify(value)
      
      // Set in local cache
      this.localCache.set(key, {
        value,
        expiry: Date.now() + (ttl * 1000),
      })

      // Set in Redis if available
      if (this.redis) {
        await this.redis.setex(key, ttl, serialized)
      }
    } catch (error) {
      console.error('Cache set error:', error)
    }
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      // Clear from local cache
      const keysToDelete: string[] = []
      for (const key of this.localCache.keys()) {
        if (key.includes(pattern)) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach(key => this.localCache.delete(key))

      // Clear from Redis if available
      if (this.redis) {
        const keys = await this.redis.keys(`*${pattern}*`)
        if (keys.length > 0) {
          await this.redis.del(...keys)
        }
      }
    } catch (error) {
      console.error('Cache invalidate error:', error)
    }
  }

  async flush(): Promise<void> {
    try {
      this.localCache.clear()
      if (this.redis) {
        await this.redis.flushdb()
      }
    } catch (error) {
      console.error('Cache flush error:', error)
    }
  }

  private cleanupLocalCache() {
    const now = Date.now()
    const keysToDelete: string[] = []
    
    for (const [key, data] of this.localCache.entries()) {
      if (data.expiry <= now) {
        keysToDelete.push(key)
      }
    }
    
    keysToDelete.forEach(key => this.localCache.delete(key))
  }
}
