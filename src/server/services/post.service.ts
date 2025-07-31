// src/server/services/post.service.ts
import { PrismaClient, Prisma, ReactionType } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { generateSlug } from '@/lib/utils'
import { cache } from '@/lib/cache'
import { NotificationService } from './notification.service'
import { AnalyticsService } from './analytics.service'
import { SearchService } from './search.service'

export class PostService {
  private notificationService: NotificationService
  private analyticsService: AnalyticsService
  private searchService: SearchService

  constructor(private db: PrismaClient) {
    this.notificationService = new NotificationService(db)
    this.analyticsService = new AnalyticsService(db)
    this.searchService = new SearchService(db)
  }

  async createPost(input: {
    title: string
    content: string
    excerpt?: string
    tags?: string[]
    authorId: string
    youtubeVideoId?: string
    coverImage?: string
    published?: boolean
  }) {
    const slug = await this.generateUniqueSlug(input.title)
    
    // Calculate reading time (words per minute)
    const wordCount = input.content.split(/\s+/).length
    const readingTime = Math.ceil(wordCount / 200) // 200 words per minute

    const post = await this.db.$transaction(async (tx) => {
      // Create post
      const newPost = await tx.post.create({
        data: {
          title: input.title,
          content: input.content,
          excerpt: input.excerpt || this.generateExcerpt(input.content),
          slug,
          authorId: input.authorId,
          youtubeVideoId: input.youtubeVideoId,
          coverImage: input.coverImage,
          published: input.published ?? false,
          publishedAt: input.published ? new Date() : null,
          readingTime,
          metaDescription: input.excerpt || this.generateExcerpt(input.content, 160),
        },
        include: {
          author: {
            include: { profile: true },
          },
          tags: true,
          _count: {
            select: {
              comments: true,
              reactions: true,
            },
          },
        },
      })

      // Handle tags
      if (input.tags && input.tags.length > 0) {
        const tagConnections = await Promise.all(
          input.tags.map(async (tagName) => {
            const tag = await tx.tag.upsert({
              where: { name: tagName.toLowerCase() },
              create: {
                name: tagName.toLowerCase(),
                slug: generateSlug(tagName),
              },
              update: {},
            })

            await tx.postTag.create({
              data: {
                postId: newPost.id,
                tagId: tag.id,
              },
            })

            return tag
          })
        )

        // Update post with tags
        newPost.tags = tagConnections.map(tag => ({
          postId: newPost.id,
          tagId: tag.id,
          tag,
          createdAt: new Date(),
        })) as any
      }

      // Award XP for creating post
      await tx.xPLog.create({
        data: {
          userId: input.authorId,
          amount: 50,
          reason: 'Created a post',
          metadata: { postId: newPost.id },
        },
      })

      await tx.user.update({
        where: { id: input.authorId },
        data: { experience: { increment: 50 } },
      })

      return newPost
    })

    // Queue for search indexing
    await this.searchService.queueForIndexing('post', post.id, 'create')

    // If published, notify followers
    if (post.published) {
      this.notifyFollowersAboutNewPost(post.authorId, post.id).catch(console.error)
    }

    // Track analytics
    await this.analyticsService.trackEvent({
      eventName: 'post_created',
      userId: input.authorId,
      properties: {
        postId: post.id,
        published: post.published,
        hasTags: input.tags && input.tags.length > 0,
        hasYouTubeVideo: !!input.youtubeVideoId,
      },
    })

    return post
  }

