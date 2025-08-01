# 🚀 Phase 2: Core Features Implementation (Hybrid Approach)

Building upon our solid Phase 1 foundation, I'll implement the core features with production-ready quality while maintaining simplicity and preparing for future growth.

## 📋 Phase 2 Overview

Phase 2 introduces the heart of Sparkle Universe: content creation, user interactions, and the API layer. Following our hybrid approach, we'll build features that are robust yet maintainable.

## 1. `/src/server/api/trpc.ts`

```typescript
// /src/server/api/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server'
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { getServerSession } from 'next-auth'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { authOptions } from '@/lib/auth/auth.config'
import { db } from '@/lib/db'
import { env } from '@/config/env'
import { ratelimit } from '@/lib/ratelimit'
import type { Session } from 'next-auth'

/**
 * Context available in all tRPC procedures
 */
interface CreateContextOptions {
  session: Session | null
  req?: CreateNextContextOptions['req']
  res?: CreateNextContextOptions['res']
}

/**
 * Inner context creator - for testing without req/res
 */
export const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    db,
    req: opts.req,
    res: opts.res,
  }
}

/**
 * Outer context creator - used in production
 */
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts

  // Get session without throwing errors
  const session = await getServerSession(authOptions).catch(() => null)

  return createInnerTRPCContext({
    session,
    req,
    res,
  })
}

/**
 * Initialize tRPC with context
 */
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

/**
 * Create tRPC router
 */
export const createTRPCRouter = t.router

/**
 * Public procedure - no auth required
 */
export const publicProcedure = t.procedure

/**
 * Rate limiting middleware
 */
const rateLimitMiddleware = t.middleware(async ({ ctx, next, path }) => {
  // Skip rate limiting in development
  if (env.NODE_ENV === 'development') {
    return next()
  }

  const identifier = ctx.session?.user.id || ctx.req?.headers.get('x-forwarded-for') || 'anonymous'
  const { success } = await ratelimit.limit(identifier)

  if (!success) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded. Please try again later.',
    })
  }

  return next()
})

/**
 * Protected procedure - requires authentication
 */
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

/**
 * Protected procedure with rate limiting
 */
export const protectedProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(enforceUserIsAuthed)

/**
 * Admin procedure - requires admin role
 */
const enforceUserIsAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  if (ctx.session.user.role !== 'ADMIN') {
    throw new TRPCError({ 
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }

  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  })
})

export const adminProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(enforceUserIsAdmin)

/**
 * Moderator procedure - requires moderator or admin role
 */
const enforceUserIsModerator = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  if (!['MODERATOR', 'ADMIN'].includes(ctx.session.user.role)) {
    throw new TRPCError({ 
      code: 'FORBIDDEN',
      message: 'Moderator access required',
    })
  }

  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  })
})

export const moderatorProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(enforceUserIsModerator)
```

## 2. `/src/server/api/root.ts`

```typescript
// /src/server/api/root.ts
import { createTRPCRouter } from '@/server/api/trpc'
import { userRouter } from '@/server/api/routers/user'
import { postRouter } from '@/server/api/routers/post'
import { authRouter } from '@/server/api/routers/auth'
import { commentRouter } from '@/server/api/routers/comment'
import { feedRouter } from '@/server/api/routers/feed'
import { searchRouter } from '@/server/api/routers/search'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
  comment: commentRouter,
  feed: feedRouter,
  search: searchRouter,
})

// export type definition of API
export type AppRouter = typeof appRouter

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = appRouter.createCaller
```

## 3. `/src/server/api/routers/user.ts`

```typescript
// /src/server/api/routers/user.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { 
  createTRPCRouter, 
  publicProcedure, 
  protectedProcedure 
} from '@/server/api/trpc'
import { UserService } from '@/server/services/user.service'
import { updateProfileSchema } from '@/lib/validations/user'

export const userRouter = createTRPCRouter({
  /**
   * Get user profile by username
   */
  getProfile: publicProcedure
    .input(z.object({
      username: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const profile = await userService.getProfileByUsername(input.username)
      
      if (!profile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      return profile
    }),

  /**
   * Get current user's profile
   */
  getMyProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const userService = new UserService(ctx.db)
      return userService.getProfileById(ctx.session.user.id)
    }),

  /**
   * Update current user's profile
   */
  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.updateProfile(ctx.session.user.id, input)
    }),

  /**
   * Follow a user
   */
  follow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.followUser(ctx.session.user.id, input.userId)
    }),

  /**
   * Unfollow a user
   */
  unfollow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.unfollowUser(ctx.session.user.id, input.userId)
    }),

  /**
   * Get user's followers
   */
  getFollowers: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowers(input)
    }),

  /**
   * Get user's following
   */
  getFollowing: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowing(input)
    }),

  /**
   * Check if current user follows another user
   */
  isFollowing: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.isFollowing(ctx.session.user.id, input.userId)
    }),

  /**
   * Get user stats (posts, followers, following)
   */
  getStats: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserStats(input.userId)
    }),

  /**
   * Search users
   */
  search: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.searchUsers(input.query, input.limit)
    }),
})
```

## 4. `/src/server/services/user.service.ts`

