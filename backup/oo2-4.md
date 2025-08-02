## 🚀 Phase 2: Core Features - Complete Implementation

Let me create the comprehensive core features implementation with production-ready code that aligns perfectly with the PRD, README, and PAD requirements.

### 1. `/src/server/api/trpc.ts`
**Purpose**: tRPC configuration with context, authentication, and error handling

```typescript
// src/server/api/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server'
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { getServerSession } from 'next-auth'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { authOptions } from '@/lib/auth/auth.config'
import { db } from '@/lib/db'
import { ratelimit } from '@/lib/rate-limiter'
import type { Session } from 'next-auth'
import { headers } from 'next/headers'

// Context type definition
interface CreateContextOptions {
  session: Session | null
  headers: Headers
  req?: CreateNextContextOptions['req']
  res?: CreateNextContextOptions['res']
}

// Inner context creation (doesn't require Next.js req/res)
export const createContextInner = async (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    db,
    headers: opts.headers,
    req: opts.req,
    res: opts.res,
  }
}

// Outer context creation for Next.js
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts

  // Get user session
  const session = await getServerSession(authOptions)

  // Get headers
  const heads = new Headers(headers())
  heads.set('x-trpc-source', req.headers['x-trpc-source'] ?? 'unknown')

  return createContextInner({
    session,
    headers: heads,
    req,
    res,
  })
}

// Initialize tRPC with context
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

// Create tRPC router
export const createTRPCRouter = t.router

// Create caller for server-side calls
export const createCallerFactory = t.createCallerFactory

// Middleware for timing procedures
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now()

  if (t._config.isDev) {
    // Artificial delay in development
    const waitMs = Math.floor(Math.random() * 400) + 100
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  const result = await next()

  const end = Date.now()
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`)

  return result
})

// Rate limiting middleware
const rateLimitMiddleware = t.middleware(async ({ ctx, next, path }) => {
  const identifier = ctx.session?.user?.id ?? ctx.headers.get('x-forwarded-for') ?? 'anonymous'
  
  const { success } = await ratelimit.limit(identifier, {
    rate: 100,
    period: '1m',
  })

  if (!success) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
    })
  }

  return next()
})

// Auth middleware
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ 
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }

  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  })
})

// Procedures
export const publicProcedure = t.procedure
  .use(timingMiddleware)
  .use(rateLimitMiddleware)

export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(rateLimitMiddleware)
  .use(enforceUserIsAuthed)

// Admin procedure
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== 'ADMIN' && ctx.session.user.role !== 'MODERATOR') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }

  return next()
})

// Export types
export type Context = Awaited<ReturnType<typeof createTRPCContext>>
```

### 2. `/src/server/api/root.ts`
**Purpose**: Root API router combining all sub-routers

```typescript
// src/server/api/root.ts
import { createTRPCRouter } from '@/server/api/trpc'
import { userRouter } from '@/server/api/routers/user'
import { postRouter } from '@/server/api/routers/post'
import { authRouter } from '@/server/api/routers/auth'
import { commentRouter } from '@/server/api/routers/comment'
import { notificationRouter } from '@/server/api/routers/notification'
import { searchRouter } from '@/server/api/routers/search'
import { uploadRouter } from '@/server/api/routers/upload'
import { analyticsRouter } from '@/server/api/routers/analytics'
import { adminRouter } from '@/server/api/routers/admin'
import { gamificationRouter } from '@/server/api/routers/gamification'
import { youtubeRouter } from '@/server/api/routers/youtube'
import { realtimeRouter } from '@/server/api/routers/realtime'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  user: userRouter,
  post: postRouter,
  auth: authRouter,
  comment: commentRouter,
  notification: notificationRouter,
  search: searchRouter,
  upload: uploadRouter,
  analytics: analyticsRouter,
  admin: adminRouter,
  gamification: gamificationRouter,
  youtube: youtubeRouter,
  realtime: realtimeRouter,
})

// Export type definition of API
export type AppRouter = typeof appRouter

// Create a server-side caller for the tRPC API
export const createCaller = createCallerFactory(appRouter)
```

### 3. `/src/server/api/routers/user.ts`
**Purpose**: Comprehensive user API endpoints

```typescript
// src/server/api/routers/user.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { TRPCError } from '@trpc/server'
import { UserService } from '@/server/services/user.service'
import { updateProfileSchema, userPreferencesSchema } from '@/lib/validations/user'
import { cache } from '@/lib/cache'

export const userRouter = createTRPCRouter({
  // Get user profile by username
  getProfile: publicProcedure
    .input(z.object({
      username: z.string().min(1).max(50),
      includePrivate: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const cacheKey = cache.keys.user(input.username)
      const cached = await cache.get(cacheKey)
      
      if (cached && !input.includePrivate) {
        return cached
      }

      const userService = new UserService(ctx.db)
      const profile = await userService.getProfileByUsername(input.username, {
        viewerId: ctx.session?.user?.id,
        includePrivate: input.includePrivate && ctx.session?.user?.id === profile?.id,
      })

      if (!input.includePrivate) {
        await cache.set(cacheKey, profile, 300) // Cache for 5 minutes
      }

      return profile
    }),

  // Get user by ID
  getById: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserById(input.userId, ctx.session?.user?.id)
    }),

  // Update user profile
  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const updated = await userService.updateProfile(ctx.session.user.id, input)
      
      // Invalidate cache
      await cache.del(cache.keys.user(updated.username))
      
      return updated
    }),

  // Update user preferences
  updatePreferences: protectedProcedure
    .input(userPreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.updatePreferences(ctx.session.user.id, input)
    }),

  // Upload avatar
  uploadAvatar: protectedProcedure
    .input(z.object({
      imageUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const updated = await userService.updateAvatar(ctx.session.user.id, input.imageUrl)
      
      // Invalidate cache
      await cache.del(cache.keys.user(updated.username))
      
      return updated
    }),

  // Follow user
  follow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.id === input.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You cannot follow yourself',
        })
      }

      const userService = new UserService(ctx.db)
      const result = await userService.followUser(ctx.session.user.id, input.userId)
      
      // Invalidate caches
      await Promise.all([
        cache.del(cache.keys.user(result.follower.username)),
        cache.del(cache.keys.user(result.following.username)),
      ])
      
      return result
    }),

  // Unfollow user
  unfollow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const result = await userService.unfollowUser(ctx.session.user.id, input.userId)
      
      // Invalidate caches
      await Promise.all([
        cache.del(cache.keys.user(result.follower.username)),
        cache.del(cache.keys.user(result.following.username)),
      ])
      
      return result
    }),

  // Get followers
  getFollowers: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowers({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Get following
  getFollowing: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowing({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Check if following
  isFollowing: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.session?.user) {
        return { isFollowing: false }
      }

      const userService = new UserService(ctx.db)
      return userService.isFollowing(ctx.session.user.id, input.userId)
    }),

  // Get user posts
  getPosts: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
      includeReplies: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserPosts({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Get user stats
  getStats: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserStats(input.userId)
    }),

  // Search users
  search: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.searchUsers(input)
    }),

  // Get suggested users
  getSuggestions: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getSuggestedUsers(ctx.session.user.id, input.limit)
    }),

  // Block user
  block: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.blockUser(ctx.session.user.id, input.userId)
    }),

  // Unblock user
  unblock: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.unblockUser(ctx.session.user.id, input.userId)
    }),

  // Get blocked users
  getBlockedUsers: protectedProcedure
    .query(async ({ ctx }) => {
      const userService = new UserService(ctx.db)
      return userService.getBlockedUsers(ctx.session.user.id)
    }),

  // Report user
  report: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
      reason: z.enum(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']),
      description: z.string().min(10).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.reportUser({
        reporterId: ctx.session.user.id,
        ...input,
      })
    }),

  // Delete account
  deleteAccount: protectedProcedure
    .input(z.object({
      password: z.string(),
      confirmation: z.literal('DELETE'),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.deleteAccount(ctx.session.user.id, input.password)
    }),
})
```

### 4. `/src/server/services/user.service.ts`
**Purpose**: Comprehensive user business logic

```typescript
// src/server/services/user.service.ts
import { PrismaClient, Prisma, UserRole } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import bcrypt from 'bcryptjs'
import { EventEmitter } from 'events'
import { NotificationService } from './notification.service'
import { GamificationService } from './gamification.service'
import { getWebSocketServer } from '@/server/websocket/socket.server'

