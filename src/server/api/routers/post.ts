// src/server/api/routers/post.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from '@/server/api/trpc'
import { PostService } from '@/server/services/post.service'
import { createPostSchema, updatePostSchema } from '@/lib/validations/post'
import { PAGINATION } from '@/config/constants'

export const postRouter = createTRPCRouter({
  // Create a new post
  create: protectedProcedure
    .input(createPostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const post = await postService.createPost({
        ...input,
        authorId: ctx.session.user.id,
      })

      return post
    }),

  // Update a post
  update: protectedProcedure
    .input(updatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      // Check ownership
      const post = await postService.getPostById(input.id)
      if (post.authorId !== ctx.session.user.id && ctx.session.user.role !== 'ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to edit this post',
        })
      }

      const updatedPost = await postService.updatePost(input.id, input)
      return updatedPost
    }),

  // Delete a post
  delete: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      // Check ownership
      const post = await postService.getPostById(input.id)
      if (post.authorId !== ctx.session.user.id && ctx.session.user.role !== 'ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete this post',
        })
      }

      await postService.deletePost(input.id)
      return { success: true }
    }),

  // Get post by slug
  getBySlug: publicProcedure
    .input(z.object({
      slug: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const post = await postService.getPostBySlug(input.slug)
      
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        })
      }

      // Check if user has liked the post
      const isLiked = ctx.session?.user 
        ? await postService.hasUserLikedPost(ctx.session.user.id, post.id)
        : false

      // Increment view count
      await postService.incrementViews(post.id)

      return {
        ...post,
        isLiked,
      }
    }),

  // Get post by ID
  getById: publicProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      const post = await postService.getPostById(input.id)
      
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        })
      }

      return post
    }),

  // List posts with filters
  list: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
      authorId: z.string().optional(),
      tag: z.string().optional(),
      featured: z.boolean().optional(),
      orderBy: z.enum(['recent', 'popular', 'trending']).default('recent'),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const posts = await postService.listPosts({
        ...input,
        currentUserId: ctx.session?.user?.id,
      })

      return posts
    }),

  // Get user's feed
  getFeed: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const feed = await postService.getUserFeed({
        userId: ctx.session.user.id,
        limit: input.limit,
        cursor: input.cursor,
      })

      return feed
    }),

  // Get trending posts
  getTrending: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(10),
      period: z.enum(['day', 'week', 'month', 'all']).default('week'),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const trending = await postService.getTrendingPosts({
        limit: input.limit,
        period: input.period,
      })

      return trending
    }),

  // Like a post
  like: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const result = await postService.likePost(
        input.postId,
        ctx.session.user.id
      )

      return result
    }),

  // Unlike a post
  unlike: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const result = await postService.unlikePost(
        input.postId,
        ctx.session.user.id
      )

      return result
    }),

  // Get posts by tag
  getByTag: publicProcedure
    .input(z.object({
      tag: z.string(),
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const posts = await postService.getPostsByTag({
        tag: input.tag,
        limit: input.limit,
        cursor: input.cursor,
        currentUserId: ctx.session?.user?.id,
      })

      return posts
    }),

  // Get related posts
  getRelated: publicProcedure
    .input(z.object({
      postId: z.string().cuid(),
      limit: z.number().min(1).max(10).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const related = await postService.getRelatedPosts(
        input.postId,
        input.limit
      )

      return related
    }),

  // Save/unsave post
  toggleSave: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const result = await postService.toggleSavePost(
        input.postId,
        ctx.session.user.id
      )

      return result
    }),

  // Get saved posts
  getSaved: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const saved = await postService.getSavedPosts({
        userId: ctx.session.user.id,
        limit: input.limit,
        cursor: input.cursor,
      })

      return saved
    }),

  // Publish/unpublish post
  togglePublish: protectedProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      // Check ownership
      const post = await postService.getPostById(input.postId)
      if (post.authorId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to publish/unpublish this post',
        })
      }

      const result = await postService.togglePublishPost(input.postId)
      return result
    }),

  // Get user's drafts
  getDrafts: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      
      const drafts = await postService.getUserDrafts({
        userId: ctx.session.user.id,
        limit: input.limit,
        cursor: input.cursor,
      })

      return drafts
    }),
})