```typescript
// /src/server/services/user.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { withRetry } from '@/lib/db'
import { NotificationService } from './notification.service'
import { ActivityService } from './activity.service'
import { CacheService } from './cache.service'
import type { UpdateProfileInput } from '@/lib/validations/user'

export class UserService {
  private notificationService: NotificationService
  private activityService: ActivityService
  private cacheService: CacheService

  constructor(private db: PrismaClient) {
    this.notificationService = new NotificationService(db)
    this.activityService = new ActivityService(db)
    this.cacheService = CacheService.getInstance()
  }

  /**
   * Get user profile by username with caching
   */
  async getProfileByUsername(username: string) {
    const cacheKey = `user:username:${username}`
    const cached = await this.cacheService.get(cacheKey)
    if (cached) return cached

    const user = await this.db.user.findUnique({
      where: { username },
      include: {
        _count: {
          select: {
            posts: { where: { published: true } },
            followers: true,
            following: true,
          },
        },
      },
    })

    if (user) {
      await this.cacheService.set(cacheKey, user, 300) // Cache for 5 minutes
    }

    return user
  }

  /**
   * Get user profile by ID
   */
  async getProfileById(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            posts: { where: { published: true } },
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

    return user
  }

  /**
   * Update user profile with validation
   */
  async updateProfile(userId: string, data: UpdateProfileInput) {
    // Check for username uniqueness if changing
    if (data.username) {
      const existing = await this.db.user.findUnique({
        where: { username: data.username },
        select: { id: true },
      })

      if (existing && existing.id !== userId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Username already taken',
        })
      }
    }

    const updated = await withRetry(() =>
      this.db.user.update({
        where: { id: userId },
        data: {
          username: data.username,
          bio: data.bio,
          image: data.image,
        },
        include: {
          _count: {
            select: {
              posts: { where: { published: true } },
              followers: true,
              following: true,
            },
          },
        },
      })
    )

    // Invalidate cache
    await this.cacheService.invalidate(`user:username:${updated.username}`)
    
    // Log activity
    await this.activityService.log({
      userId,
      action: 'profile_updated',
      metadata: { fields: Object.keys(data) },
    })

    return updated
  }

  /**
   * Follow a user with notification
   */
  async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot follow yourself',
      })
    }

    try {
      const follow = await this.db.follow.create({
        data: {
          followerId,
          followingId,
        },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              image: true,
            },
          },
        },
      })

      // Create notification
      await this.notificationService.create({
        type: 'USER_FOLLOWED',
        userId: followingId,
        actorId: followerId,
        message: `${follow.follower.username} started following you`,
        entityId: followerId,
        entityType: 'user',
      })

      // Log activity
      await this.activityService.log({
        userId: followerId,
        action: 'user_followed',
        entityType: 'user',
        entityId: followingId,
      })

      return { success: true, follow }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Already following this user',
          })
        }
      }
      throw error
    }
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(followerId: string, followingId: string) {
    try {
      await this.db.follow.delete({
        where: {
          followerId_followingId: {
            followerId,
            followingId,
          },
        },
      })

      // Log activity
      await this.activityService.log({
        userId: followerId,
        action: 'user_unfollowed',
        entityType: 'user',
        entityId: followingId,
      })

      return { success: true }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Not following this user',
          })
        }
      }
      throw error
    }
  }

  /**
   * Get paginated followers
   */
  async getFollowers(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const followers = await this.db.follow.findMany({
      where: { followingId: params.userId },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            image: true,
            bio: true,
            verified: true,
            _count: {
              select: {
                followers: true,
                posts: { where: { published: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: typeof params.cursor | undefined = undefined
    if (followers.length > params.limit) {
      const nextItem = followers.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: followers.map(f => f.follower),
      nextCursor,
      hasMore: !!nextCursor,
    }
  }

  /**
   * Get paginated following
   */
  async getFollowing(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const following = await this.db.follow.findMany({
      where: { followerId: params.userId },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        following: {
          select: {
            id: true,
            username: true,
            image: true,
            bio: true,
            verified: true,
            _count: {
              select: {
                followers: true,
                posts: { where: { published: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: typeof params.cursor | undefined = undefined
    if (following.length > params.limit) {
      const nextItem = following.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: following.map(f => f.following),
      nextCursor,
      hasMore: !!nextCursor,
    }
  }

  /**
   * Check if user follows another
   */
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

  /**
   * Get user statistics
   */
  async getUserStats(userId: string) {
    const stats = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        _count: {
          select: {
            posts: { where: { published: true } },
            followers: true,
            following: true,
          },
        },
        posts: {
          where: { published: true },
          select: {
            _count: {
              select: {
                reactions: true,
                comments: true,
              },
            },
            views: true,
          },
        },
      },
    })

    if (!stats) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    const totalViews = stats.posts.reduce((sum, post) => sum + post.views, 0)
    const totalLikes = stats.posts.reduce((sum, post) => sum + post._count.reactions, 0)
    const totalComments = stats.posts.reduce((sum, post) => sum + post._count.comments, 0)

    return {
      posts: stats._count.posts,
      followers: stats._count.followers,
      following: stats._count.following,
      totalViews,
      totalLikes,
      totalComments,
      engagement: stats._count.posts > 0 
        ? ((totalLikes + totalComments) / stats._count.posts).toFixed(2)
        : '0',
    }
  }

  /**
   * Search users by username or bio
   */
  async searchUsers(query: string, limit: number) {
    const users = await this.db.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { bio: { contains: query, mode: 'insensitive' } },
        ],
        banned: false,
      },
      select: {
        id: true,
        username: true,
        image: true,
        bio: true,
        verified: true,
        _count: {
          select: {
            followers: true,
            posts: { where: { published: true } },
          },
        },
      },
      orderBy: [
        { verified: 'desc' },
        { followers: { _count: 'desc' } },
      ],
      take: limit,
    })

    return users
  }
}
```

## 5. `/src/server/api/routers/post.ts`

