// src/server/services/user.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import bcrypt from 'bcryptjs'
import { cache } from '@/lib/cache'
import { NotificationService } from './notification.service'
import { AnalyticsService } from './analytics.service'
import { generateUsername } from '@/lib/utils'

export class UserService {
  private notificationService: NotificationService
  private analyticsService: AnalyticsService

  constructor(private db: PrismaClient) {
    this.notificationService = new NotificationService(db)
    this.analyticsService = new AnalyticsService(db)
  }

  async getProfileByUsername(username: string) {
    // Try cache first
    const cacheKey = cache.keys.user(username)
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    const user = await this.db.user.findUnique({
      where: { username },
      include: {
        profile: true,
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
      // Cache for 5 minutes
      await cache.set(cacheKey, user, 300)
    }

    return user
  }

  async getFullProfile(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          include: {
            user: {
              select: {
                verified: true,
                role: true,
              },
            },
          },
        },
        _count: {
          select: {
            posts: true,
            comments: true,
            followers: true,
            following: true,
            notifications: { where: { read: false } },
          },
        },
        achievements: {
          include: {
            achievement: true,
          },
          orderBy: { unlockedAt: 'desc' },
          take: 5,
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

  async updateProfile(userId: string, data: any) {
    const updateData: any = {}
    const profileData: any = {}

    // Separate user and profile fields
    if (data.username !== undefined) updateData.username = data.username
    if (data.bio !== undefined) updateData.bio = data.bio
    if (data.image !== undefined) updateData.image = data.image

    if (data.displayName !== undefined) profileData.displayName = data.displayName
    if (data.location !== undefined) profileData.location = data.location
    if (data.website !== undefined) profileData.website = data.website
    if (data.twitterUsername !== undefined) profileData.twitterUsername = data.twitterUsername
    if (data.youtubeChannelId !== undefined) profileData.youtubeChannelId = data.youtubeChannelId
    if (data.bannerImage !== undefined) profileData.bannerImage = data.bannerImage

    const result = await this.db.$transaction(async (tx) => {
      // Update user
      const user = await tx.user.update({
        where: { id: userId },
        data: updateData,
      })

      // Update or create profile
      if (Object.keys(profileData).length > 0) {
        await tx.profile.upsert({
          where: { userId },
          create: { userId, ...profileData },
          update: profileData,
        })
      }

      return user
    })

    // Invalidate cache
    await cache.invalidatePattern(`user:${result.username}`)

    // Track profile update
    await this.analyticsService.trackEvent({
      eventName: 'profile_updated',
      userId,
      properties: { fields: Object.keys(data) },
    })

    return result
  }

  async updateSettings(userId: string, settings: any) {
    const profile = await this.db.profile.upsert({
      where: { userId },
      create: {
        userId,
        notificationSettings: settings.notifications || {},
        privacySettings: settings.privacy || {},
        themePreference: settings.theme || {},
      },
      update: {
        notificationSettings: settings.notifications || {},
        privacySettings: settings.privacy || {},
        themePreference: settings.theme || {},
      },
    })

    return profile
  }

  async followUser(followerId: string, followingId: string) {
    // Check if already following
    const existingFollow = await this.db.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    if (existingFollow) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Already following this user',
      })
    }

    // Check if target user exists
    const targetUser = await this.db.user.findUnique({
      where: { id: followingId },
      select: { username: true },
    })

    if (!targetUser) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    // Create follow relationship
    const follow = await this.db.follow.create({
      data: {
        followerId,
        followingId,
      },
    })

    // Create notification
    await this.notificationService.createNotification({
      type: 'USER_FOLLOWED',
      userId: followingId,
      actorId: followerId,
      message: 'started following you',
    })

    // Track event
    await this.analyticsService.trackEvent({
      eventName: 'user_followed',
      userId: followerId,
      properties: { targetUserId: followingId },
    })

    // Invalidate caches
    await cache.invalidatePattern(`user:${followerId}`)
    await cache.invalidatePattern(`user:${followingId}`)

    return follow
  }

