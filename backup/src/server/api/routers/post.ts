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
      type: 