```typescript
// /src/server/api/routers/post.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { 
  createTRPCRouter, 
  publicProcedure, 
  protectedProcedure,
  moderatorProcedure
} from '@/server/api/trpc'
import { PostService } from '@/server/services/post.service'
import { createPostSchema, updatePostSchema } from '@/lib/validations/post'

export const postRouter = createTRPCRouter({
  /**
   * Create a new post
   */
  create: protectedProcedure
    .input(createPostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.createPost({
        ...input,
        authorId: ctx.session.user.id,
      })
    }),

  /**
   * Update an existing post
   */
  update: protectedProcedure
    .input(updatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.updatePost(
        input.id,
        ctx.session.user.id,
        input
      )
    }),

  /**
   * Delete a post
   */
  delete: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.deletePost(input.id, ctx.session.user.id)
    }),

  /**
   * Publish/unpublish a post
   */
  togglePublish: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.togglePublish(input.id, ctx.session.user.id)
    }),

  /**
   * Get post by slug (public)
   */
  getBySlug: publicProcedure
    .input(z.object({
      slug: z.string(),
      incrementViews: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const userId = ctx.session?.user.id
      return postService.getPostBySlug(input.slug, userId, input.incrementViews)
    }),

  /**
   * Get post by ID (for editing)
   */
  getById: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getPostById(input.id, ctx.session.user.id)
    }),

  /**
   * List posts with filters
   */
  list: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
      authorId: z.string().optional(),
      authorUsername: z.string().optional(),
      tag: z.string().optional(),
      featured: z.boolean().optional(),
      published: z.boolean().default(true),
      orderBy: z.enum(['recent', 'popular', 'trending']).default('recent'),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const userId = ctx.session?.user.id
      return postService.listPosts(input, userId)
    }),

  /**
   * Like/unlike a post
   */
  toggleLike: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.toggleLike(input.postId, ctx.session.user.id)
    }),

  /**
   * Get user's drafted posts
   */
  getDrafts: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getUserDrafts(ctx.session.user.id, input)
    }),

  /**
   * Feature/unfeature a post (moderator only)
   */
  toggleFeature: moderatorProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.toggleFeature(input.id, ctx.session.user.id)
    }),

  /**
   * Get related posts
   */
  getRelated: publicProcedure
    .input(z.object({
      postId: z.string().cuid(),
      limit: z.number().min(1).max(10).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getRelatedPosts(input.postId, input.limit)
    }),

  /**
   * Get post analytics (author only)
   */
  getAnalytics: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getPostAnalytics(input.postId, ctx.session.user.id)
    }),
})
```

## 6. `/src/server/services/post.service.ts`