  async unfollowUser(followerId: string, followingId: string) {
    const deleted = await this.db.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    }).catch(() => null)

    if (!deleted) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Not following this user',
      })
    }

    // Invalidate caches
    await cache.invalidatePattern(`user:${followerId}`)
    await cache.invalidatePattern(`user:${followingId}`)

    return { success: true }
  }

  async getFollowers(params: {
    userId: string
    limit: number
    cursor?: string
    currentUserId?: string
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
                posts: { where: { published: true } },
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

    // Check if current user follows these users
    let followingStatus: Record<string, boolean> = {}
    if (params.currentUserId) {
      const followingIds = followers.map(f => f.follower.id)
      const following = await this.db.follow.findMany({
        where: {
          followerId: params.currentUserId,
          followingId: { in: followingIds },
        },
        select: { followingId: true },
      })
      
      followingStatus = following.reduce((acc, f) => {
        acc[f.followingId] = true
        return acc
      }, {} as Record<string, boolean>)
    }

    return {
      items: followers.map(f => ({
        ...f.follower,
        isFollowing: followingStatus[f.follower.id] || false,
      })),
      nextCursor,
    }
  }

  async getFollowing(params: {
    userId: string
    limit: number
    cursor?: string
    currentUserId?: string
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
                posts: { where: { published: true } },
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

    // Check if current user follows these users
    let followingStatus: Record<string, boolean> = {}
    if (params.currentUserId) {
      const followingIds = following.map(f => f.following.id)
      const follows = await this.db.follow.findMany({
        where: {
          followerId: params.currentUserId,
          followingId: { in: followingIds },
        },
        select: { followingId: true },
      })
      
      followingStatus = follows.reduce((acc, f) => {
        acc[f.followingId] = true
        return acc
      }, {} as Record<string, boolean>)
    }

    return {
      items: following.map(f => ({
        ...f.following,
        isFollowing: followingStatus[f.following.id] || false,
      })),
      nextCursor,
    }
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await this.db.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    return !!follow
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
        ],
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        profile: true,
        _count: {
          select: {
            posts: { where: { published: true } },
            followers: true,
          },
        },
      },
      orderBy: [
        { verified: 'desc' },
        { followers: { _count: 'desc' } },
      ],
    })

    let nextCursor: string | undefined = undefined
    if (users.length > params.limit) {
      const nextItem = users.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: users,
      nextCursor,
    }
  }

  async getUserStatistics(userId: string) {
    const [stats, recentActivity, topPosts] = await Promise.all([
      // Basic statistics
      this.db.user.findUnique({
        where: { id: userId },
        select: {
          createdAt: true,
          _count: {
            select: {
              posts: { where: { published: true } },
              comments: true,
              reactions: true,
              followers: true,
              following: true,
            },
          },
        },
      }),
      
      // Recent activity
      this.db.post.count({
        where: {
          authorId: userId,
          published: true,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      
      // Top posts
      this.db.post.findMany({
        where: {
          authorId: userId,
          published: true,
        },
        select: {
          id: true,
          title: true,
          slug: true,
          _count: {
            select: {
              reactions: true,
              comments: true,
            },
          },
        },
        orderBy: [
          { reactions: { _count: 'desc' } },
          { views: 'desc' },
        ],
        take: 5,
      }),
    ])

    if (!stats) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    return {
      joinedAt: stats.createdAt,
      totalPosts: stats._count.posts,
      totalComments: stats._count.comments,
      totalReactions: stats._count.reactions,
      followers: stats._count.followers,
      following: stats._count.following,
      postsLastMonth: recentActivity,
      topPosts,
    }
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { username },
      select: { id: true },
    })

    return !user
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { hashedPassword: true },
    })

    if (!user?.hashedPassword) return false

    return bcrypt.compare(password, user.hashedPassword)
  }

  async deleteAccount(userId: string) {
    // This will cascade delete all related data
    await this.db.user.delete({
      where: { id: userId },
    })

    // Clear caches
    await cache.invalidatePattern(`user:`)
  }

  async getRecommendedUsers(userId: string, limit: number) {
    // Get users that are followed by people the current user follows
    // but not already followed by the current user
    const recommendations = await this.db.$queryRaw<any[]>`
      SELECT DISTINCT
        u.id,
        u.username,
        u.bio,
        u.image,
        u.verified,
        COUNT(DISTINCT f2."followerId") as mutual_followers,
        COUNT(DISTINCT p.id) as post_count
      FROM users u
      INNER JOIN follows f1 ON f1."followingId" = u.id
      INNER JOIN follows f2 ON f2."followerId" = f1."followerId" AND f2."followingId" != ${userId}
      LEFT JOIN posts p ON p."authorId" = u.id AND p.published = true
      WHERE f1."followerId" IN (
        SELECT "followingId" FROM follows WHERE "followerId" = ${userId}
      )
      AND u.id != ${userId}
      AND u.id NOT IN (
        SELECT "followingId" FROM follows WHERE "followerId" = ${userId}
      )
      GROUP BY u.id
      ORDER BY mutual_followers DESC, post_count DESC
      LIMIT ${limit}
    `

    return recommendations
  }
}
