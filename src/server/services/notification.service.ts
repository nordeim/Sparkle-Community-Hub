// src/server/services/notification.service.ts
import { PrismaClient, Prisma, NotificationType } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { EmailService } from './email.service'
import { PushService } from './push.service'
import { cache } from '@/lib/cache'
import { formatRelativeTime } from '@/lib/utils'

interface NotificationData {
  postId?: string
  postSlug?: string
  postTitle?: string
  commentId?: string
  parentCommentId?: string
  userId?: string
  username?: string
  achievementId?: string
  achievementName?: string
  reactionType?: string
  followerCount?: number
  test?: boolean
  [key: string]: any
}

interface NotificationPreferences {
  email: {
    postLikes: boolean
    comments: boolean
    replies: boolean
    follows: boolean
    mentions: boolean
    achievements: boolean
    announcements: boolean
  }
  push: {
    postLikes: boolean
    comments: boolean
    replies: boolean
    follows: boolean
    mentions: boolean
    achievements: boolean
    announcements: boolean
  }
  inApp: {
    postLikes: boolean
    comments: boolean
    replies: boolean
    follows: boolean
    mentions: boolean
    achievements: boolean
    announcements: boolean
  }
}

export class NotificationService {
  private emailService: EmailService
  private pushService: PushService

  constructor(private db: PrismaClient) {
    this.emailService = new EmailService()
    this.pushService = new PushService()
  }

  async createNotification(input: {
    type: NotificationType
    userId: string
    actorId?: string
    entityId?: string
    entityType?: string
    message: string
    data?: NotificationData
  }) {
    // Check if user wants this type of notification
    const preferences = await this.getPreferences(input.userId)
    if (!this.shouldCreateNotification(input.type, preferences.inApp)) {
      return null
    }

    // Create the notification
    const notification = await this.db.notification.create({
      data: {
        type: input.type,
        userId: input.userId,
        actorId: input.actorId,
        entityId: input.entityId,
        entityType: input.entityType,
        message: input.message,
        data: input.data || {},
      },
      include: {
        actor: input.actorId ? {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
          },
        } : false,
      },
    })

    // Invalidate unread count cache
    await cache.del(`notifications:unread:${input.userId}`)

    // Send real-time notification
    this.sendRealTimeNotification(notification)

    // Send email notification if enabled
    if (this.shouldSendEmail(input.type, preferences.email)) {
      this.sendEmailNotification(notification).catch(console.error)
    }

    // Send push notification if enabled
    if (this.shouldSendPush(input.type, preferences.push)) {
      this.sendPushNotification(notification).catch(console.error)
    }

