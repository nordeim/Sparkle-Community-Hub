// src/server/services/comment.service.ts
import { PrismaClient, Prisma, ReactionType, ReportReason } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { cache } from '@/lib/cache'
import { NotificationService } from './notification.service'
import { AnalyticsService } from './analytics.service'
import { ModerationService } from './moderation.service'
import { sanitizeHtml } from '@/lib/sanitize'
import { extractMentions } from '@/lib/utils'

interface CommentWithRelations {
  id: string
  content: string
  authorId: string
  postId: string
  parentId: string | null
  author: {
    id: string
    username: string
    image: string | null
    verified: boolean
  }
  post: {
    id: string
    authorId: string
    title: string
    slug: string
  }
  _count: {
    reactions: number
    replies: number
  }
  reactions?: Array<{
    type: ReactionType
    userId: string
  }>
  pinned?: boolean
  edited: boolean
  editedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class CommentService {
  private notificationService: NotificationService
  private analyticsService: AnalyticsService
  private moderationService: ModerationService

  constructor(private db: PrismaClient) {
    this.notificationService = new NotificationService(db)
    this.analyticsService = new AnalyticsService(db)
    this.moderationService = new ModerationService(db)
  }

  async createComment(input: {
    postId: string
    content: string
    authorId: string
    parentId?: string
  }): Promise<CommentWithRelations> {
    // Sanitize content
    const sanitizedContent = sanitizeHtml(input.content)

    // Check if post exists and is published
    const post = await this.db.post.findUnique({
      where: { id: input.postId },
      select: { 
        id: true, 
        authorId: true, 
        published: true,
        title: true,
        slug: true,
      },
    })

    if (!post || !post.published) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found or not published',
      })
    }

    // If replying, check parent comment exists
    if (input.parentId) {
      const parentComment = await this.db.comment.findUnique({
        where: { id: input.parentId },
        select: { id: true, postId: true, authorId: true },
      })

      if (!parentComment || parentComment.postId !== input.postId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid parent comment',
        })
      }
    }

    // Check for spam/rate limiting
    const recentComments = await this.db.comment.count({
      where: {
        authorId: input.authorId,
        createdAt: {
          gte: new Date(Date.now() - 60000), // Last minute
        },
      },
    })

    if (recentComments >= 5) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait before posting another comment',
      })
    }

    // Create comment
    const comment = await this.db.$transaction(async (tx) => {
      const newComment = await tx.comment.create({
        data: {
          content: sanitizedContent,
          postId: input.postId,
          authorId: input.authorId,
          parentId: input.parentId,
        },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              image: true,
              verified: true,
            },
          },
          post: {
            select: {
              id: true,
              authorId: true,
              title: true,
              slug: true,
            },
          },
          _count: {
            select: {
              reactions: true,
              replies: true,
            },
          },
        },
      })

      // Award XP for commenting
      await tx.xPLog.create({
        data: {
          userId: input.authorId,
          amount: 5,
          reason: 'Posted a comment',
          metadata: { commentId: newComment.id },
        },
      })

      await tx.user.update({
        where: { id: input.authorId },
        data: { experience: { increment: 5 } },
      })

      return newComment
    })

    // Extract mentions and notify mentioned users
    const mentions = extractMentions(sanitizedContent)
    if (mentions.length > 0) {
      await this.notifyMentionedUsers(mentions, comment)
    }

    // Notify post author (if not self-comment)
    if (post.authorId !== input.authorId) {
      await this.notificationService.createNotification({
        type: 'POST_COMMENTED',
        userId: post.authorId,
        actorId: input.authorId,
        entityId: comment.id,
        entityType: 'comment',
        message: `commented on your post "${post.title}"`,
        data: {
          postId: post.id,
          postSlug: post.slug,
          commentId: comment.id,
        },
      })
    }

    // Notify parent comment author if replying
    if (input.parentId) {
      const parentComment = await this.db.comment.findUnique({
        where: { id: input.parentId },
        select: { authorId: true },
      })

      if (parentComment && parentComment.authorId !== input.authorId) {
        await this.notificationService.createNotification({
          type: 'COMMENT_REPLIED' as any, // We'd add this type
          userId: parentComment.authorId,
          actorId: input.authorId,
          entityId: comment.id,
          entityType: 'comment',
          message: 'replied to your comment',
          data: {
            postId: post.id,
            postSlug: post.slug,
            commentId: comment.id,
            parentCommentId: input.parentId,
          },
        })
      }
    }

    // Check for auto-moderation
    await this.moderationService.checkComment(comment)

    // Track analytics
    await this.analyticsService.trackEvent({
      eventName: 'comment_created',
      userId: input.authorId,
      properties: {
        postId: input.postId,
        commentId: comment.id,
        isReply: !!input.parentId,
        contentLength: sanitizedContent.length,
      },
    })

    // Invalidate caches
    await this.invalidateCommentCaches(input.postId)

    // Emit real-time event
    this.emitCommentEvent('comment:created', {
      postId: input.postId,
      comment,
    })

    return comment
  }

  async updateComment(commentId: string, content: string): Promise<CommentWithRelations> {
    const sanitizedContent = sanitizeHtml(content)

    const comment = await this.db.comment.update({
      where: { id: commentId },
      data: {
        content: sanitizedContent,
        edited: true,
        editedAt: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
          },
        },
        post: {
          select: {
            id: true,
            authorId: true,
            title: true,
            slug: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            replies: true,
          },
        },
      },
    })

    // Check for new mentions
    const mentions = extractMentions(sanitizedContent)
    if (mentions.length > 0) {
      await this.notifyMentionedUsers(mentions, comment)
    }

    // Invalidate caches
    await this.invalidateCommentCaches(comment.postId)

    // Emit real-time event
    this.emitCommentEvent('comment:updated', {
      postId: comment.postId,
      comment,
    })

    return comment
  }

  async deleteComment(commentId: string): Promise<void> {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { postId: true, parentId: true },
    })

    if (!comment) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Comment not found',
      })
    }

    // Soft delete to preserve thread structure
    await this.db.comment.update({
      where: { id: commentId },
      data: {
        deleted: true,
        content: '[deleted]',
      },
    })

    // Invalidate caches
    await this.invalidateCommentCaches(comment.postId)

    // Emit real-time event
    this.emitCommentEvent('comment:deleted', {
      postId: comment.postId,
      commentId,
    })
  }

  async listComments(params: {
    postId: string
    limit: number
    cursor?: string
    sortBy?: 'newest' | 'oldest' | 'popular'
    currentUserId?: string
  }) {
    const where: Prisma.CommentWhereInput = {
      postId: params.postId,
      parentId: null, // Only top-level comments
      deleted: false,
    }

    // Determine ordering
    let orderBy: Prisma.CommentOrderByWithRelationInput | Prisma.CommentOrderByWithRelationInput[]
    switch (params.sortBy) {
      case 'oldest':
        orderBy = { createdAt: 'asc' }
        break
      case 'popular':
        orderBy = [
          { pinned: 'desc' },
          { reactions: { _count: 'desc' } },
          { replies: { _count: 'desc' } },
          { createdAt: 'desc' },
        ]
        break
      default: // newest
        orderBy = [
          { pinned: 'desc' },
          { createdAt: 'desc' },
        ]
    }

    const comments = await this.db.comment.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
            role: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            replies: {
              where: { deleted: false },
            },
          },
        },
        reactions: params.currentUserId ? {
          where: { userId: params.currentUserId },
          select: { type: true },
        } : false,
        replies: {
          where: { deleted: false },
          take: 3, // Preview of first 3 replies
          include: {
            author: {
              select: {
                id: true,
                username: true,
                image: true,
                verified: true,
              },
            },
            _count: {
              select: {
                reactions: true,
              },
            },
            reactions: params.currentUserId ? {
              where: { userId: params.currentUserId },
              select: { type: true },
            } : false,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy,
    })

    let nextCursor: string | undefined = undefined
    if (comments.length > params.limit) {
      const nextItem = comments.pop()
      nextCursor = nextItem!.id
    }

    // Format reactions for easier consumption
    const formattedComments = comments.map(comment => ({
      ...comment,
      userReactions: params.currentUserId 
        ? (comment.reactions as any[]).map(r => r.type)
        : [],
      reactions: undefined, // Remove raw reactions data
      replies: {
        items: comment.replies.map(reply => ({
          ...reply,
          userReactions: params.currentUserId 
            ? (reply.reactions as any[]).map(r => r.type)
            : [],
          reactions: undefined,
        })),
        hasMore: comment._count.replies > 3,
        totalCount: comment._count.replies,
      },
    }))

    return {
      items: formattedComments,
      nextCursor,
    }
  }

  async getReplies(params: {
    commentId: string
    limit: number
    cursor?: string
    currentUserId?: string
  }) {
    const replies = await this.db.comment.findMany({
      where: {
        parentId: params.commentId,
        deleted: false,
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
            role: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            replies: {
              where: { deleted: false },
            },
          },
        },
        reactions: params.currentUserId ? {
          where: { userId: params.currentUserId },
          select: { type: true },
        } : false,
      },
      orderBy: { createdAt: 'asc' },
    })

    let nextCursor: string | undefined = undefined
    if (replies.length > params.limit) {
      const nextItem = replies.pop()
      nextCursor = nextItem!.id
    }

    const formattedReplies = replies.map(reply => ({
      ...reply,
      userReactions: params.currentUserId 
        ? (reply.reactions as any[]).map(r => r.type)
        : [],
      reactions: undefined,
    }))

    return {
      items: formattedReplies,
      nextCursor,
    }
  }

  async addReaction(commentId: string, userId: string, type: ReactionType) {
    // Check if comment exists
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { authorId: true, postId: true },
    })

    if (!comment) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Comment not found',
      })
    }

    // Check if already reacted with same type
    const existingReaction = await this.db.reaction.findUnique({
      where: {
        commentId_userId_type: {
          commentId,
          userId,
          type,
        },
      },
    })

    if (existingReaction) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Already reacted to this comment',
      })
    }

    // Remove other reactions from same user (only one reaction type allowed)
    await this.db.reaction.deleteMany({
      where: {
        commentId,
        userId,
      },
    })

    // Create new reaction
    await this.db.reaction.create({
      data: {
        commentId,
        userId,
        type,
      },
    })

    // Notify comment author (if not self-reaction)
    if (comment.authorId !== userId) {
      await this.notificationService.createNotification({
        type: 'COMMENT_LIKED',
        userId: comment.authorId,
        actorId: userId,
        entityId: commentId,
        entityType: 'comment',
        message: `reacted to your comment with ${type.toLowerCase()}`,
        data: {
          postId: comment.postId,
          commentId,
          reactionType: type,
        },
      })
    }

    // Get updated reaction counts
    const reactionCounts = await this.getReactionCounts(commentId)

    // Emit real-time event
    this.emitCommentEvent('comment:reacted', {
      postId: comment.postId,
      commentId,
      userId,
      type,
      counts: reactionCounts,
    })

    return { success: true, counts: reactionCounts }
  }

  async removeReaction(commentId: string, userId: string, type: ReactionType) {
    const deleted = await this.db.reaction.deleteMany({
      where: {
        commentId,
        userId,
        type,
      },
    })

    if (deleted.count === 0) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Reaction not found',
      })
    }

    // Get updated reaction counts
    const reactionCounts = await this.getReactionCounts(commentId)

    // Get post ID for real-time event
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { postId: true },
    })

    if (comment) {
      // Emit real-time event
      this.emitCommentEvent('comment:unreacted', {
        postId: comment.postId,
        commentId,
        userId,
        type,
        counts: reactionCounts,
      })
    }

    return { success: true, counts: reactionCounts }
  }

  async getCommentThread(commentId: string, currentUserId?: string) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
            role: true,
          },
        },
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
            authorId: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            replies: {
              where: { deleted: false },
            },
          },
        },
        reactions: {
          select: {
            type: true,
            user: {
              select: {
                id: true,
                username: true,
                image: true,
              },
            },
          },
        },
      },
    })

    if (!comment || comment.deleted) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Comment not found',
      })
    }

    // Get all replies recursively
    const replies = await this.getThreadReplies(commentId, currentUserId)

    // Format user reactions
    const userReactions = currentUserId 
      ? comment.reactions
          .filter(r => r.user.id === currentUserId)
          .map(r => r.type)
      : []

    // Group reactions by type
    const reactionsByType = comment.reactions.reduce((acc, reaction) => {
      if (!acc[reaction.type]) {
        acc[reaction.type] = []
      }
      acc[reaction.type].push(reaction.user)
      return acc
    }, {} as Record<ReactionType, typeof comment.reactions[0]['user'][]>)

    return {
      ...comment,
      userReactions,
      reactionsByType,
      reactions: undefined,
      replies,
    }
  }

  async reportComment(input: {
    commentId: string
    reporterId: string
    reason: ReportReason
    description?: string
  }) {
    // Check for existing report from same user
    const existingReport = await this.db.report.findFirst({
      where: {
        entityId: input.commentId,
        entityType: 'comment',
        reporterId: input.reporterId,
        status: 'PENDING',
      },
    })

    if (existingReport) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'You have already reported this comment',
      })
    }

    const report = await this.db.report.create({
      data: {
        entityId: input.commentId,
        entityType: 'comment',
        reporterId: input.reporterId,
        reason: input.reason,
        description: input.description,
      },
    })

    // Check if comment needs auto-moderation
    const reportCount = await this.db.report.count({
      where: {
        entityId: input.commentId,
        entityType: 'comment',
        status: 'PENDING',
      },
    })

    if (reportCount >= 3) {
      // Auto-hide comment for moderation
      await this.db.comment.update({
        where: { id: input.commentId },
        data: { 
          // Add a hidden field to schema
          // hidden: true 
        },
      })
    }

    return report
  }

  async togglePinComment(commentId: string) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { postId: true, pinned: true },
    })

    if (!comment) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Comment not found',
      })
    }

    // If pinning, unpin other comments on the same post
    if (!comment.pinned) {
      await this.db.comment.updateMany({
        where: {
          postId: comment.postId,
          pinned: true,
        },
        data: { pinned: false },
      })
    }

    const updatedComment = await this.db.comment.update({
      where: { id: commentId },
      data: { pinned: !comment.pinned },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
          },
        },
      },
    })

    // Invalidate caches
    await this.invalidateCommentCaches(comment.postId)

    // Emit real-time event
    this.emitCommentEvent('comment:pinned', {
      postId: comment.postId,
      commentId,
      pinned: updatedComment.pinned,
    })

    return { pinned: updatedComment.pinned }
  }

  async getUserComments(params: {
    userId: string
    limit: number
    cursor?: string
    currentUserId?: string
  }) {
    const comments = await this.db.comment.findMany({
      where: {
        authorId: params.userId,
        deleted: false,
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
            author: {
              select: {
                username: true,
                image: true,
              },
            },
          },
        },
        _count: {
          select: {
            reactions: true,
            replies: {
              where: { deleted: false },
            },
          },
        },
        reactions: params.currentUserId ? {
          where: { userId: params.currentUserId },
          select: { type: true },
        } : false,
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (comments.length > params.limit) {
      const nextItem = comments.pop()
      nextCursor = nextItem!.id
    }

    const formattedComments = comments.map(comment => ({
      ...comment,
      userReactions: params.currentUserId 
        ? (comment.reactions as any[]).map(r => r.type)
        : [],
      reactions: undefined,
    }))

    return {
      items: formattedComments,
      nextCursor,
    }
  }

  async searchComments(params: {
    query: string
    postId?: string
    limit: number
  }) {
    const where: Prisma.CommentWhereInput = {
      content: {
        contains: params.query,
        mode: 'insensitive',
      },
      deleted: false,
    }

    if (params.postId) {
      where.postId = params.postId
    }

    const comments = await this.db.comment.findMany({
      where,
      take: params.limit,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
          },
        },
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return comments
  }

  async getCommentStats(postId: string) {
    const [totalComments, uniqueCommenters, mostReactedComment] = await Promise.all([
      // Total comments
      this.db.comment.count({
        where: {
          postId,
          deleted: false,
        },
      }),
      
      // Unique commenters
      this.db.comment.groupBy({
        by: ['authorId'],
        where: {
          postId,
          deleted: false,
        },
        _count: true,
      }),
      
      // Most reacted comment
      this.db.comment.findFirst({
        where: {
          postId,
          deleted: false,
        },
        orderBy: {
          reactions: {
            _count: 'desc',
          },
        },
        include: {
          author: {
            select: {
              username: true,
              image: true,
            },
          },
          _count: {
            select: {
              reactions: true,
            },
          },
        },
      }),
    ])

    // Get reaction distribution
    const reactionDistribution = await this.db.reaction.groupBy({
      by: ['type'],
      where: {
        comment: {
          postId,
          deleted: false,
        },
      },
      _count: true,
    })

    return {
      totalComments,
      uniqueCommenters: uniqueCommenters.length,
      mostReactedComment,
      reactionDistribution: reactionDistribution.reduce((acc, item) => {
        acc[item.type] = item._count
        return acc
      }, {} as Record<ReactionType, number>),
      averageCommentsPerUser: totalComments / (uniqueCommenters.length || 1),
    }
  }

  async getCommentById(commentId: string) {
    return this.db.comment.findUnique({
      where: { id: commentId },
      include: {
        author: true,
        post: true,
      },
    })
  }

  // Private helper methods
  private async getReactionCounts(commentId: string) {
    const reactions = await this.db.reaction.groupBy({
      by: ['type'],
      where: { commentId },
      _count: true,
    })

    return reactions.reduce((acc, item) => {
      acc[item.type] = item._count
      return acc
    }, {} as Record<ReactionType, number>)
  }

  private async getThreadReplies(
    parentId: string, 
    currentUserId?: string,
    maxDepth: number = 10,
    currentDepth: number = 0
  ): Promise<any[]> {
    if (currentDepth >= maxDepth) return []

    const replies = await this.db.comment.findMany({
      where: {
        parentId,
        deleted: false,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
            role: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            replies: {
              where: { deleted: false },
            },
          },
        },
        reactions: currentUserId ? {
          where: { userId: currentUserId },
          select: { type: true },
        } : false,
      },
      orderBy: { createdAt: 'asc' },
    })

    const formattedReplies = await Promise.all(
      replies.map(async (reply) => {
        const nestedReplies = await this.getThreadReplies(
          reply.id,
          currentUserId,
          maxDepth,
          currentDepth + 1
        )

        return {
          ...reply,
          userReactions: currentUserId 
            ? (reply.reactions as any[]).map(r => r.type)
            : [],
          reactions: undefined,
          replies: nestedReplies,
        }
      })
    )

    return formattedReplies
  }

  private async notifyMentionedUsers(mentions: string[], comment: CommentWithRelations) {
    const users = await this.db.user.findMany({
      where: {
        username: { in: mentions },
        id: { not: comment.authorId }, // Don't notify self
      },
      select: { id: true },
    })

    const notifications = users.map(user => ({
      type: 'MENTION' as const,
      userId: user.id,
      actorId: comment.authorId,
      entityId: comment.id,
      entityType: 'comment' as const,
      message: `mentioned you in a comment`,
      data: {
        postId: comment.postId,
        postSlug: comment.post.slug,
        commentId: comment.id,
      },
    }))

    if (notifications.length > 0) {
      await this.db.notification.createMany({
        data: notifications,
      })
    }
  }

  private async invalidateCommentCaches(postId: string) {
    await cache.del(`comments:${postId}:*`)
    await cache.del(`post:stats:${postId}`)
  }

  private emitCommentEvent(event: string, data: any) {
    // This would emit to WebSocket/SSE
    // Implementation depends on real-time service
    console.log(`Emitting ${event}:`, data)
  }
}