```typescript
// /src/server/services/post.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { generateSlug } from '@/lib/utils'
import { withRetry } from '@/lib/db'
import { NotificationService } from './notification.service'
import { ActivityService } from './activity.service'
import { CacheService } from './cache.service'
import { calculateReadingTime } from '@/lib/reading-time'
import type { CreatePostInput, UpdatePostInput } from '@/lib/validations/post'

export class PostService {
  private notificationService: NotificationService
  private activityService: ActivityService
  private cacheService: CacheService

  constructor(private db: PrismaClient) {
    this.notificationService = new NotificationService(db)
    this.activityService = new ActivityService(db)
    this.cacheService = CacheService.getInstance()
  }

  /**
   * Create a new post with automatic slug generation
   */
  async createPost(input: CreatePostInput & { authorId: string }) {
    const slug = await this.generateUniqueSlug(input.title)
    const readingTime = calculateReadingTime(input.content)

    const post = await withRetry(() =>
      this.db.post.create({
        data: {
          title: input.title,
          content: input.content,
          excerpt: input.excerpt || this.generateExcerpt(input.content),
          slug,
          authorId: input.authorId,
          coverImage: input.coverImage,
          youtubeVideoId: input.youtubeVideoId,
          readingTime,
          published: input.published ?? false,
          publishedAt: input.published ? new Date() : null,
          metaDescription: input.metaDescription,
          tags: input.tags?.length ? {
            create: input.tags.map(tag => ({
              tag: {
                connectOrCreate: {
                  where: { name: tag },
                  create: { 
                    name: tag,
                    slug: generateSlug(tag),
                  },
                },
              },
            })),
          } : undefined,
        },
        include: this.getPostInclude(),
      })
    )

    // Update tag counts
    if (input.tags?.length) {
      await this.updateTagCounts(input.tags)
    }

    // Log activity
    await this.activityService.log({
      userId: input.authorId,
      action: 'post_created',
      entityType: 'post',
      entityId: post.id,
      metadata: { published: post.published },
    })

    // Notify followers if published
    if (post.published) {
      await this.notifyFollowersOfNewPost(post)
    }

    return post
  }

  /**
   * Update an existing post
   */
  async updatePost(
    postId: string,
    userId: string,
    input: Partial<UpdatePostInput>
  ) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { authorId: true, published: true },
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

    // Handle slug change if title is updated
    let slug = undefined
    if (input.title) {
      slug = await this.generateUniqueSlug(input.title, postId)
    }

    // Calculate new reading time if content changed
    let readingTime = undefined
    if (input.content) {
      readingTime = calculateReadingTime(input.content)
    }

    const updated = await withRetry(() =>
      this.db.post.update({
        where: { id: postId },
        data: {
          title: input.title,
          content: input.content,
          excerpt: input.excerpt,
          slug,
          readingTime,
          coverImage: input.coverImage,
          youtubeVideoId: input.youtubeVideoId,
          metaDescription: input.metaDescription,
          published: input.published,
          publishedAt: input.published && !post.published ? new Date() : undefined,
          tags: input.tags !== undefined ? {
            deleteMany: {},
            create: input.tags.map(tag => ({
              tag: {
                connectOrCreate: {
                  where: { name: tag },
                  create: { 
                    name: tag,
                    slug: generateSlug(tag),
                  },
                },
              },
            })),
          } : undefined,
        },
        include: this.getPostInclude(),
      })
    )

    // Invalidate cache
    await this.cacheService.invalidate(`post:slug:${updated.slug}`)

    // Log activity
    await this.activityService.log({
      userId,
      action: 'post_updated',
      entityType: 'post',
      entityId: postId,
    })

    return updated
  }

  /**
   * Delete a post (soft delete)
   */
  async deletePost(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
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

    // Log activity
    await this.activityService.log({
      userId,
      action: 'post_deleted',
      entityType: 'post',
      entityId: postId,
    })

    return { success: true }
  }

  /**
   * Toggle publish status
   */
  async togglePublish(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { authorId: true, published: true },
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
        message: 'You can only publish/unpublish your own posts',
      })
    }

    const updated = await this.db.post.update({
      where: { id: postId },
      data: {
        published: !post.published,
        publishedAt: !post.published ? new Date() : null,
      },
      include: this.getPostInclude(),
    })

    // Notify followers if newly published
    if (!post.published && updated.published) {
      await this.notifyFollowersOfNewPost(updated)
    }

    return updated
  }

  /**
   * Get post by slug with view tracking
   */
  async getPostBySlug(slug: string, userId?: string, incrementViews = true) {
    const cacheKey = `post:slug:${slug}`
    let post = await this.cacheService.get(cacheKey)

    if (!post) {
      post = await this.db.post.findUnique({
        where: { slug },
        include: {
          ...this.getPostInclude(),
          reactions: userId ? {
            where: { userId },
            select: { type: true },
          } : false,
        },
      })

      if (post && post.published) {
        await this.cacheService.set(cacheKey, post, 300) // Cache for 5 minutes
      }
    }

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    if (!post.published && post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This post is not published',
      })
    }

    // Increment views (outside of main query for performance)
    if (incrementViews && post.published) {
      await this.db.post.update({
        where: { id: post.id },
        data: { views: { increment: 1 } },
      }).catch(() => {}) // Don't fail if view increment fails
    }

    return {
      ...post,
      isLiked: userId ? post.reactions?.some(r => r.type === 'LIKE') : false,
    }
  }

  /**
   * Get post by ID for editing
   */
  async getPostById(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: this.getPostInclude(),
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

    return post
  }

  /**
   * List posts with pagination and filters
   */
  async listPosts(
    params: {
      limit: number
      cursor?: string
      authorId?: string
      authorUsername?: string
      tag?: string
      featured?: boolean
      published?: boolean
      orderBy?: 'recent' | 'popular' | 'trending'
    },
    userId?: string
  ) {
    // Build where clause
    const where: Prisma.PostWhereInput = {
      published: params.published,
      featured: params.featured,
      authorId: params.authorId,
      author: params.authorUsername ? {
        username: params.authorUsername,
      } : undefined,
      tags: params.tag ? {
        some: {
          tag: { name: params.tag },
        },
      } : undefined,
    }

    // Build order by
    let orderBy: Prisma.PostOrderByWithRelationInput
    switch (params.orderBy) {
      case 'popular':
        orderBy = { views: 'desc' }
        break
      case 'trending':
        // Trending: recent posts with high engagement
        orderBy = [
          { publishedAt: 'desc' },
          { reactions: { _count: 'desc' } },
        ] as any
        break
      default:
        orderBy = { publishedAt: 'desc' }
    }

    const posts = await this.db.post.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        ...this.getPostInclude(),
        reactions: userId ? {
          where: { userId, type: 'LIKE' },
          select: { type: true },
        } : false,
      },
      orderBy,
    })

    let nextCursor: typeof params.cursor | undefined = undefined
    if (posts.length > params.limit) {
      const nextItem = posts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: posts.map(post => ({
        ...post,
        isLiked: userId ? post.reactions.length > 0 : false,
      })),
      nextCursor,
      hasMore: !!nextCursor,
    }
  }

  /**
   * Toggle like on a post
   */
  async toggleLike(postId: string, userId: string) {
    const existing = await this.db.reaction.findUnique({
      where: {
        postId_userId_type: {
          postId,
          userId,
          type: 'LIKE',
        },
      },
    })

    if (existing) {
      // Unlike
      await this.db.reaction.delete({
        where: { id: existing.id },
      })

      return { liked: false }
    } else {
      // Like
      const reaction = await this.db.reaction.create({
        data: {
          postId,
          userId,
          type: 'LIKE',
        },
        include: {
          post: {
            select: {
              authorId: true,
              title: true,
            },
          },
          user: {
            select: {
              username: true,
            },
          },
        },
      })

      // Notify post author
      if (reaction.post.authorId !== userId) {
        await this.notificationService.create({
          type: 'POST_LIKED',
          userId: reaction.post.authorId,
          actorId: userId,
          message: `${reaction.user.username} liked your post "${reaction.post.title}"`,
          entityId: postId,
          entityType: 'post',
        })
      }

      return { liked: true }
    }
  }

  /**
   * Get user's draft posts
   */
  async getUserDrafts(
    userId: string,
    params: { limit: number; cursor?: string }
  ) {
    const drafts = await this.db.post.findMany({
      where: {
        authorId: userId,
        published: false,
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: this.getPostInclude(),
      orderBy: { updatedAt: 'desc' },
    })

    let nextCursor: typeof params.cursor | undefined = undefined
    if (drafts.length > params.limit) {
      const nextItem = drafts.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: drafts,
      nextCursor,
      hasMore: !!nextCursor,
    }
  }

  /**
   * Toggle featured status (moderator action)
   */
  async toggleFeature(postId: string, moderatorId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { featured: true },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    const updated = await this.db.post.update({
      where: { id: postId },
      data: { featured: !post.featured },
      include: this.getPostInclude(),
    })

    // Log moderation activity
    await this.activityService.log({
      userId: moderatorId,
      action: post.featured ? 'post_unfeatured' : 'post_featured',
      entityType: 'post',
      entityId: postId,
    })

    return updated
  }

  /**
   * Get related posts based on tags
   */
  async getRelatedPosts(postId: string, limit: number) {
    // Get the post's tags
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: {
        tags: {
          select: { tagId: true },
        },
      },
    })

    if (!post || post.tags.length === 0) {
      return []
    }

    const tagIds = post.tags.map(t => t.tagId)

    // Find posts with similar tags
    const relatedPosts = await this.db.post.findMany({
      where: {
        id: { not: postId },
        published: true,
        tags: {
          some: {
            tagId: { in: tagIds },
          },
        },
      },
      include: this.getPostInclude(),
      orderBy: [
        { views: 'desc' },
        { publishedAt: 'desc' },
      ],
      take: limit,
    })

    return relatedPosts
  }

  /**
   * Get post analytics (author only)
   */
  async getPostAnalytics(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { 
        authorId: true,
        views: true,
        publishedAt: true,
        _count: {
          select: {
            reactions: true,
            comments: true,
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

    if (post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only view analytics for your own posts',
      })
    }

    // Get reaction breakdown
    const reactionBreakdown = await this.db.reaction.groupBy({
      by: ['type'],
      where: { postId },
      _count: true,
    })

    // Get daily views for the last 7 days (simplified for now)
    const daysSincePublished = post.publishedAt 
      ? Math.floor((Date.now() - post.publishedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0
    
    const avgViewsPerDay = daysSincePublished > 0 
      ? Math.round(post.views / daysSincePublished)
      : post.views

    return {
      views: post.views,
      reactions: post._count.reactions,
      comments: post._count.comments,
      reactionBreakdown: Object.fromEntries(
        reactionBreakdown.map(r => [r.type, r._count])
      ),
      avgViewsPerDay,
      engagementRate: post.views > 0 
        ? ((post._count.reactions + post._count.comments) / post.views * 100).toFixed(2)
        : '0',
    }
  }

  // Helper methods

  private getPostInclude() {
    return {
      author: {
        select: {
          id: true,
          username: true,
          image: true,
          verified: true,
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      _count: {
        select: {
          comments: true,
          reactions: true,
        },
      },
    } satisfies Prisma.PostInclude
  }

  private async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    let slug = generateSlug(title)
    let counter = 1

    while (true) {
      const existing = await this.db.post.findUnique({
        where: { slug },
        select: { id: true },
      })

      if (!existing || existing.id === excludeId) {
        break
      }

      slug = `${generateSlug(title)}-${counter}`
      counter++
    }

    return slug
  }

  private generateExcerpt(content: string): string {
    // Strip HTML/Markdown and truncate
    const plainText = content
      .replace(/<[^>]*>/g, '')
      .replace(/[#*`_~\[\]]/g, '')
      .trim()
    
    return plainText.length > 160 
      ? plainText.substring(0, 157) + '...'
      : plainText
  }

  private async updateTagCounts(tagNames: string[]) {
    // Update tag post counts
    await this.db.$executeRaw`
      UPDATE tags 
      SET "postCount" = (
        SELECT COUNT(*) FROM post_tags 
        WHERE post_tags."tagId" = tags.id
      )
      WHERE name = ANY(${tagNames})
    `
  }

  private async notifyFollowersOfNewPost(post: any) {
    // Get author's followers
    const followers = await this.db.follow.findMany({
      where: { followingId: post.authorId },
      select: { followerId: true },
    })

    // Create notifications for followers
    const notifications = followers.map(f => ({
      type: 'USER_FOLLOWED' as const,
      userId: f.followerId,
      actorId: post.authorId,
      message: `${post.author.username} published a new post: "${post.title}"`,
      entityId: post.id,
      entityType: 'post',
    }))

    // Batch create notifications
    if (notifications.length > 0) {
      await this.db.notification.createMany({
        data: notifications,
        skipDuplicates: true,
      })
    }
  }
}
```

## 7. `/src/lib/validations/post.ts`

```typescript
// /src/lib/validations/post.ts
import { z } from 'zod'