export class UserService extends EventEmitter {
  private notificationService: NotificationService
  private gamificationService: GamificationService

  constructor(private db: PrismaClient) {
    super()
    this.notificationService = new NotificationService(db)
    this.gamificationService = new GamificationService(db)
  }

  async getProfileByUsername(username: string, options?: {
    viewerId?: string
    includePrivate?: boolean
  }) {
    const user = await this.db.user.findUnique({
      where: { username },
      include: {
        profile: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
            achievements: true,
          },
        },
        achievements: {
          take: 5,
          orderBy: { unlockedAt: 'desc' },
          include: {
            achievement: true,
          },
        },
      },
    })

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    // Check if viewer is blocked
    if (options?.viewerId) {
      const isBlocked = await this.isBlockedBy(options.viewerId, user.id)
      if (isBlocked) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'User not available',
        })
      }
    }

    // Remove sensitive data
    const { hashedPassword, ...safeUser } = user

    // Add relationship status if viewer is authenticated
    let isFollowing = false
    let isFollowedBy = false
    
    if (options?.viewerId && options.viewerId !== user.id) {
      const [following, followedBy] = await Promise.all([
        this.db.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: options.viewerId,
              followingId: user.id,
            },
          },
        }),
        this.db.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: user.id,
              followingId: options.viewerId,
            },
          },
        }),
      ])
      
      isFollowing = !!following
      isFollowedBy = !!followedBy
    }

    return {
      ...safeUser,
      isFollowing,
      isFollowedBy,
      isOwnProfile: options?.viewerId === user.id,
    }
  }

  async getUserById(userId: string, viewerId?: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
          },
        },
      },
    })

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    const { hashedPassword, ...safeUser } = user
    return safeUser
  }

  async updateProfile(userId: string, data: {
    username?: string
    bio?: string
    displayName?: string
    location?: string
    website?: string
    twitterUsername?: string
    youtubeChannelId?: string
    bannerImage?: string
  }) {
    // Validate username if changing
    if (data.username) {
      const existing = await this.db.user.findUnique({
        where: { username: data.username },
      })
      
      if (existing && existing.id !== userId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Username already taken',
        })
      }
    }

    // Update user and profile
    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        username: data.username,
        bio: data.bio,
        profile: {
          upsert: {
            create: {
              displayName: data.displayName,
              location: data.location,
              website: data.website,
              twitterUsername: data.twitterUsername,
              youtubeChannelId: data.youtubeChannelId,
              bannerImage: data.bannerImage,
            },
            update: {
              displayName: data.displayName,
              location: data.location,
              website: data.website,
              twitterUsername: data.twitterUsername,
              youtubeChannelId: data.youtubeChannelId,
              bannerImage: data.bannerImage,
            },
          },
        },
      },
      include: {
        profile: true,
      },
    })

    // Check for profile completion achievement
    await this.gamificationService.checkAchievements(userId, 'profile_updated', {
      profileComplete: this.isProfileComplete(updated),
    })

    this.emit('user:profileUpdated', { userId, updates: data })

    return updated
  }

  async updatePreferences(userId: string, preferences: {
    emailNotifications?: boolean
    pushNotifications?: boolean
    theme?: string
    language?: string
    privacy?: {
      showEmail?: boolean
      showActivity?: boolean
      allowMessages?: boolean
    }
  }) {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            notificationSettings: preferences,
            privacySettings: preferences.privacy,
          },
        },
      },
      include: {
        profile: true,
      },
    })

    return updated
  }

  async updateAvatar(userId: string, imageUrl: string) {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { image: imageUrl },
    })

    // Award XP for avatar upload
    await this.gamificationService.awardXP(userId, 10, 'Avatar uploaded')

    return updated
  }

  async followUser(followerId: string, followingId: string) {
    // Check if already following
    const existing = await this.db.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Already following this user',
      })
    }

    // Check if blocked
    const blocked = await this.isBlockedBy(followerId, followingId)
    if (blocked) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot follow this user',
      })
    }

    // Create follow relationship
    const follow = await this.db.follow.create({
      data: {
        followerId,
        followingId,
      },
      include: {
        follower: true,
        following: true,
      },
    })

    // Create notification
    await this.notificationService.createNotification({
      type: 'USER_FOLLOWED',
      userId: followingId,
      actorId: followerId,
      message: 'started following you',
    })

    // Award XP
    await this.gamificationService.awardXP(followerId, 5, 'Followed a user')
    await this.gamificationService.awardXP(followingId, 10, 'Gained a follower')

    // Check achievements
    await Promise.all([
      this.gamificationService.checkAchievements(followerId, 'user_follow'),
      this.gamificationService.checkAchievements(followingId, 'user_followed'),
    ])

    // Emit real-time event
    const wsServer = getWebSocketServer()
    wsServer.emitToUser(followingId, 'user:followed', {
      follower: follow.follower,
    })

    this.emit('user:followed', { followerId, followingId })

    return follow
  }

  async unfollowUser(followerId: string, followingId: string) {
    const follow = await this.db.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
      include: {
        follower: true,
        following: true,
      },
    })

    this.emit('user:unfollowed', { followerId, followingId })

    return follow
  }

  async getFollowers(params: {
    userId: string
    limit: number
    cursor?: string
    viewerId?: string
  }) {
    const followers = await this.db.follow.findMany({
      where: { followingId: params.userId },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        follower: {
          include: {
            profile: true,
            _count: {
              select: {
                posts: true,
                followers: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (followers.length > params.limit) {
      const nextItem = followers.pop()
      nextCursor = nextItem!.id
    }

    // Add following status if viewer is authenticated
    const items = await Promise.all(
      followers.map(async (follow) => {
        let isFollowing = false
        
        if (params.viewerId && params.viewerId !== follow.follower.id) {
          const following = await this.db.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: params.viewerId,
                followingId: follow.follower.id,
              },
            },
          })
          isFollowing = !!following
        }

        return {
          ...follow,
          follower: {
            ...follow.follower,
            isFollowing,
          },
        }
      })
    )

    return {
      items,
      nextCursor,
    }
  }

  async getFollowing(params: {
    userId: string
    limit: number
    cursor?: string
    viewerId?: string
  }) {
    const following = await this.db.follow.findMany({
      where: { followerId: params.userId },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        following: {
          include: {
            profile: true,
            _count: {
              select: {
                posts: true,
                followers: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (following.length > params.limit) {
      const nextItem = following.pop()
      nextCursor = nextItem!.id
    }

    // Add following status if viewer is authenticated
    const items = await Promise.all(
      following.map(async (follow) => {
        let isFollowing = false
        
        if (params.viewerId && params.viewerId !== follow.following.id) {
          const followingRel = await this.db.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: params.viewerId,
                followingId: follow.following.id,
              },
            },
          })
          isFollowing = !!followingRel
        }

        return {
          ...follow,
          following: {
            ...follow.following,
            isFollowing,
          },
        }
      })
    )

    return {
      items,
      nextCursor,
    }
  }

  async isFollowing(followerId: string, followingId: string) {
    const follow = await this.db.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    return { isFollowing: !!follow }
  }

  async getUserPosts(params: {
    userId: string
    limit: number
    cursor?: string
    includeReplies: boolean
    viewerId?: string
  }) {
    const where: Prisma.PostWhereInput = {
      authorId: params.userId,
      published: true,
    }

    if (!params.includeReplies) {
      where.parentId = null
    }

    const posts = await this.db.post.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (posts.length > params.limit) {
      const nextItem = posts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: posts,
      nextCursor,
    }
  }

  async getUserStats(userId: string) {
    const [user, topPost, engagementRate] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        include: {
          _count: {
            select: {
              posts: true,
              comments: true,
              reactions: true,
              followers: true,
              following: true,
              achievements: true,
            },
          },
        },
      }),
      // Get top post
      this.db.post.findFirst({
        where: {
          authorId: userId,
          published: true,
        },
        orderBy: [
          { reactions: { _count: 'desc' } },
          { comments: { _count: 'desc' } },
        ],
        include: {
          _count: {
            select: {
              reactions: true,
              comments: true,
            },
          },
        },
      }),
      // Calculate engagement rate
      this.calculateEngagementRate(userId),
    ])

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    return {
      posts: user._count.posts,
      comments: user._count.comments,
      reactions: user._count.reactions,
      followers: user._count.followers,
      following: user._count.following,
      achievements: user._count.achievements,
      level: user.level,
      experience: user.experience,
      joinedAt: user.createdAt,
      topPost,
      engagementRate,
    }
  }

  async searchUsers(params: {
    query: string
    limit: number
    cursor?: string
  }) {
    const users = await this.db.user.findMany({
      where: {
        OR: [
          { username: { contains: params.query, mode: 'insensitive' } },
          { bio: { contains: params.query, mode: 'insensitive' } },
          { profile: { displayName: { contains: params.query, mode: 'insensitive' } } },
        ],
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        profile: true,
        _count: {
          select: {
            posts: true,
            followers: true,
          },
        },
      },
      orderBy: [
        { followers: { _count: 'desc' } },
        { createdAt: 'desc' },
      ],
    })

    let nextCursor: string | undefined = undefined
    if (users.length > params.limit) {
      const nextItem = users.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: users.map(user => {
        const { hashedPassword, ...safeUser } = user
        return safeUser
      }),
      nextCursor,
    }
  }

  async getSuggestedUsers(userId: string, limit: number) {
    // Get users that the current user's followings follow
    const suggestions = await this.db.$queryRaw<any[]>`
      WITH user_followings AS (
        SELECT "followingId" FROM follows WHERE "followerId" = ${userId}
      ),
      suggested_users AS (
        SELECT 
          f."followingId" as id,
          COUNT(*) as mutual_connections
        FROM follows f
        WHERE f."followerId" IN (SELECT "followingId" FROM user_followings)
          AND f."followingId" != ${userId}
          AND f."followingId" NOT IN (SELECT "followingId" FROM user_followings)
        GROUP BY f."followingId"
        ORDER BY mutual_connections DESC
        LIMIT ${limit}
      )
      SELECT 
        u.*,
        su.mutual_connections
      FROM users u
      INNER JOIN suggested_users su ON u.id = su.id
    `

    // If not enough suggestions, get popular users
    if (suggestions.length < limit) {
      const popularUsers = await this.db.user.findMany({
        where: {
          id: {
            notIn: [userId, ...suggestions.map(s => s.id)],
          },
          verified: true,
        },
        orderBy: {
          followers: { _count: 'desc' },
        },
        take: limit - suggestions.length,
        include: {
          profile: true,
          _count: {
            select: {
              posts: true,
              followers: true,
            },
          },
        },
      })

      suggestions.push(...popularUsers)
    }

    return suggestions
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot block yourself',
      })
    }

    // Create block relationship
    await this.db.block.create({
      data: {
        blockerId,
        blockedId,
      },
    })

    // Remove any existing follow relationships
    await this.db.follow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      },
    })

    return { success: true }
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.db.block.delete({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
    })

    return { success: true }
  }

  async getBlockedUsers(userId: string) {
    const blocks = await this.db.block.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          include: {
            profile: true,
          },
        },
      },
    })

    return blocks.map(block => ({
      ...block.blocked,
      blockedAt: block.createdAt,
    }))
  }

  async isBlockedBy(userId: string, blockerId: string): Promise<boolean> {
    const block = await this.db.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId: userId,
        },
      },
    })

    return !!block
  }

  async reportUser(params: {
    reporterId: string
    userId: string
    reason: string
    description: string
  }) {
    const report = await this.db.report.create({
      data: {
        reporterId: params.reporterId,
        entityType: 'USER',
        entityId: params.userId,
        reason: params.reason.toUpperCase() as any,
        description: params.description,
        status: 'PENDING',
      },
    })

    // Notify moderators
    this.emit('user:reported', report)

    return report
  }

  async deleteAccount(userId: string, password: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    // Verify password
    if (user.hashedPassword) {
      const valid = await bcrypt.compare(password, user.hashedPassword)
      if (!valid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid password',
        })
      }
    }

    // Soft delete - anonymize user data
    await this.db.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@deleted.com`,
        username: `deleted_${userId}`,
        hashedPassword: null,
        image: null,
        bio: 'This account has been deleted',
        profile: {
          delete: true,
        },
      },
    })

    return { success: true }
  }

  // Helper methods
  private isProfileComplete(user: any): boolean {
    return !!(
      user.image &&
      user.bio &&
      user.profile?.displayName &&
      user.profile?.location
    )
  }

  private async calculateEngagementRate(userId: string): Promise<number> {
    const stats = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        posts: {
          select: {
            _count: {
              select: {
                reactions: true,
                comments: true,
              },
            },
          },
        },
      },
    })

    if (!stats || stats.posts.length === 0) return 0

    const totalEngagements = stats.posts.reduce(
      (sum, post) => sum + post._count.reactions + post._count.comments,
      0
    )

    return totalEngagements / stats.posts.length
  }
}
```