    return notification
  }

  async listNotifications(params: {
    userId: string
    limit: number
    cursor?: string
    unreadOnly?: boolean
    types?: NotificationType[]
  }) {
    const where: Prisma.NotificationWhereInput = {
      userId: params.userId,
    }

    if (params.unreadOnly) {
      where.read = false
    }

    if (params.types && params.types.length > 0) {
      where.type = { in: params.types }
    }

    const notifications = await this.db.notification.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (notifications.length > params.limit) {
      const nextItem = notifications.pop()
      nextCursor = nextItem!.id
    }

    // Group notifications by date
    const groupedNotifications = this.groupNotificationsByDate(notifications)

    return {
      items: notifications,
      grouped: groupedNotifications,
      nextCursor,
    }
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.db.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true, read: true },
    })

    if (!notification) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Notification not found',
      })
    }

    if (notification.userId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to modify this notification',
      })
    }

    if (notification.read) {
      return notification
    }

    const updatedNotification = await this.db.notification.update({
      where: { id: notificationId },
      data: { read: true },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            image: true,
            verified: true,
          },
        },
      },
    })

    // Invalidate unread count cache
    await cache.del(`notifications:unread:${userId}`)

    // Send real-time update
    this.sendRealTimeUpdate(userId, 'notification:read', {
      notificationId,
    })

    return updatedNotification
  }

  async markManyAsRead(notificationIds: string[], userId: string) {
    const result = await this.db.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId,
        read: false,
      },
      data: { read: true },
    })

    if (result.count > 0) {
      // Invalidate unread count cache
      await cache.del(`notifications:unread:${userId}`)

      // Send real-time update
      this.sendRealTimeUpdate(userId, 'notifications:read', {
        notificationIds,
        count: result.count,
      })
    }

    return result.count
  }

  async markAllAsRead(userId: string) {
    const result = await this.db.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: { read: true },
    })

    if (result.count > 0) {
      // Invalidate unread count cache
      await cache.del(`notifications:unread:${userId}`)

      // Send real-time update
      this.sendRealTimeUpdate(userId, 'notifications:all-read', {
        count: result.count,
      })
    }

    return result.count
  }

  async getUnreadCount(userId: string): Promise<number> {
    // Try cache first
    const cacheKey = `notifications:unread:${userId}`
    const cached = await cache.get<number>(cacheKey)
    if (cached !== null) return cached

    const count = await this.db.notification.count({
      where: {
        userId,
        read: false,
      },
    })

    // Cache for 5 minutes
    await cache.set(cacheKey, count, 300)

    return count
  }

  async deleteNotification(notificationId: string, userId: string) {
    const notification = await this.db.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true },
    })

    if (!notification) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Notification not found',
      })
    }

    if (notification.userId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to delete this notification',
      })
    }

    await this.db.notification.delete({
      where: { id: notificationId },
    })

    // Send real-time update
    this.sendRealTimeUpdate(userId, 'notification:deleted', {
      notificationId,
    })
  }

  async deleteManyNotifications(notificationIds: string[], userId: string) {
    const result = await this.db.notification.deleteMany({
      where: {
        id: { in: notificationIds },
        userId,
      },
    })

    if (result.count > 0) {
      // Send real-time update
      this.sendRealTimeUpdate(userId, 'notifications:deleted', {
        notificationIds,
        count: result.count,
      })
    }

    return result.count
  }

  async updatePreferences(userId: string, preferences: Partial<NotificationPreferences>) {
    const profile = await this.db.profile.upsert({
      where: { userId },
      create: {
        userId,
        notificationSettings: preferences,
      },
      update: {
        notificationSettings: preferences,
      },
    })

    return profile.notificationSettings as NotificationPreferences
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const profile = await this.db.profile.findUnique({
      where: { userId },
      select: { notificationSettings: true },
    })

    // Default preferences
    const defaultPreferences: NotificationPreferences = {
      email: {
        postLikes: true,
        comments: true,
        replies: true,
        follows: true,
        mentions: true,
        achievements: true,
        announcements: true,
      },
      push: {
        postLikes: true,
        comments: true,
        replies: true,
        follows: true,
        mentions: true,
        achievements: true,
        announcements: true,
      },
      inApp: {
        postLikes: true,
        comments: true,
        replies: true,
        follows: true,
        mentions: true,
        achievements: true,
        announcements: true,
      },
    }

    if (!profile?.notificationSettings) {
      return defaultPreferences
    }

    // Merge with defaults to handle missing keys
    return {
      email: { ...defaultPreferences.email, ...(profile.notificationSettings as any).email },
      push: { ...defaultPreferences.push, ...(profile.notificationSettings as any).push },
      inApp: { ...defaultPreferences.inApp, ...(profile.notificationSettings as any).inApp },
    }
  }

  // Cleanup old notifications
  async cleanupOldNotifications(daysToKeep: number = 30) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

    const result = await this.db.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        read: true,
      },
    })

    return result.count
  }

  // Get notification summary for digest emails
  async getNotificationSummary(userId: string, since: Date) {
    const notifications = await this.db.notification.groupBy({
      by: ['type'],
      where: {
        userId,
        createdAt: { gte: since },
      },
      _count: true,
    })

    const recentPosts = await this.db.post.findMany({
      where: {
        author: {
          followers: {
            some: { followerId: userId },
          },
        },
        publishedAt: { gte: since },
      },
      take: 5,
      orderBy: { publishedAt: 'desc' },
      include: {
        author: {
          select: {
            username: true,
            image: true,
          },
        },
      },
    })

    return {
      counts: notifications.reduce((acc, item) => {
        acc[item.type] = item._count
        return acc
      }, {} as Record<NotificationType, number>),
      recentPosts,
      totalCount: notifications.reduce((sum, item) => sum + item._count, 0),
    }
  }

  // Private helper methods
  private shouldCreateNotification(type: NotificationType, preferences: NotificationPreferences['inApp']): boolean {
    const typeMap: Record<NotificationType, keyof typeof preferences> = {
      POST_LIKED: 'postLikes',
      POST_COMMENTED: 'comments',
      COMMENT_LIKED: 'comments',
      USER_FOLLOWED: 'follows',
      ACHIEVEMENT_UNLOCKED: 'achievements',
      LEVEL_UP: 'achievements',
      MENTION: 'mentions',
      SYSTEM: 'announcements',
    }

    const preferenceKey = typeMap[type]
    return preferenceKey ? preferences[preferenceKey] : true
  }

  private shouldSendEmail(type: NotificationType, preferences: NotificationPreferences['email']): boolean {
    return this.shouldCreateNotification(type, preferences)
  }

  private shouldSendPush(type: NotificationType, preferences: NotificationPreferences['push']): boolean {
    return this.shouldCreateNotification(type, preferences)
  }

  private groupNotificationsByDate(notifications: any[]) {
    const groups: Record<string, any[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: [],
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)

    notifications.forEach(notification => {
      const date = new Date(notification.createdAt)
      
      if (date >= today) {
        groups.today.push(notification)
      } else if (date >= yesterday) {
        groups.yesterday.push(notification)
      } else if (date >= weekAgo) {
        groups.thisWeek.push(notification)
      } else {
        groups.earlier.push(notification)
      }
    })

    return groups
  }

  private async sendRealTimeNotification(notification: any) {
    // This would send via WebSocket/SSE
    // Implementation depends on real-time service
    console.log(`Sending real-time notification to user ${notification.userId}:`, notification)
  }

  private async sendRealTimeUpdate(userId: string, event: string, data: any) {
    // This would send via WebSocket/SSE
    console.log(`Sending real-time update to user ${userId}:`, event, data)
  }

  private async sendEmailNotification(notification: any) {
    // Get user email preferences
    const user = await this.db.user.findUnique({
      where: { id: notification.userId },
      select: { email: true, username: true },
    })

    if (!user?.email) return

    // Format notification for email
    const subject = this.getEmailSubject(notification)
    const body = this.getEmailBody(notification)

    await this.emailService.sendNotificationEmail({
      to: user.email,
      subject,
      body,
      notification,
    })
  }

  private async sendPushNotification(notification: any) {
    // This would send push notifications
    // Implementation depends on push service
    console.log('Sending push notification:', notification)
  }

  private getEmailSubject(notification: any): string {
    const actor = notification.actor?.username || 'Someone'
    
    switch (notification.type) {
      case 'POST_LIKED':
        return `${actor} liked your post`
      case 'POST_COMMENTED':
        return `${actor} commented on your post`
      case 'COMMENT_LIKED':
        return `${actor} liked your comment`
      case 'USER_FOLLOWED':
        return `${actor} started following you`
      case 'ACHIEVEMENT_UNLOCKED':
        return `You unlocked a new achievement!`
      case 'LEVEL_UP':
        return `You reached a new level!`
      case 'MENTION':
        return `${actor} mentioned you`
      case 'SYSTEM':
        return 'Important update from Sparkle Universe'
      default:
        return 'New notification'
    }
  }

  private getEmailBody(notification: any): string {
    // This would generate a proper HTML email body
    // For now, returning a simple text
    return notification.message
  }
}