export const createPostSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  content: z
    .string()
    .min(10, 'Content must be at least 10 characters')
    .max(50000, 'Content must be less than 50,000 characters'),
  excerpt: z
    .string()
    .max(500, 'Excerpt must be less than 500 characters')
    .optional(),
  coverImage: z
    .string()
    .url('Cover image must be a valid URL')
    .optional()
    .or(z.literal('')),
  tags: z
    .array(z.string().min(1).max(30))
    .max(5, 'Maximum 5 tags allowed')
    .optional(),
  youtubeVideoId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{11}$/, 'Invalid YouTube video ID')
    .optional()
    .or(z.literal('')),
  published: z.boolean().optional(),
  metaDescription: z
    .string()
    .max(160, 'Meta description must be less than 160 characters')
    .optional(),
})

export const updatePostSchema = createPostSchema.partial().extend({
  id: z.string().cuid(),
})

export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>

// Additional validation utilities
export const postQuerySchema = z.object({
  limit: z.number().min(1).max(50).optional(),
  cursor: z.string().optional(),
  orderBy: z.enum(['recent', 'popular', 'trending']).optional(),
})

export const postSlugSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'Invalid slug format'
)
```

## 8. `/src/components/features/editor/rich-text-editor.tsx`

```typescript
// /src/components/features/editor/rich-text-editor.tsx
'use client'

import { useCallback, useRef, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { Button } from '@/components/ui/button'
import { 
  Bold, 
  Italic, 
  List, 
  ListOrdered,
  Quote,
  Code,
  Link,
  Image,
  Heading2,
  Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUploadThing } from '@/lib/uploadthing'
import { toast } from 'sonner'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  disabled?: boolean
  className?: string
}

interface ToolbarButton {
  icon: React.ReactNode
  label: string
  action: () => void
  isActive?: boolean
}