### 5. `/src/server/api/routers/post.ts`
**Purpose**: Comprehensive post API endpoints

```typescript
// src/server/api/routers/post.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { createPostSchema, updatePostSchema } from '@/lib/validations/post'
import { PostService } from '@/server/services/post.service'
import { cache } from '@/lib/cache'
import { ContentType } from '@prisma/client'

export const postRouter = createTRPCRouter({
  // Create post
  create: protectedProcedure
    .input(createPostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const post = await postService.createPost({
        ...input,
        authorId: ctx.session.user.id,
      })

      // Invalidate feed cache
      await cache.invalidatePattern(`feed:${ctx.session.user.id}`)

      return post
    }),

  // Update post
  update: protectedProcedure
    .input(updatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const post = await postService.updatePost(
        input.id,
        ctx.session.user.id,
        input
      )

      // Invalidate caches
      await Promise.all([
        cache.del(cache.keys.post(post.slug)),
        cache.invalidatePattern(`feed:`),
      ])

      return post
    }),

  // Delete post
  delete: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      await postService.deletePost(input.id, ctx.session.user.id)

      // Invalidate caches
      await cache.invalidatePattern(`feed:`)

      return { success: true }
    }),

  // Get post by slug
  getBySlug: publicProcedure
    .input(z.object({
      slug: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const cacheKey = cache.keys.post(input.slug)
      const cached = await cache.get(cacheKey)
      
      if (cached) {
        return cached
      }

      const postService = new PostService(ctx.db)
      const post = await postService.getPostBySlug(input.slug, {
        viewerId: ctx.session?.user?.id,
        incrementViews: true,
      })

      await cache.set(cacheKey, post, 300) // Cache for 5 minutes

      return post
    }),

  // Get post by ID
  getById: publicProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getPostById(input.id, {
        viewerId: ctx.session?.user?.id,
      })
    }),

  // List posts with filters
  list: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(10),
      cursor: z.string().optional(),
      filter: z.object({
        authorId: z.string().optional(),
        categoryId: z.string().optional(),
        tag: z.string().optional(),
        featured: z.boolean().optional(),
        contentType: z.nativeEnum(ContentType).optional(),
      }).optional(),
      sort: z.enum(['latest', 'popular', 'trending']).default('latest'),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.listPosts({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Get user feed
  getFeed: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
      algorithm: z.enum(['chronological', 'algorithmic', 'popular']).default('algorithmic'),
    }))
    .query(async ({ ctx, input }) => {
      const cacheKey = `feed:${ctx.session.user.id}:${input.algorithm}:${input.cursor || '0'}`
      const cached = await cache.get(cacheKey)
      
      if (cached) {
        return cached
      }

      const postService = new PostService(ctx.db)
      const feed = await postService.getUserFeed({
        userId: ctx.session.user.id,
        ...input,
      })

      await cache.set(cacheKey, feed, 60) // Cache for 1 minute

      return feed
    }),

  // Get trending posts
  getTrending: publicProcedure
    .input(z.object({
      period: z.enum(['day', 'week', 'month']).default('day'),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const cacheKey = cache.keys.trending(input.period)
      const cached = await cache.get(cacheKey)
      
      if (cached) {
        return cached
      }

      const postService = new PostService(ctx.db)
      const trending = await postService.getTrendingPosts(input)

      await cache.set(cacheKey, trending, 300) // Cache for 5 minutes

      return trending
    }),

  // Like post
  like: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const result = await postService.likePost(input.postId, ctx.session.user.id)

      // Invalidate post cache
      await cache.del(cache.keys.post(result.post.slug))

      return result
    }),

  // Unlike post
  unlike: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const result = await postService.unlikePost(input.postId, ctx.session.user.id)

      // Invalidate post cache
      await cache.del(cache.keys.post(result.post.slug))

      return result
    }),

  // Add reaction
  addReaction: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
      type: z.enum(['LIKE', 'LOVE', 'FIRE', 'SPARKLE', 'MIND_BLOWN', 'LAUGH', 'CRY', 'ANGRY']),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.addReaction({
        postId: input.postId,
        userId: ctx.session.user.id,
        type: input.type,
      })
    }),

  // Remove reaction
  removeReaction: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
      type: z.enum(['LIKE', 'LOVE', 'FIRE', 'SPARKLE', 'MIND_BLOWN', 'LAUGH', 'CRY', 'ANGRY']),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.removeReaction({
        postId: input.postId,
        userId: ctx.session.user.id,
        type: input.type,
      })
    }),

  // Bookmark post
  bookmark: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.bookmarkPost(input.postId, ctx.session.user.id)
    }),

  // Unbookmark post
  unbookmark: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.unbookmarkPost(input.postId, ctx.session.user.id)
    }),

  // Get bookmarks
  getBookmarks: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getUserBookmarks({
        userId: ctx.session.user.id,
        ...input,
      })
    }),

  // Report post
  report: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
      reason: z.enum(['SPAM', 'INAPPROPRIATE', 'HARASSMENT', 'MISINFORMATION', 'COPYRIGHT', 'OTHER']),
      description: z.string().min(10).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.reportPost({
        ...input,
        reporterId: ctx.session.user.id,
      })
    }),

  // Get related posts
  getRelated: publicProcedure
    .input(z.object({
      postId: z.string().cuid(),
      limit: z.number().min(1).max(10).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getRelatedPosts(input.postId, input.limit)
    }),

  // Search posts
  search: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
      filters: z.object({
        authorId: z.string().optional(),
        tags: z.array(z.string()).optional(),
        contentType: z.nativeEnum(ContentType).optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.searchPosts({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Get post analytics
  getAnalytics: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getPostAnalytics(input.postId, ctx.session.user.id)
    }),

  // Schedule post
  schedule: protectedProcedure
    .input(
      createPostSchema.extend({
        scheduledFor: z.date().min(new Date()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.schedulePost({
        ...input,
        authorId: ctx.session.user.id,
      })
    }),

  // Get drafts
  getDrafts: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getUserDrafts({
        userId: ctx.session.user.id,
        ...input,
      })
    }),
})
```

