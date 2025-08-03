// src/server/services/recommendation.service.ts
import { PrismaClient } from '@prisma/client'
import { CacheService } from './cache.service'

export class RecommendationService {
  private cacheService: CacheService

  constructor(private db: PrismaClient) {
    this.cacheService = new CacheService()
  }

  async getRecommendedPosts(userId: string, limit: number = 10) {
    const cacheKey = `recommendations:posts:${userId}`
    const cached = await this.cacheService.get(cacheKey)
    if (cached) return cached

    // Get user's interests based on their activity
    const userInterests = await this.getUserInterests(userId)
    
    // Get posts based on interests
    const posts = await this.db.post.findMany({
      where: {
        published: true,
        authorId: { not: userId },
        OR: [
          // Posts with similar tags
          {
            tags: {
              some: {
                tagId: { in: userInterests.tagIds },
              },
            },
          },
          // Posts from followed users
          {
            author: {
              followers: {
                some: { followerId: userId },
              },
            },
          },
          // Popular posts in user's categories
          {
            categoryId: { in: userInterests.categoryIds },
            views: { gte: 100 },
          },
        ],
      },
      include: {
        author: {
          include: {
            profile: true,
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
      },
      orderBy: [
        { views: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    })

    // Cache for 30 minutes
    await this.cacheService.set(cacheKey, posts, 1800)

    return posts
  }

  private async getUserInterests(userId: string) {
    // Get user's recent activity
    const [viewedPosts, likedPosts, commentedPosts] = await Promise.all([
      // Recently viewed posts
      this.db.viewHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          post: {
            include: {
              tags: true,
            },
          },
        },
      }),
      // Recently liked posts
      this.db.reaction.findMany({
        where: { userId, postId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          post: {
            include: {
              tags: true,
            },
          },
        },
      }),
      // Recently commented posts
      this.db.comment.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          post: {
            include: {
              tags: true,
            },
          },
        },
      }),
    ])

    // Extract tags and categories
    const tagIds = new Set<string>()
    const categoryIds = new Set<string>()

    const processPost = (post: any) => {
      if (post) {
        post.tags?.forEach((t: any) => tagIds.add(t.tagId || t.id))
        if (post.categoryId) categoryIds.add(post.categoryId)
      }
    }

    viewedPosts.forEach(v => processPost(v.post))
    likedPosts.forEach(r => processPost(r.post))
    commentedPosts.forEach(c => processPost(c.post))

    return {
      tagIds: Array.from(tagIds),
      categoryIds