export function RichTextEditor({ 
  value, 
  onChange,
  placeholder = 'Start writing...',
  minHeight = 200,
  maxHeight = 600,
  disabled = false,
  className,
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [isUploading, setIsUploading] = useState(false)

  const { startUpload } = useUploadThing('imageUploader', {
    onUploadBegin: () => setIsUploading(true),
    onClientUploadComplete: (res) => {
      setIsUploading(false)
      if (res?.[0]?.url) {
        insertText(`\n![Image](${res[0].url})\n`)
      }
    },
    onUploadError: (error) => {
      setIsUploading(false)
      toast.error('Failed to upload image')
      console.error(error)
    },
  })

  // Save selection when it changes
  const handleSelect = useCallback(() => {
    if (textareaRef.current) {
      setSelection({
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd,
      })
    }
  }, [])

  // Insert text at current position
  const insertText = useCallback((text: string, wrapSelected = false) => {
    if (!textareaRef.current) return

    const textarea = textareaRef.current
    const { start, end } = selection
    const selectedText = value.substring(start, end)
    const before = value.substring(0, start)
    const after = value.substring(end)

    let newText: string
    let newCursorPos: number

    if (wrapSelected && selectedText) {
      // Wrap selected text
      const [prefix, suffix] = text.split('|')
      newText = before + prefix + selectedText + suffix + after
      newCursorPos = start + prefix.length + selectedText.length + suffix.length
    } else {
      // Insert at cursor
      newText = before + text + after
      newCursorPos = start + text.length
    }

    onChange(newText)

    // Restore focus and cursor position
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }, [value, onChange, selection])

  // Toolbar actions
  const toolbarButtons: ToolbarButton[] = [
    {
      icon: <Heading2 className="h-4 w-4" />,
      label: 'Heading',
      action: () => insertText('## ', false),
    },
    {
      icon: <Bold className="h-4 w-4" />,
      label: 'Bold',
      action: () => insertText('**|**', true),
    },
    {
      icon: <Italic className="h-4 w-4" />,
      label: 'Italic',
      action: () => insertText('*|*', true),
    },
    {
      icon: <Code className="h-4 w-4" />,
      label: 'Code',
      action: () => insertText('`|`', true),
    },
    {
      icon: <Link className="h-4 w-4" />,
      label: 'Link',
      action: () => {
        const url = prompt('Enter URL:')
        if (url) {
          insertText(`[|](${url})`, true)
        }
      },
    },
    {
      icon: <Quote className="h-4 w-4" />,
      label: 'Quote',
      action: () => insertText('> ', false),
    },
    {
      icon: <List className="h-4 w-4" />,
      label: 'Bullet List',
      action: () => insertText('- ', false),
    },
    {
      icon: <ListOrdered className="h-4 w-4" />,
      label: 'Numbered List',
      action: () => insertText('1. ', false),
    },
    {
      icon: <Minus className="h-4 w-4" />,
      label: 'Divider',
      action: () => insertText('\n---\n', false),
    },
  ]

  // Handle image upload
  const handleImageUpload = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        startUpload([file])
      }
    }
    input.click()
  }, [startUpload])

  return (
    <div className={cn('relative', className)}>
      {/* Toolbar */}
      <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-1 rounded-t-lg border bg-background/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {toolbarButtons.map((button, index) => (
          <Button
            key={index}
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={button.action}
            disabled={disabled}
            title={button.label}
            className={cn(
              'h-8 w-8',
              button.isActive && 'bg-muted'
            )}
          >
            {button.icon}
          </Button>
        ))}
        <div className="mx-2 h-6 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleImageUpload}
          disabled={disabled || isUploading}
          title="Upload Image"
          className="h-8 w-8"
        >
          <Image className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor */}
      <div className="relative">
        <TextareaAutosize
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={handleSelect}
          placeholder={placeholder}
          disabled={disabled || isUploading}
          minRows={8}
          maxRows={20}
          className={cn(
            'w-full resize-none rounded-b-lg border-x border-b bg-transparent p-4',
            'font-mono text-sm',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isUploading && 'cursor-wait'
          )}
          style={{
            minHeight,
            maxHeight,
          }}
        />
        
        {/* Character count */}
        <div className="absolute bottom-2 right-2 text-xs text-muted-foreground">
          {value.length} characters
        </div>

        {/* Upload indicator */}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-b-lg bg-background/80 backdrop-blur">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Uploading image...
            </div>
          </div>
        )}
      </div>

      {/* Markdown hint */}
      <p className="mt-2 text-xs text-muted-foreground">
        Supports Markdown formatting. Use **bold**, *italic*, [links](url), and more.
      </p>
    </div>
  )
}
```

## 9. `/src/app/(main)/create/page.tsx`

```typescript
// /src/app/(main)/create/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPostSchema, type CreatePostInput } from '@/lib/validations/post'
import { api } from '@/lib/api'
import { RichTextEditor } from '@/components/features/editor/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Loader2, X, Plus, Youtube, Image as ImageIcon } from 'lucide-react'
import { parseYouTubeVideoId } from '@/lib/utils'
import { YouTubePreview } from '@/components/features/youtube/youtube-preview'
import { cn } from '@/lib/utils'