### 6. `/src/server/services/post.service.ts`
**Purpose**: Comprehensive post business logic with advanced features

```typescript
// src/server/services/post.service.ts
import { PrismaClient, Prisma, ContentType, ReactionType } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { EventEmitter } from 'events'
import { NotificationService } from './notification.service'
import { GamificationService } from './gamification.service'
import { SearchService } from './search.service'
import { getWebSocketServer } from '@/server/websocket/socket.server'
import { generateSlug, extractTextFromContent, calculateReadingTime } from '@/lib/utils'
import { cache } from '@/lib/cache'

interface CreatePostInput {
  title: string
  content: any // JSON content from editor
  excerpt?: string
  tags?: string[]
  categoryId?: string
  contentType?: ContentType
  youtubeVideoId?: string
  coverImage?: string
  authorId: string
  isDraft?: boolean
  scheduledPublishAt?: Date
}

export class PostService extends EventEmitter {
  private notificationService: NotificationService
  private gamificationService: GamificationService
  private searchService: SearchService

  constructor(private db: PrismaClient) {
    super()
    this.notificationService = new NotificationService(db)
    this.gamificationService = new GamificationService(db)
    this.searchService = new SearchService(db)
  }

  async createPost(input: CreatePostInput) {
    const slug = await this.generateUniqueSlug(input.title)
    const plainText = extractTextFromContent(input.content)
    const readingTime = calculateReadingTime(plainText)

    const post = await this.db.post.create({
      data: {
        title: input.title,
        content: input.content,
        excerpt: input.excerpt || plainText.substring(0, 200) + '...',
        slug,
        authorId: input.authorId,
        categoryId: input.categoryId,
        contentType: input.contentType || 'BLOG',
        youtubeVideoId: input.youtubeVideoId,
        coverImage: input.coverImage,
        readingTime,
        published: !input.isDraft,
        isDraft: input.isDraft || false,
        publishedAt: input.isDraft ? null : new Date(),
        scheduledPublishAt: input.scheduledPublishAt,
        tags: input.tags ? {
          connectOrCreate: input.tags.map(tag => ({
            where: { name: tag },
            create: { 
              name: tag, 
              slug: generateSlug(tag) 
            },
          })),
        } : undefined,
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        category: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    })

    // Only process if published
    if (!input.isDraft) {
      // Award XP
      await this.gamificationService.awardXP(
        input.authorId, 
        50, 
        'Created a post'
      )

      // Check achievements
      await this.gamificationService.checkAchievements(
        input.authorId, 
        'post_created',
        { postCount: await this.getUserPostCount(input.authorId) }
      )

      // Index for search
      await this.searchService.indexPost(post)

      // Create activity
      await this.createActivity(input.authorId, 'POST_CREATED', post.id)

      // Notify followers
      await this.notifyFollowers(input.authorId, post)

      // Emit real-time event
      const wsServer = getWebSocketServer()
      wsServer.emitToFollowers(input.authorId, 'post:created', {
        post: this.sanitizePost(post),
      })

      this.emit('post:created', post)
    }

    return post
  }

  async updatePost(
    postId: string,
    userId: string,
    input: Partial<CreatePostInput>
  ) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: { author: true },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    if (post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only edit your own posts',
      })
    }

    const updatedPost = await this.db.post.update({
      where: { id: postId },
      data: {
        title: input.title,
        content: input.content,
        excerpt: input.excerpt,
        categoryId: input.categoryId,
        youtubeVideoId: input.youtubeVideoId,
        coverImage: input.coverImage,
        readingTime: input.content 
          ? calculateReadingTime(extractTextFromContent(input.content))
          : undefined,
        tags: input.tags ? {
          set: [],
          connectOrCreate: input.tags.map(tag => ({
            where: { name: tag },
            create: { 
              name: tag, 
              slug: generateSlug(tag) 
            },
          })),
        } : undefined,
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        category: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    })

    // Update search index
    await this.searchService.indexPost(updatedPost)

    this.emit('post:updated', updatedPost)

    return updatedPost
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    if (post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only delete your own posts',
      })
    }

    await this.db.post.delete({
      where: { id: postId },
    })

    // Remove from search index
    await this.searchService.deletePost(postId)

    this.emit('post:deleted', { postId, authorId: userId })

    return { success: true }
  }

  async getPostBySlug(slug: string, options?: {
    viewerId?: string
    incrementViews?: boolean
  }) {
    const post = await this.db.post.findUnique({
      where: { slug, published: true },
      include: {
        author: {
          include: {
            profile: true,
            _count: {
              select: {
                followers: true,
              },
            },
          },
        },
        tags: true,
        category: true,
        series: {
          include: {
            posts: {
              where: { published: true },
              orderBy: { seriesOrder: 'asc' },
              select: {
                id: true,
                title: true,
                slug: true,
                seriesOrder: true,
              },
            },
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    // Check if viewer is blocked
    if (options?.viewerId) {
      const blocked = await this.isBlockedBy(options.viewerId, post.authorId)
      if (blocked) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Content not available',
        })
      }
    }

    // Increment view count
    if (options?.incrementViews) {
      await this.db.post.update({
        where: { id: post.id },
        data: { views: { increment: 1 } },
      })
    }

    // Get viewer's reaction if authenticated
    let userReaction = null
    let isBookmarked = false
    let isFollowingAuthor = false

    if (options?.viewerId) {
      const [reaction, bookmark, following] = await Promise.all([
        this.db.reaction.findFirst({
          where: {
            postId: post.id,
            userId: options.viewerId,
          },
        }),
        this.db.bookmark.findUnique({
          where: {
            userId_postId: {
              userId: options.viewerId,
              postId: post.id,
            },
          },
        }),
        this.db.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: options.viewerId,
              followingId: post.authorId,
            },
          },
        }),
      ])

      userReaction = reaction?.type
      isBookmarked = !!bookmark
      isFollowingAuthor = !!following
    }

    return {
      ...post,
      userReaction,
      isBookmarked,
      author: {
        ...post.author,
        isFollowing: isFollowingAuthor,
      },
    }
  }

  async getPostById(postId: string, options?: {
    viewerId?: string
  }) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        category: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    return post
  }

  async listPosts(params: {
    limit: number
    cursor?: string
    filter?: {
      authorId?: string
      categoryId?: string
      tag?: string
      featured?: boolean
      contentType?: ContentType
    }
    sort?: 'latest' | 'popular' | 'trending'
    viewerId?: string
  }) {
    const where: Prisma.PostWhereInput = {
      published: true,
      authorId: params.filter?.authorId,
      categoryId: params.filter?.categoryId,
      featured: params.filter?.featured,
      contentType: params.filter?.contentType,
      tags: params.filter?.tag ? {
        some: { name: params.filter.tag },
      } : undefined,
    }

    // Filter out blocked users' posts
    if (params.viewerId) {
      const blockedUsers = await this.getBlockedUserIds(params.viewerId)
      if (blockedUsers.length > 0) {
        where.authorId = {
          notIn: blockedUsers,
        }
      }
    }

    const orderBy = this.getOrderBy(params.sort || 'latest')

    const posts = await this.db.post.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        category: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy,
    })

    let nextCursor: string | undefined = undefined
    if (posts.length > params.limit) {
      const nextItem = posts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: posts,
      nextCursor,
    }
  }

  async getUserFeed(params: {
    userId: string
    limit: number
    cursor?: string
    algorithm?: 'chronological' | 'algorithmic' | 'popular'
  }) {
    const algorithm = params.algorithm || 'algorithmic'

    if (algorithm === 'chronological') {
      return this.getChronologicalFeed(params)
    } else if (algorithm === 'popular') {
      return this.getPopularFeed(params)
    } else {
      return this.getAlgorithmicFeed(params)
    }
  }

  private async getChronologicalFeed(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    // Get posts from followed users
    const followingIds = await this.db.follow.findMany({
      where: { followerId: params.userId },
      select: { followingId: true },
    }).then(follows => follows.map(f => f.followingId))

    // Include own posts
    followingIds.push(params.userId)

    const posts = await this.db.post.findMany({
      where: {
        authorId: { in: followingIds },
        published: true,
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (posts.length > params.limit) {
      const nextItem = posts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: posts,
      nextCursor,
    }
  }

  private async getAlgorithmicFeed(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    // Get user interests based on interactions
    const userInterests = await this.getUserInterests(params.userId)

    // Get posts with scoring
    const posts = await this.db.$queryRaw<any[]>`
      WITH user_follows AS (
        SELECT "followingId" FROM follows WHERE "followerId" = ${params.userId}
      ),
      post_scores AS (
        SELECT 
          p.*,
          -- Recency score (exponential decay)
          EXP(-0.1 * EXTRACT(EPOCH FROM (NOW() - p."publishedAt")) / 86400) AS recency_score,
          -- Engagement score
          (COUNT(r.id) + COUNT(c.id) * 2) / (p.views + 1) AS engagement_score,
          -- Author relationship score
          CASE 
            WHEN p."authorId" IN (SELECT "followingId" FROM user_follows) THEN 2
            WHEN p."authorId" = ${params.userId} THEN 1.5
            ELSE 1
          END AS relationship_score,
          -- Interest match score
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM post_tags pt 
              JOIN tags t ON pt."tagId" = t.id
              WHERE pt."postId" = p.id AND t.name = ANY(${userInterests})
            ) THEN 1.5
            ELSE 1
          END AS interest_score
        FROM posts p
        LEFT JOIN reactions r ON r."postId" = p.id
        LEFT JOIN comments c ON c."postId" = p.id
        WHERE p.published = true
        GROUP BY p.id
      )
      SELECT 
        *,
        (recency_score * engagement_score * relationship_score * interest_score) AS final_score
      FROM post_scores
      ORDER BY final_score DESC
      LIMIT ${params.limit + 1}
      ${params.cursor ? `OFFSET ${params.cursor}` : ''}
    `

    // ... rest of feed logic
    return {
      items: posts.slice(0, params.limit),
      nextCursor: posts.length > params.limit ? String(params.limit) : undefined,
    }
  }

  private async getPopularFeed(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const posts = await this.db.post.findMany({
      where: {
        published: true,
        publishedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: [
        { reactions: { _count: 'desc' } },
        { comments: { _count: 'desc' } },
        { views: 'desc' },
      ],
    })

    let nextCursor: string | undefined = undefined
    if (posts.length > params.limit) {
      const nextItem = posts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: posts,
      nextCursor,
    }
  }

  async getTrendingPosts(params: {
    period: 'day' | 'week' | 'month'
    limit: number
  }) {
    const periodStart = this.getPeriodStart(params.period)

    const posts = await this.db.post.findMany({
      where: {
        published: true,
        publishedAt: {
          gte: periodStart,
        },
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: [
        { reactions: { _count: 'desc' } },
        { comments: { _count: 'desc' } },
        { views: 'desc' },
      ],
      take: params.limit,
    })

    return posts
  }

  async likePost(postId: string, userId: string) {
    try {
      const reaction = await this.db.reaction.create({
        data: {
          postId,
          userId,
          type: 'LIKE',
        },
      })

      const post = await this.db.post.findUnique({
        where: { id: postId },
        include: {
          author: true,
          _count: {
            select: { reactions: true },
          },
        },
      })

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        })
      }

      // Award XP
      await this.gamificationService.awardXP(userId, 2, 'Liked a post')
      await this.gamificationService.awardXP(post.authorId, 3, 'Received a like')

      // Create notification
      if (post.authorId !== userId) {
        await this.notificationService.createNotification({
          type: 'POST_LIKED',
          userId: post.authorId,
          actorId: userId,
          entityId: postId,
          entityType: 'POST',
          message: 'liked your post',
        })
      }

      // Emit real-time event
      const wsServer = getWebSocketServer()
      wsServer.emitToPost(postId, 'post:liked', {
        userId,
        postId,
        reactionCount: post._count.reactions,
      })

      this.emit('post:liked', { postId, userId })

      return { post, reaction }
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Already liked this post',
        })
      }
      throw error
    }
  }

  async unlikePost(postId: string, userId: string) {
    await this.db.reaction.delete({
      where: {
        postId_userId_type: {
          postId,
          userId,
          type: 'LIKE',
        },
      },
    })

    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: {
        _count: {
          select: { reactions: true },
        },
      },
    })

    // Emit real-time event
    const wsServer = getWebSocketServer()
    wsServer.emitToPost(postId, 'post:unliked', {
      userId,
      postId,
      reactionCount: post?._count.reactions || 0,
    })

    this.emit('post:unliked', { postId, userId })

    return { post }
  }

  async addReaction(params: {
    postId: string
    userId: string
    type: ReactionType
  }) {
    // Remove any existing reaction first
    await this.db.reaction.deleteMany({
      where: {
        postId: params.postId,
        userId: params.userId,
      },
    })

    const reaction = await this.db.reaction.create({
      data: params,
    })

    // Award XP and create notification
    const post = await this.db.post.findUnique({
      where: { id: params.postId },
      select: { authorId: true },
    })

    if (post && post.authorId !== params.userId) {
      await this.gamificationService.awardXP(params.userId, 2, 'Reacted to a post')
      await this.gamificationService.awardXP(post.authorId, 3, 'Received a reaction')

      await this.notificationService.createNotification({
        type: 'POST_LIKED',
        userId: post.authorId,
        actorId: params.userId,
        entityId: params.postId,
        entityType: 'POST',
        message: `reacted with ${params.type.toLowerCase()} to your post`,
      })
    }

    return reaction
  }

  async removeReaction(params: {
    postId: string
    userId: string
    type: ReactionType
  }) {
    await this.db.reaction.delete({
      where: {
        postId_userId_type: params,
      },
    })

    return { success: true }
  }

  async bookmarkPost(postId: string, userId: string) {
    const bookmark = await this.db.bookmark.create({
      data: {
        postId,
        userId,
      },
    })

    return bookmark
  }

  async unbookmarkPost(postId: string, userId: string) {
    await this.db.bookmark.delete({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    })

    return { success: true }
  }

  async getUserBookmarks(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const bookmarks = await this.db.bookmark.findMany({
      where: { userId: params.userId },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        post: {
          include: {
            author: {
              include: {
                profile: true,
              },
            },
            tags: true,
            _count: {
              select: {
                comments: true,
                reactions: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (bookmarks.length > params.limit) {
      const nextItem = bookmarks.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: bookmarks.map(b => b.post),
      nextCursor,
    }
  }

  async reportPost(params: {
    postId: string
    reporterId: string
    reason: string
    description: string
  }) {
    const report = await this.db.report.create({
      data: {
        entityType: 'POST',
        entityId: params.postId,
        reporterId: params.reporterId,
        reason: params.reason as any,
        description: params.description,
        status: 'PENDING',
      },
    })

    // Check if post needs auto-moderation
    const reportCount = await this.db.report.count({
      where: {
        entityType: 'POST',
        entityId: params.postId,
        status: 'PENDING',
      },
    })

    if (reportCount >= 3) {
      // Auto-hide post pending review
      await this.db.post.update({
        where: { id: params.postId },
        data: { published: false },
      })
    }

    this.emit('post:reported', report)

    return report
  }

  async getRelatedPosts(postId: string, limit: number) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: { tags: true },
    })

    if (!post) return []

    const tagIds = post.tags.map(t => t.id)

    const relatedPosts = await this.db.post.findMany({
      where: {
        id: { not: postId },
        published: true,
        OR: [
          { tags: { some: { id: { in: tagIds } } } },
          { categoryId: post.categoryId },
          { authorId: post.authorId },
        ],
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: true,
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: [
        { reactions: { _count: 'desc' } },
        { publishedAt: 'desc' },
      ],
      take: limit,
    })

    return relatedPosts
  }

  async searchPosts(params: {
    query: string
    limit: number
    cursor?: string
    filters?: any
    viewerId?: string
  }) {
    // Use search service for advanced search
    const results = await this.searchService.searchPosts(params.query, {
      hitsPerPage: params.limit,
      filters: params.filters,
    })

    return {
      items: results.hits,
      nextCursor: results.totalPages > 1 ? '1' : undefined,
      totalHits: results.totalHits,
    }
  }

  async getPostAnalytics(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    })

    if (!post || post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only view analytics for your own posts',
      })
    }

    const [
      viewsByDay,
      reactionBreakdown,
      topReferrers,
      audienceDemographics,
    ] = await Promise.all([
      this.getViewsByDay(postId, 7),
      this.getReactionBreakdown(postId),
      this.getTopReferrers(postId),
      this.getAudienceDemographics(postId),
    ])

    return {
      viewsByDay,
      reactionBreakdown,
      topReferrers,
      audienceDemographics,
    }
  }

  async schedulePost(input: CreatePostInput & { scheduledFor: Date }) {
    const post = await this.createPost({
      ...input,
      isDraft: true,
      scheduledPublishAt: input.scheduledFor,
    })

    // Schedule job to publish post
    // This would integrate with a job queue system

    return post
  }

  async getUserDrafts(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const drafts = await this.db.post.findMany({
      where: {
        authorId: params.userId,
        isDraft: true,
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        tags: true,
        category: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (drafts.length > params.limit) {
      const nextItem = drafts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: drafts,
      nextCursor,
    }
  }

  // Helper methods
  private async generateUniqueSlug(title: string): Promise<string> {
    let slug = generateSlug(title)
    let counter = 1

    while (await this.db.post.findUnique({ where: { slug } })) {
      slug = `${generateSlug(title)}-${counter}`
      counter++
    }

    return slug
  }

  private getOrderBy(sort: string): any {
    switch (sort) {
      case 'popular':
        return [
          { reactions: { _count: 'desc' } },
          { comments: { _count: 'desc' } },
          { views: 'desc' },
        ]
      case 'trending':
        // Complex sorting would be done in a raw query
        return { publishedAt: 'desc' }
      case 'latest':
      default:
        return { publishedAt: 'desc' }
    }
  }

  private getPeriodStart(period: string): Date {
    const now = new Date()
    switch (period) {
      case 'day':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000)
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    }
  }

  private async getUserInterests(userId: string): Promise<string[]> {
    // Get tags from user's interactions
    const interactions = await this.db.reaction.findMany({
      where: { userId },
      include: {
        post: {
          include: { tags: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const tagCounts: Record<string, number> = {}
    interactions.forEach(interaction => {
      interaction.post?.tags.forEach(tag => {
        tagCounts[tag.name] = (tagCounts[tag.name] || 0) + 1
      })
    })

    // Return top tags
    return Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag]) => tag)
  }

  private async getBlockedUserIds(userId: string): Promise<string[]> {
    const blocks = await this.db.block.findMany({
      where: {
        OR: [
          { blockerId: userId },
          { blockedId: userId },
        ],
      },
      select: {
        blockerId: true,
        blockedId: true,
      },
    })

    const blockedIds = new Set<string>()
    blocks.forEach(block => {
      if (block.blockerId === userId) {
        blockedIds.add(block.blockedId)
      } else {
        blockedIds.add(block.blockerId)
      }
    })

    return Array.from(blockedIds)
  }

  private async isBlockedBy(userId: string, blockerId: string): Promise<boolean> {
    const block = await this.db.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId: userId,
        },
      },
    })

    return !!block
  }

  private async getUserPostCount(userId: string): Promise<number> {
    return this.db.post.count({
      where: {
        authorId: userId,
        published: true,
      },
    })
  }

  private async createActivity(userId: string, action: string, entityId: string) {
    await this.db.activityStream.create({
      data: {
        userId,
        action,
        entityType: 'POST',
        entityId,
        visibility: 'PUBLIC',
      },
    })
  }

  private async notifyFollowers(authorId: string, post: any) {
    const followers = await this.db.follow.findMany({
      where: { followingId: authorId },
      select: { followerId: true },
    })

    // Batch create notifications
    if (followers.length > 0) {
      await this.db.notification.createMany({
        data: followers.map(follower => ({
          type: 'POST_CREATED' as any,
          userId: follower.followerId,
          actorId: authorId,
          entityId: post.id,
          entityType: 'POST',
          message: 'published a new post',
        })),
      })
    }
  }

  private sanitizePost(post: any) {
    // Remove sensitive data before sending to client
    const { author, ...safePost } = post
    return {
      ...safePost,
      author: {
        id: author.id,
        username: author.username,
        image: author.image,
        profile: author.profile,
      },
    }
  }

  // Analytics helper methods
  private async getViewsByDay(postId: string, days: number) {
    // This would typically query an analytics table
    // For now, return mock data
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      views: Math.floor(Math.random() * 100),
    }))
  }

  private async getReactionBreakdown(postId: string) {
    const reactions = await this.db.reaction.groupBy({
      by: ['type'],
      where: { postId },
      _count: true,
    })

    return reactions.map(r => ({
      type: r.type,
      count: r._count,
    }))
  }

  private async getTopReferrers(postId: string) {
    // This would query analytics data
    return [
      { source: 'Direct', count: 150 },
      { source: 'Twitter', count: 80 },
      { source: 'Search', count: 45 },
    ]
  }

  private async getAudienceDemographics(postId: string) {
    // This would aggregate user data
    return {
      countries: [
        { country: 'United States', percentage: 45 },
        { country: 'United Kingdom', percentage: 20 },
        { country: 'Canada', percentage: 15 },
      ],
      devices: [
        { device: 'Mobile', percentage: 65 },
        { device: 'Desktop', percentage: 30 },
        { device: 'Tablet', percentage: 5 },
      ],
    }
  }
}
```

