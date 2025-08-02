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