  async updatePost(postId: string, input: {
    title?: string
    content?: string
    excerpt?: string
    tags?: string[]
    youtubeVideoId?: string | null
    coverImage?: string | null
  }) {
    const existingPost = await this.db.post.findUnique({
      where: { id: postId },
      include: { tags: true },
    })

    if (!existingPost) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    // Update slug if title changed
    let slug = existingPost.slug
    if (input.title && input.title !== existingPost.title) {
      slug = await this.generateUniqueSlug(input.title, existingPost.id)
    }

    // Calculate reading time if content changed
    let readingTime = existingPost.readingTime
    if (input.content) {
      const wordCount = input.content.split(/\s+/).length
      readingTime = Math.ceil(wordCount / 200)
    }

    const post = await this.db.$transaction(async (tx) => {
      // Update post
      const updatedPost = await tx.post.update({
        where: { id: postId },
        data: {
          title: input.title,
          content: input.content,
          excerpt: input.excerpt,
          slug,
          youtubeVideoId: input.youtubeVideoId,
          coverImage: input.coverImage,
          readingTime,
          metaDescription: input.excerpt || (input.content ? this.generateExcerpt(input.content, 160) : undefined),
        },
        include: {
          author: {
            include: { profile: true },
          },
          tags: true,
          _count: {
            select: {
              comments: true,
              reactions: true,
            },
          },
        },
      })

      // Update tags if provided
      if (input.tags !== undefined) {
        // Remove existing tags
        await tx.postTag.deleteMany({
          where: { postId },
        })

        // Add new tags
        if (input.tags.length > 0) {
          const tagConnections = await Promise.all(
            input.tags.map(async (tagName) => {
              const tag = await tx.tag.upsert({
                where: { name: tagName.toLowerCase() },
                create: {
                  name: tagName.toLowerCase(),
                  slug: generateSlug(tagName),
                },
                update: {},
              })

              await tx.postTag.create({
                data: {
                  postId: updatedPost.id,
                  tagId: tag.id,
                },
              })

              return tag
            })
          )

          updatedPost.tags = tagConnections.map(tag => ({
            postId: updatedPost.id,
            tagId: tag.id,
            tag,
            createdAt: new Date(),
          })) as any
        }
      }

      return updatedPost
    })

    // Invalidate caches
    await cache.del(cache.keys.post(post.slug))
    await cache.del(cache.keys.post(existingPost.slug))

    // Update search index
    await this.searchService.queueForIndexing('post', post.id, 'update')

    return post
  }

  async deletePost(postId: string) {
    const post = await this.db.post.delete({
      where: { id: postId },
    })

    // Invalidate cache
    await cache.del(cache.keys.post(post.slug))

    // Remove from search index
    await this.searchService.queueForIndexing('post', post.id, 'delete')

    return { success: true }
  }

  async getPostById(postId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          include: { profile: true },
        },
        tags: {
          include: { tag: true },
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

    return post
  }