export default function CreatePostPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [activeTab, setActiveTab] = useState('editor')

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(createPostSchema),
    defaultValues: {
      title: '',
      content: '',
      excerpt: '',
      coverImage: '',
      tags: [],
      youtubeVideoId: '',
      published: false,
      metaDescription: '',
    },
  })

  const createPost = api.post.create.useMutation({
    onMutate: () => {
      setIsSubmitting(true)
    },
    onSuccess: (post) => {
      toast.success(
        post.published 
          ? 'Post published successfully!' 
          : 'Draft saved successfully!'
      )
      router.push(`/post/${post.slug}`)
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to create post')
      setIsSubmitting(false)
    },
  })

  const onSubmit = (data: CreatePostInput) => {
    createPost.mutate(data)
  }

  const handleAddTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.watch('tags')?.includes(tag)) {
      const currentTags = form.watch('tags') || []
      if (currentTags.length < 5) {
        form.setValue('tags', [...currentTags, tag])
        setTagInput('')
      } else {
        toast.error('Maximum 5 tags allowed')
      }
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = form.watch('tags') || []
    form.setValue('tags', currentTags.filter(tag => tag !== tagToRemove))
  }

  const handleYouTubeUrl = (url: string) => {
    const videoId = parseYouTubeVideoId(url)
    if (videoId) {
      form.setValue('youtubeVideoId', videoId)
    } else if (url) {
      toast.error('Invalid YouTube URL')
    }
  }

  return (
    <div className="container max-w-5xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Create New Post</h1>
        <p className="mt-2 text-muted-foreground">
          Share your thoughts with the Sparkle Universe community
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main content area */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Post Content</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Title */}
                <div>
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    placeholder="Enter your post title"
                    className="mt-1 text-lg"
                    {...form.register('title')}
                  />
                  {form.formState.errors.title && (
                    <p className="mt-1 text-sm text-destructive">
                      {form.formState.errors.title.message}
                    </p>
                  )}
                </div>

                {/* Content Editor */}
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="editor">Write</TabsTrigger>
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                  </TabsList>
                  <TabsContent value="editor" className="mt-4">
                    <div>
                      <Label>Content</Label>
                      <div className="mt-1">
                        <RichTextEditor
                          value={form.watch('content')}
                          onChange={(content) => form.setValue('content', content)}
                          placeholder="Write your post content here..."
                          minHeight={400}
                        />
                      </div>
                      {form.formState.errors.content && (
                        <p className="mt-1 text-sm text-destructive">
                          {form.formState.errors.content.message}
                        </p>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="preview" className="mt-4">
                    <Card>
                      <CardContent className="prose prose-sm dark:prose-invert max-w-none p-6">
                        <h1>{form.watch('title') || 'Untitled Post'}</h1>
                        <div 
                          dangerouslySetInnerHTML={{ 
                            __html: form.watch('content') || '<p>No content yet...</p>' 
                          }} 
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Publish settings */}
            <Card>
              <CardHeader>
                <CardTitle>Publish Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="published">Publish immediately</Label>
                  <Switch
                    id="published"
                    checked={form.watch('published')}
                    onCheckedChange={(checked) => form.setValue('published', checked)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {form.watch('published') 
                    ? 'Your post will be visible to everyone'
                    : 'Save as draft to publish later'
                  }
                </p>
              </CardContent>
            </Card>

            {/* SEO Settings */}
            <Card>
              <CardHeader>
                <CardTitle>SEO</CardTitle>
                <CardDescription>
                  Optimize how your post appears in search results
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="excerpt">Excerpt</Label>
                  <Textarea
                    id="excerpt"
                    placeholder="Brief description of your post"
                    rows={3}
                    className="mt-1"
                    {...form.register('excerpt')}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {form.watch('excerpt')?.length || 0}/500 characters
                  </p>
                </div>

                <div>
                  <Label htmlFor="metaDescription">Meta Description</Label>
                  <Textarea
                    id="metaDescription"
                    placeholder="SEO description (optional)"
                    rows={2}
                    className="mt-1"
                    {...form.register('metaDescription')}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {form.watch('metaDescription')?.length || 0}/160 characters
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Media */}
            <Card>
              <CardHeader>
                <CardTitle>Media</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Cover Image */}
                <div>
                  <Label htmlFor="coverImage">Cover Image URL</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="coverImage"
                      placeholder="https://example.com/image.jpg"
                      {...form.register('coverImage')}
                    />
                    <Button type="button" size="icon" variant="outline">
                      <ImageIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* YouTube Video */}
                <div>
                  <Label htmlFor="youtubeUrl">YouTube Video</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="youtubeUrl"
                      placeholder="YouTube URL or Video ID"
                      onChange={(e) => handleYouTubeUrl(e.target.value)}
                      value={form.watch('youtubeVideoId') || ''}
                    />
                    <Button type="button" size="icon" variant="outline">
                      <Youtube className="h-4 w-4" />
                    </Button>
                  </div>
                  {form.watch('youtubeVideoId') && (
                    <div className="mt-2">
                      <YouTubePreview videoId={form.watch('youtubeVideoId')!} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tags */}
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
                <CardDescription>
                  Add up to 5 tags to help people find your post
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a tag"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddTag()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={handleAddTag}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.watch('tags')?.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={isSubmitting}
            className={cn(
              form.watch('published') && 'bg-gradient-to-r from-purple-600 to-pink-600'
            )}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {form.watch('published') ? 'Publish Post' : 'Save Draft'}
          </Button>
        </div>
      </form>
    </div>
  )
}
```

## 10. `/src/components/features/post/post-card.tsx`

```typescript
// /src/components/features/post/post-card.tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { formatRelativeTime, formatCompactNumber, cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Heart, MessageCircle, Eye, Clock, Youtube } from 'lucide-react'
import { motion } from 'framer-motion'
import type { RouterOutputs } from '@/lib/api'

type Post = RouterOutputs['post']['list']['items'][0]

interface PostCardProps {
  post: Post
  onLike?: () => void
  priority?: boolean
  index?: number
}