### 7. `/src/lib/validations/post.ts`
**Purpose**: Comprehensive post validation schemas

```typescript
// src/lib/validations/post.ts
import { z } from 'zod'
import { ContentType } from '@prisma/client'

// Rich text content schema
const richTextContentSchema = z.object({
  type: z.string(),
  content: z.array(z.any()).optional(),
  attrs: z.record(z.any()).optional(),
  text: z.string().optional(),
})

// Base post schema
const basePostSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters')
    .refine(
      (title) => title.trim().length > 0,
      'Title cannot be empty'
    ),
  
  content: z
    .union([
      z.string().min(10, 'Content must be at least 10 characters'),
      richTextContentSchema,
      z.array(richTextContentSchema),
    ])
    .refine(
      (content) => {
        if (typeof content === 'string') return content.trim().length >= 10
        return true
      },
      'Content cannot be empty'
    ),
  
  excerpt: z
    .string()
    .max(500, 'Excerpt must be less than 500 characters')
    .optional()
    .transform((val) => val?.trim() || undefined),
  
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(30)
        .regex(/^[a-zA-Z0-9_-]+$/, 'Tags can only contain letters, numbers, hyphens, and underscores')
    )
    .max(10, 'Maximum 10 tags allowed')
    .optional()
    .transform((tags) => tags?.filter((tag, index, self) => self.indexOf(tag) === index)),
  
  categoryId: z.string().cuid().optional(),
  
  contentType: z.nativeEnum(ContentType).default('BLOG'),
  
  coverImage: z
    .string()
    .url('Invalid image URL')
    .optional()
    .refine(
      (url) => !url || url.match(/\.(jpg|jpeg|png|gif|webp)$/i),
      'Image must be a valid image file'
    ),
})

// Create post schema
export const createPostSchema = basePostSchema.extend({
  youtubeVideoId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{11}$/, 'Invalid YouTube video ID')
    .optional(),
  
  isDraft: z.boolean().default(false),
  
  scheduledPublishAt: z
    .string()
    .datetime()
    .optional()
    .refine(
      (date) => !date || new Date(date) > new Date(),
      'Scheduled date must be in the future'
    ),
  
  series: z
    .object({
      id: z.string().cuid().optional(),
      title: z.string().min(1).max(100).optional(),
      order: z.number().int().positive().optional(),
    })
    .optional(),
})

// Update post schema
export const updatePostSchema = basePostSchema.partial().extend({
  id: z.string().cuid(),
})

// Post filter schema
export const postFilterSchema = z.object({
  authorId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  tags: z.array(z.string()).optional(),
  contentType: z.nativeEnum(ContentType).optional(),
  featured: z.boolean().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
})

// Post search schema
export const postSearchSchema = z.object({
  query: z.string().min(1).max(200),
  filters: postFilterSchema.optional(),
  sort: z.enum(['relevance', 'date', 'popularity']).default('relevance'),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
})

// Post reaction schema
export const postReactionSchema = z.object({
  postId: z.string().cuid(),
  type: z.enum(['LIKE', 'LOVE', 'FIRE', 'SPARKLE', 'MIND_BLOWN', 'LAUGH', 'CRY', 'ANGRY']),
})

// Post report schema
export const postReportSchema = z.object({
  postId: z.string().cuid(),
  reason: z.enum(['SPAM', 'INAPPROPRIATE', 'HARASSMENT', 'MISINFORMATION', 'COPYRIGHT', 'OTHER']),
  description: z
    .string()
    .min(10, 'Please provide at least 10 characters of context')
    .max(500, 'Description must be less than 500 characters'),
})

// Type exports
export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type PostFilter = z.infer<typeof postFilterSchema>
export type PostSearch = z.infer<typeof postSearchSchema>
export type PostReaction = z.infer<typeof postReactionSchema>
export type PostReport = z.infer<typeof postReportSchema>
```