  async getPostBySlug(slug: string) {
    // Try cache first
    const cacheKey = cache.keys.post(slug)
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    const post = await this.db.post.findUnique({
      where: { slug, published: true },
      include: {
        author: {
          include: { 
            profile: true,
            _count: {
              select: {
                followers: true,
                posts: { where: { published: true } },
              },
            },
          },
        },
        tags: {
          include: { tag: true },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    })

    if (post) {
      // Cache for 5 minutes
      await cache.set(cacheKey, post, 300)
    }

    return post
  }

  async listPosts(params: {
    limit: number
    cursor?: string
    authorId?: string
    tag?: string
    featured?: boolean
    orderBy?: 'recent' | 'popular' | 'trending'
    currentUserId?: string
  }) {
    const where: Prisma.PostWhereInput = {
      published: true,
      authorId: params.authorId,
      featured: params.featured,
    }

    if (params.tag) {
      where.tags = {
        some: {
          tag: {
            name: params.tag.toLowerCase(),
          },
        },
      }
    }

    // Determine ordering
    let orderBy: Prisma.PostOrderByWithRelationInput | Prisma.PostOrderByWithRelationInput[]
    switch (params.orderBy) {
      case 'popular':
        orderBy = [
          { reactions: { _count: 'desc' } },
          { views: 'desc' },
          { createdAt: 'desc' },
        ]
        break
      case 'trending':
        // For trending, we'll use a custom query later
        orderBy = { createdAt: 'desc' }
        break
      default:
        orderBy = { publishedAt: 'desc' }
    }

    const posts = await this.db.post.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: { profile: true },
        },
        tags: {
          include: { tag: true },
        },
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

    // Check if current user has liked these posts
    let likedPosts: Set<string> = new Set()
    if (params.currentUserId) {
      const likes = await this.db.reaction.findMany({
        where: {
          userId: params.currentUserId,
          postId: { in: posts.map(p => p.id) },
          type: 'LIKE',
        },
        select: { postId: true },
      })
      likedPosts = new Set(likes.map(l => l.postId!))
    }

    return {
      items: posts.map(post => ({
        ...post,
        isLiked: likedPosts.has(post.id),
      })),
      nextCursor,
    }
  }

  async getUserFeed(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    // Get posts from users that the current user follows
    const posts = await this.db.post.findMany({
      where: {
        published: true,
        author: {
          followers: {
            some: {
              followerId: params.userId,
            },
          },
        },
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: { profile: true },
        },
        tags: {
          include: { tag: true },
        },
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

    // Check liked posts
    const likes = await this.db.reaction.findMany({
      where: {
        userId: params.userId,
        postId: { in: posts.map(p => p.id) },
        type: 'LIKE',
      },
      select: { postId: true },
    })
    const likedPosts = new Set(likes.map(l => l.postId!))

    return {
      items: posts.map(post => ({
        ...post,
        isLiked: likedPosts.has(post.id),
      })),
      nextCursor,
    }
  }

  async getTrendingPosts(params: {
    limit: number
    period: 'day' | 'week' | 'month' | 'all'
  }) {
    let dateFilter = new Date()
    switch (params.period) {
      case 'day':
        dateFilter.setDate(dateFilter.getDate() - 1)
        break
      case 'week':
        dateFilter.setDate(dateFilter.getDate() - 7)
        break
      case 'month':
        dateFilter.setMonth(dateFilter.getMonth() - 1)
        break
    }

    const posts = await this.db.$queryRaw<any[]>`
      SELECT 
        p.*,
        u.username as author_username,
        u.image as author_image,
        COUNT(DISTINCT r.id) as reaction_count,
        COUNT(DISTINCT c.id) as comment_count,
        (
          COUNT(DISTINCT r.id) * 3 + 
          COUNT(DISTINCT c.id) * 2 + 
          p.views * 0.1 +
          CASE WHEN p."publishedAt" > NOW() - INTERVAL '24 hours' THEN 20 ELSE 0 END
        ) as trending_score
      FROM posts p
      INNER JOIN users u ON u.id = p."authorId"
      LEFT JOIN reactions r ON r."postId" = p.id
      LEFT JOIN comments c ON c."postId" = p.id
      WHERE p.published = true
      ${params.period !== 'all' ? `AND p."publishedAt" > $1::timestamp` : ''}
      GROUP BY p.id, u.username, u.image
      ORDER BY trending_score DESC
      LIMIT ${params.limit}
    `

    return posts
  }

  async likePost(postId: string, userId: string) {
    // Check if already liked
    const existingReaction = await this.db.reaction.findUnique({
      where: {
        postId_userId_type: {
          postId,
          userId,
          type: 'LIKE',
        },
      },
    })

    if (existingReaction) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Already liked this post',
      })
    }

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

    // Create reaction
    await this.db.reaction.create({
      data: {
        postId,
        userId,
        type: 'LIKE',
      },
    })

    // Create notification (if not liking own post)
    if (post.authorId !== userId) {
      await this.notificationService.createNotification({
        type: 'POST_LIKED',
        userId: post.authorId,
        actorId: userId,
        entityId: postId,
        entityType: 'post',
        message: 'liked your post',
      })
    }

    // Track analytics
    await this.analyticsService.trackEvent({
      eventName: 'post_liked',
      userId,
      properties: { postId },
    })

    // Get updated count
    const count = await this.db.reaction.count({
      where: { postId, type: 'LIKE' },
    })

    return { liked: true, count }
  }