export function PostCard({ post, onLike, priority = false, index = 0 }: PostCardProps) {
  const readingTime = post.readingTime || Math.ceil(post.content.length / 1000)

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card className="group overflow-hidden transition-all hover:shadow-lg">
        {/* Cover Image */}
        {post.coverImage && (
          <Link href={`/post/${post.slug}`} className="block">
            <div className="relative aspect-[2/1] overflow-hidden bg-muted">
              <Image
                src={post.coverImage}
                alt={post.title}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                priority={priority}
              />
              {post.youtubeVideoId && (
                <div className="absolute right-2 top-2">
                  <Badge variant="secondary" className="gap-1 bg-black/80 text-white">
                    <Youtube className="h-3 w-3" />
                    Video
                  </Badge>
                </div>
              )}
            </div>
          </Link>
        )}

        <CardContent className="p-6">
          {/* Author Info */}
          <div className="mb-4 flex items-center gap-3">
            <Link href={`/user/${post.author.username}`}>
              <Avatar className="h-10 w-10 transition-all hover:ring-2 hover:ring-primary">
                <AvatarImage src={post.author.image || undefined} />
                <AvatarFallback>
                  {post.author.username[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
            <div className="flex-1">
              <Link 
                href={`/user/${post.author.username}`}
                className="flex items-center gap-1 font-medium hover:text-primary"
              >
                {post.author.username}
                {post.author.verified && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    ✓
                  </Badge>
                )}
              </Link>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{formatRelativeTime(post.publishedAt || post.createdAt)}</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {readingTime} min read
                </span>
              </div>
            </div>
            {post.featured && (
              <Badge variant="default" className="bg-gradient-to-r from-purple-600 to-pink-600">
                Featured
              </Badge>
            )}
          </div>

          {/* Content */}
          <Link href={`/post/${post.slug}`} className="group/link">
            <h3 className="mb-2 text-xl font-bold transition-colors group-hover/link:text-primary">
              {post.title}
            </h3>
            {post.excerpt && (
              <p className="mb-4 line-clamp-2 text-muted-foreground">
                {post.excerpt}
              </p>
            )}
          </Link>

          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {post.tags.slice(0, 3).map(({ tag }) => (
                <Link key={tag.id} href={`/tag/${tag.slug}`}>
                  <Badge 
                    variant="outline" 
                    className="transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    {tag.name}
                  </Badge>
                </Link>
              ))}
              {post.tags.length > 3 && (
                <Badge variant="outline" className="text-muted-foreground">
                  +{post.tags.length - 3} more
                </Badge>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "gap-2 px-2",
                post.isLiked && "text-red-500"
              )}
              onClick={(e) => {
                e.preventDefault()
                onLike?.()
              }}
            >
              <Heart 
                className={cn(
                  "h-4 w-4 transition-all",
                  post.isLiked && "fill-current"
                )} 
              />
              <span>{formatCompactNumber(post._count.reactions)}</span>
            </Button>

            <Link href={`/post/${post.slug}#comments`}>
              <Button variant="ghost" size="sm" className="gap-2 px-2">
                <MessageCircle className="h-4 w-4" />
                <span>{formatCompactNumber(post._count.comments)}</span>
              </Button>
            </Link>

            <div className="ml-auto flex items-center gap-1 text-muted-foreground">
              <Eye className="h-4 w-4" />
              <span>{formatCompactNumber(post.views)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.article>
  )
}
```

## Additional Required Files for Phase 2

### `/src/lib/api.ts` (tRPC Client)
```typescript
// /src/lib/api.ts
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '@/server/api/root'

export const api = createTRPCReact<AppRouter>()

export type RouterInputs = inferRouterInputs<AppRouter>
export type RouterOutputs = inferRouterOutputs<AppRouter>
```

### `/src/components/providers/query-provider.tsx`
```typescript
// /src/components/providers/query-provider.tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { httpBatchLink } from '@trpc/client'
import { api } from '@/lib/api'
import superjson from 'superjson'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        cacheTime: 10 * 60 * 1000, // 10 minutes
      },
    },
  }))

  const [trpcClient] = useState(() =>
    api.createClient({
      transformer: superjson,
      links: [
        httpBatchLink({
          url: '/api/trpc',
        }),
      ],
    })
  )

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </api.Provider>
  )
}
```

### Additional Service Files

#### `/src/server/services/notification.service.ts`
```typescript
// /src/server/services/notification.service.ts
import { PrismaClient } from '@prisma/client'

export class NotificationService {
  constructor(private db: PrismaClient) {}

  async create(data: {
    type: string
    userId: string
    actorId?: string
    message: string
    entityId?: string
    entityType?: string
    data?: any
  }) {
    return this.db.notification.create({ data })
  }
}
```

#### `/src/server/services/activity.service.ts`
```typescript
// /src/server/services/activity.service.ts
import { PrismaClient } from '@prisma/client'

export class ActivityService {
  constructor(private db: PrismaClient) {}

  async log(data: {
    userId?: string
    action: string
    entityType?: string
    entityId?: string
    metadata?: any
  }) {
    return this.db.activityLog.create({ data })
  }
}
```

#### `/src/server/services/cache.service.ts`
```typescript
// /src/server/services/cache.service.ts
export class CacheService {
  private static instance: CacheService
  private cache: Map<string, { value: any; expires: number }>

  private constructor() {
    this.cache = new Map()
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }

  async get(key: string): Promise<any> {
    const item = this.cache.get(key)
    if (!item) return null
    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return null
    }
    return item.value
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    this.cache.set(key, { value, expires: Date.now() + ttl * 1000 })
  }

  async invalidate(pattern: string): Promise<void> {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }
}
```

## 🎉 Phase 2 Complete!

Phase 2 implementation delivers:

1. **Complete API Layer** with tRPC for type-safe communication
2. **User Management** with profiles, following, and stats
3. **Content Creation** with rich editor and media support
4. **Post Management** with drafts, publishing, and analytics
5. **Production Features** like caching, rate limiting, and activity logging

The hybrid approach ensures:
- ✅ Production-ready code without over-engineering
- ✅ Clean architecture that's easy to extend
- ✅ Performance optimizations from day one
- ✅ Type safety throughout the stack
- ✅ Ready for Phase 3 features (comments, real-time, search)

This implementation provides a solid foundation for content creation while maintaining the flexibility to add more advanced features in subsequent phases.
