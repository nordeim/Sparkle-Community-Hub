// src/server/api/routers/comment.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  strictProcedure,
} from '@/server/api/trpc'
import { CommentService } from '@/server/services/comment.service'
import { createCommentSchema, updateCommentSchema } from '@/lib/validations/comment'
import { PAGINATION } from '@/config/constants'
import { ReactionType } from '@prisma/client'

export const commentRouter = createTRPCRouter({
  // Create a new comment
  create: protectedProcedure
    .input(createCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const comment = await commentService.createComment({
        ...input,
        authorId: ctx.session.user.id,
      })

      return comment
    }),

  // Update a comment
  update: protectedProcedure
    .input(updateCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      // Check ownership
      const comment = await commentService.getCommentById(input.id)
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        })
      }

      if (comment.authorId !== ctx.session.user.id && ctx.session.user.role !== 'ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to edit this comment',
        })
      }

      const updatedComment = await commentService.updateComment(
        input.id,
        input.content
      )

      return updatedComment
    }),

  // Delete a comment
  delete: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      // Check ownership or if user is post author
      const comment = await commentService.getCommentById(input.id)
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        })
      }

      const canDelete = 
        comment.authorId === ctx.session.user.id ||
        comment.post.authorId === ctx.session.user.id ||
        ctx.session.user.role === 'ADMIN' ||
        ctx.session.user.role === 'MODERATOR'

      if (!canDelete) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete this comment',
        })
      }

      await commentService.deleteComment(input.id)
      return { success: true }
    }),

  // Get comments for a post
  list: publicProcedure
    .input(z.object({
      postId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(PAGINATION.COMMENTS_LIMIT),
      cursor: z.string().optional(),
      sortBy: z.enum(['newest', 'oldest', 'popular']).default('newest'),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const comments = await commentService.listComments({
        ...input,
        currentUserId: ctx.session?.user?.id,
      })

      return comments
    }),

  // Get replies to a comment
  getReplies: publicProcedure
    .input(z.object({
      commentId: z.string().cuid(),
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const replies = await commentService.getReplies({
        ...input,
        currentUserId: ctx.session?.user?.id,
      })

      return replies
    }),

  // React to a comment
  react: protectedProcedure
    .input(z.object({
      commentId: z.string().cuid(),
      type: z.nativeEnum(ReactionType),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const result = await commentService.addReaction(
        input.commentId,
        ctx.session.user.id,
        input.type
      )

      return result
    }),

  // Remove reaction from a comment
  unreact: protectedProcedure
    .input(z.object({
      commentId: z.string().cuid(),
      type: z.nativeEnum(ReactionType),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const result = await commentService.removeReaction(
        input.commentId,
        ctx.session.user.id,
        input.type
      )

      return result
    }),

  // Get comment thread (comment with all replies)
  getThread: publicProcedure
    .input(z.object({
      commentId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const thread = await commentService.getCommentThread(
        input.commentId,
        ctx.session?.user?.id
      )

      return thread
    }),

  // Report a comment
  report: strictProcedure
    .input(z.object({
      commentId: z.string().cuid(),
      reason: z.enum(['SPAM', 'INAPPROPRIATE', 'HARASSMENT', 'MISINFORMATION', 'OTHER']),
      description: z.string().min(10).max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      // Check if comment exists
      const comment = await commentService.getCommentById(input.commentId)
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        })
      }

      // Prevent self-reporting
      if (comment.authorId === ctx.session.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You cannot report your own comment',
        })
      }

      const report = await commentService.reportComment({
        commentId: input.commentId,
        reporterId: ctx.session.user.id,
        reason: input.reason,
        description: input.description,
      })

      return report
    }),

  // Pin/unpin a comment (post author only)
  togglePin: protectedProcedure
    .input(z.object({
      commentId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      // Get comment with post info
      const comment = await commentService.getCommentById(input.commentId)
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        })
      }

      // Only post author can pin comments
      if (comment.post.authorId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the post author can pin comments',
        })
      }

      const result = await commentService.togglePinComment(input.commentId)
      return result
    }),

  // Get user's comment history
  getUserComments: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const comments = await commentService.getUserComments({
        ...input,
        currentUserId: ctx.session?.user?.id,
      })

      return comments
    }),

  // Search comments
  search: publicProcedure
    .input(z.object({
      query: z.string().min(2).max(100),
      postId: z.string().cuid().optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const results = await commentService.searchComments(input)
      return results
    }),

  // Get comment statistics for a post
  getStats: publicProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      
      const stats = await commentService.getCommentStats(input.postId)
      return stats
    }),

  // Subscribe to comment updates (for real-time)
  onCommentAdded: publicProcedure
    .input(z.object({
      postId: z.string().cuid(),
    }))
    .subscription(({ input }) => {
      // This would be implemented with WebSocket/SSE
      // Placeholder for now
      return {
        subscribe: () => {
          // Subscribe logic
        },
      }
    }),
})