  async unlikePost(postId: string, userId: string) {
    const deleted = await this.db.reaction.delete({
      where: {
        postId_userId_type: {
          postId,
          userId,
          type: 'LIKE',
        },
      },
    }).catch(() => null)

    if (!deleted) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Like not found',
      })
    }

    // Get updated count
    const count = await this.db.reaction.count({
      where: { postId, type: 'LIKE' },
    })

    return { liked: false, count }
  }

  async hasUserLikedPost(userId: string, postId: string): Promise<boolean> {
    const reaction = await this.db.reaction.findUnique({
      where: {
        postId_userId_type: {
          postId,
          userId,
          type: 'LIKE',
        },
      },
    })

    return !!reaction
  }

  async incrementViews(postId: string) {
    await this.db.post.update({
      where: { id: postId },
      data: { views: { increment: 1 } },
    })
  }

  async getPostsByTag(params: {
    tag: string
    limit: number
    cursor?: string
    currentUserId?: string
  }) {
    const posts = await this.db.post.findMany({
      where: {
        published: true,
        tags: {
          some: {
            tag: {
              name: params.tag.toLowerCase(),
            },
          },
        },
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: { profile: true },
        },
        tags: {
          include: { tag: true },
        },
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

    // Check liked posts
    let likedPosts: Set<string> = new Set()
    if (params.currentUserId) {
      const likes = await this.db.reaction.findMany({
        where: {
          userId: params.currentUserId,
          postId: { in: posts.map(p => p.id) },
          type: 'LIKE',
        },
        select: { postId: true },
      })
      likedPosts = new Set(likes.map(l => l.postId!))
    }

    return {
      items: posts.map(post => ({
        ...post,
        isLiked: likedPosts.has(post.id),
      })),
      nextCursor,
    }
  }

  async getRelatedPosts(postId: string, limit: number) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: {
        tags: {
          select: { tagId: true },
        },
      },
    })

    if (!post) {
      return []
    }

    // Find posts with similar tags
    const relatedPosts = await this.db.post.findMany({
      where: {
        id: { not: postId },
        published: true,
        OR: [
          // Same author
          { authorId: post.authorId },
          // Similar tags
          {
            tags: {
              some: {
                tagId: { in: post.tags.map(t => t.tagId) },
              },
            },
          },
        ],
      },
      include: {
        author: {
          include: { profile: true },
        },
        tags: {
          include: { tag: true },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: [
        { reactions: { _count: 'desc' } },
        { views: 'desc' },
      ],
      take: limit,
    })

    return relatedPosts
  }

  async toggleSavePost(postId: string, userId: string) {
    // This would require a SavedPost model
    // For now, returning a placeholder
    return { saved: true }
  }

  async getSavedPosts(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    // This would require a SavedPost model
    // For now, returning empty
    return {
      items: [],
      nextCursor: undefined,
    }
  }

  async togglePublishPost(postId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { published: true, authorId: true },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    const updatedPost = await this.db.post.update({
      where: { id: postId },
      data: {
        published: !post.published,
        publishedAt: !post.published ? new Date() : null,
      },
    })

    // If newly published, notify followers
    if (updatedPost.published && !post.published) {
      this.notifyFollowersAboutNewPost(post.authorId, postId).catch(console.error)
    }

    // Update search index
    await this.searchService.queueForIndexing('post', postId, updatedPost.published ? 'create' : 'delete')

    return { published: updatedPost.published }
  }

  async getUserDrafts(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const drafts = await this.db.post.findMany({
      where: {
        authorId: params.userId,
        published: false,
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        tags: {
          include: { tag: true },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
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

  private async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    let slug = generateSlug(title)
    let counter = 1
    let finalSlug = slug

    while (true) {
      const existing = await this.db.post.findFirst({
        where: {
          slug: finalSlug,
          id: excludeId ? { not: excludeId } : undefined,
        },
      })

      if (!existing) break

      finalSlug = `${slug}-${counter}`
      counter++
    }

    return finalSlug
  }

  private generateExcerpt(content: string, maxLength: number = 200): string {
    // Strip HTML tags and trim
    const text = content.replace(/<[^>]*>/g, '').trim()
    
    if (text.length <= maxLength) return text
    
    // Find the last complete word within maxLength
    const truncated = text.substring(0, maxLength)
    const lastSpace = truncated.lastIndexOf(' ')
    
    return `${truncated.substring(0, lastSpace)}...`
  }

  private async notifyFollowersAboutNewPost(authorId: string, postId: string) {
    const followers = await this.db.follow.findMany({
      where: { followingId: authorId },
      select: { followerId: true },
    })

    const notifications = followers.map(f => ({
      type: 'POST_PUBLISHED' as const,
      userId: f.followerId,
      actorId: authorId,
      entityId: postId,
      entityType: 'post',
      message: 'published a new post',
    }))

    // Batch create notifications
    if (notifications.length > 0) {
      await this.db.notification.createMany({
        data: notifications,
      })
    }
  }
}