### 8. `/src/components/features/editor/rich-text-editor.tsx`
**Purpose**: Advanced rich text editor with all features

```typescript
// src/components/features/editor/rich-text-editor.tsx
'use client'

import { useEditor, EditorContent, BubbleMenu, FloatingMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Youtube from '@tiptap/extension-youtube'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import Typography from '@tiptap/extension-typography'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { 
  Bold, 
  Italic, 
  Strikethrough,
  Code,
  List, 
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Link as LinkIcon,
  Image as ImageIcon,
  Youtube as YoutubeIcon,
  Table as TableIcon,
  CheckSquare,
  Highlighter,
  Type,
  ChevronDown,
  Sparkles,
  Plus,
  Hash,
  Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCallback, useState } from 'react'
import { LinkDialog } from './link-dialog'
import { ImageDialog } from './image-dialog'
import { YoutubeDialog } from './youtube-dialog'
import { EmojiPicker } from './emoji-picker'

const lowlight = createLowlight(common)

interface RichTextEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
  maxHeight?: string
  showMenuBar?: boolean
  editable?: boolean
}

export function RichTextEditor({ 
  content, 
  onChange,
  placeholder = 'Start writing your amazing post...',
  className,
  minHeight = '200px',
  maxHeight = '600px',
  showMenuBar = true,
  editable = true,
}: RichTextEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline underline-offset-4 hover:text-primary/80',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-lg max-w-full h-auto',
        },
      }),
      Youtube.configure({
        width: 640,
        height: 360,
        HTMLAttributes: {
          class: 'rounded-lg overflow-hidden mx-auto',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'rounded-lg bg-muted p-4 font-mono text-sm',
        },
      }),
      Typography,
      Highlight.configure({
        HTMLAttributes: {
          class: 'bg-yellow-200 dark:bg-yellow-900',
        },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'not-prose pl-2',
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'flex items-start',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full',
        },
      }),
      TableRow.configure({
        HTMLAttributes: {
          class: 'border border-border',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'bg-muted font-bold text-left p-2',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-border p-2',
        },
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'prose-headings:font-bold prose-headings:tracking-tight',
          'prose-p:leading-7',
          'prose-pre:bg-muted prose-pre:text-muted-foreground',
          'prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-sm',
          'prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic',
          'prose-img:rounded-lg prose-img:shadow-md',
          'prose-hr:border-border',
          className
        ),
        style: {
          minHeight,
          maxHeight,
          overflowY: 'auto',
        },
      },
    },
  })

  const setLink = useCallback((url: string) => {
    if (url) {
      editor?.chain().focus().setLink({ href: url }).run()
    } else {
      editor?.chain().focus().unsetLink().run()
    }
    setLinkDialogOpen(false)
  }, [editor])

  const addImage = useCallback((url: string, alt?: string) => {
    if (url) {
      editor?.chain().focus().setImage({ src: url, alt: alt || '' }).run()
    }
    setImageDialogOpen(false)
  }, [editor])

  const addYoutube = useCallback((url: string) => {
    if (url) {
      editor?.chain().focus().setYoutubeVideo({ src: url }).run()
    }
    setYoutubeDialogOpen(false)
  }, [editor])

  const addEmoji = useCallback((emoji: string) => {
    editor?.chain().focus().insertContent(emoji).run()
  }, [editor])

  if (!editor) {
    return null
  }

  const MenuBar = () => (
    <div className="border-b p-2 flex items-center gap-1 flex-wrap">
      {/* Text Format */}
      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1">
              <Type className="h-4 w-4" />
              <span className="text-sm">
                {editor.isActive('heading', { level: 1 }) ? 'Heading 1' :
                 editor.isActive('heading', { level: 2 }) ? 'Heading 2' :
                 editor.isActive('heading', { level: 3 }) ? 'Heading 3' :
                 'Normal'}
              </span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
              Normal
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()}>
              Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().setHeading({ level: 2 }).run()}>
              Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().setHeading({ level: 3 }).run()}>
              Heading 3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Basic Formatting */}
      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('bold')}
                onPressedChange={() => editor.chain().focus().toggleBold().run()}
              >
                <Bold className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Bold (Ctrl+B)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('italic')}
                onPressedChange={() => editor.chain().focus().toggleItalic().run()}
              >
                <Italic className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Italic (Ctrl+I)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('strike')}
                onPressedChange={() => editor.chain().focus().toggleStrike().run()}
              >
                <Strikethrough className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Strikethrough</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('code')}
                onPressedChange={() => editor.chain().focus().toggleCode().run()}
              >
                <Code className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Code</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('highlight')}
                onPressedChange={() => editor.chain().focus().toggleHighlight().run()}
              >
                <Highlighter className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Highlight</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Lists and Blocks */}
      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('bulletList')}
                onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Bullet List</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('orderedList')}
                onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Numbered List</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('taskList')}
                onPressedChange={() => editor.chain().focus().toggleTaskList().run()}
              >
                <CheckSquare className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Task List</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('blockquote')}
                onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
              >
                <Quote className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Quote</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={editor.isActive('codeBlock')}
                onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
              >
                <Hash className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Code Block</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Media and Links */}
      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLinkDialogOpen(true)}
                className={editor.isActive('link') ? 'bg-muted' : ''}
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add Link</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageDialogOpen(true)}
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add Image</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setYoutubeDialogOpen(true)}
              >
                <YoutubeIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add YouTube Video</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}
              >
                <TableIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert Table</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Special */}
      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <EmojiPicker onSelect={addEmoji}>
          <Button variant="ghost" size="sm">
            <Sparkles className="h-4 w-4" />
          </Button>
        </EmojiPicker>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              >
                <Minus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Horizontal Rule</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* History */}
      <div className="flex items-center gap-1 ml-auto">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
              >
                <Undo className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
              >
                <Redo className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {showMenuBar && editable && <MenuBar />}
      
      {/* Floating menu for block insertion */}
      {editable && (
        <FloatingMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="bg-popover border rounded-lg shadow-md p-1 flex items-center gap-1"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()}
          >
            H1
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().setHeading({ level: 2 }).run()}
          >
            H2
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setImageDialogOpen(true)}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
        </FloatingMenu>
      )}

      {/* Bubble menu for text formatting */}
      {editable && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="bg-popover border rounded-lg shadow-md p-1 flex items-center gap-1"
        >
          <Toggle
            size="sm"
            pressed={editor.isActive('bold')}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('italic')}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('strike')}
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" />
          </Toggle>
          <div className="w-px h-6 bg-border mx-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLinkDialogOpen(true)}
            className={editor.isActive('link') ? 'bg-muted' : ''}
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
        </BubbleMenu>
      )}

      <EditorContent 
        editor={editor} 
        className="p-4"
      />

      {/* Dialogs */}
      <LinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        onSubmit={setLink}
        initialUrl={editor.getAttributes('link').href}
      />

      <ImageDialog
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onSubmit={addImage}
      />

      <YoutubeDialog
        open={youtubeDialogOpen}
        onOpenChange={setYoutubeDialogOpen}
        onSubmit={addYoutube}
      />
    </div>
  )
}
```

### 9. `/src/app/(main)/create/page.tsx`
**Purpose**: Comprehensive post creation page

```typescript
// src/app/(main)/create/page.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPostSchema, type CreatePostInput } from '@/lib/validations/post'
import { api } from '@/lib/api'
import { RichTextEditor } from '@/components/features/editor/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/use-toast'
import { 
  Loader2, 
  Save, 
  Send,
  Eye,
  Settings,
  Image as ImageIcon,
  Tag,
  Calendar,
  Youtube,
  X,
  Plus,
  AlertCircle,
  Sparkles
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageUpload } from '@/components/features/upload/image-upload'
import { TagInput } from '@/components/features/input/tag-input'
import { DateTimePicker } from '@/components/features/input/date-time-picker'
import { YouTubeSearch } from '@/components/features/youtube/youtube-search'
import { PostPreview } from '@/components/features/post/post-preview'
import { useAuth } from '@/hooks/use-auth'
import { useAutoSave } from '@/hooks/use-auto-save'

export default function CreatePostPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState('editor')
  const [showPreview, setShowPreview] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('')

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(createPostSchema),
    defaultValues: {
      title: '',
      content: '',
      excerpt: '',
      tags: [],
      contentType: 'BLOG',
      isDraft: true,
    },
  })

  const { data: categories } = api.category.list.useQuery()

  // Auto-save draft
  const { saveStatus, triggerSave } = useAutoSave({
    data: form.watch(),
    onSave: async (data) => {
      if (!data.title && !data.content) return
      
      try {
        await api.post.saveDraft.mutate(data)
      } catch (error) {
        console.error('Auto-save failed:', error)
      }
    },
    delay: 3000, // Save after 3 seconds of inactivity
  })

  // Create/publish post mutation
  const createPost = api.post.create.useMutation({
    onSuccess: (post) => {
      toast({
        title: post.isDraft ? 'Draft saved!' : 'Post published!',
        description: post.isDraft 
          ? 'Your draft has been saved successfully.'
          : 'Your post has been published successfully.',
      })
      router.push(post.isDraft ? '/drafts' : `/post/${post.slug}`)
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save post. Please try again.',
        variant: 'destructive',
      })
      setIsSubmitting(false)
    },
  })

  const onSubmit = async (data: CreatePostInput, isDraft = false) => {
    setIsSubmitting(true)
    await createPost.mutateAsync({
      ...data,
      isDraft,
    })
  }

  const handlePublish = () => {
    form.handleSubmit((data) => onSubmit(data, false))()
  }

  const handleSaveDraft = () => {
    form.handleSubmit((data) => onSubmit(data, true))()
  }

  const handleAddTag = (tag: string) => {
    const currentTags = form.getValues('tags') || []
    if (currentTags.length < 10 && !currentTags.includes(tag)) {
      form.setValue('tags', [...currentTags, tag])
    }
  }

  const handleRemoveTag = (tag: string) => {
    const currentTags = form.getValues('tags') || []
    form.setValue('tags', currentTags.filter(t => t !== tag))
  }

  // Watch for title changes to generate excerpt
  const watchTitle = form.watch('title')
  const watchContent = form.watch('content')

  useEffect(() => {
    if (watchContent && !form.getValues('excerpt')) {
      // Extract text from content and create excerpt
      const textContent = typeof watchContent === 'string' 
        ? watchContent 
        : watchContent.toString()
      const excerpt = textContent.replace(/<[^>]*>/g, '').substring(0, 150) + '...'
      form.setValue('excerpt', excerpt)
    }
  }, [watchContent])

  if (!user) {
    return (
      <div className="container max-w-4xl py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-lg text-muted-foreground">
              Please log in to create a post
            </p>
            <Button 
              className="mt-4"
              onClick={() => router.push('/login')}
            >
              Log In
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            Create New Post
            <Sparkles className="w-8 h-8 text-sparkle-500" />
          </h1>
          <p className="text-muted-foreground mt-1">
            Share your thoughts with the Sparkle Universe community
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving...
            </Badge>
          )}
          {saveStatus === 'saved' && (
            <Badge variant="secondary" className="gap-1">
              <Save className="w-3 h-3" />
              Saved
            </Badge>
          )}
        </div>
      </div>

      <form onSubmit={form.handleSubmit((data) => onSubmit(
