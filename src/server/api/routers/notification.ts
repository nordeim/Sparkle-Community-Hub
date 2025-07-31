// src/server/api/routers/notification.ts
import { z } from 'zod'
import {
  createTRPCRouter,
  protectedProcedure,
} from '@/server/api/trpc'
import { NotificationService } from '@/server/services/notification.service'
import { PAGINATION } from '@/config/constants'
import { NotificationType } from '@prisma/client'

export const notificationRouter = createTRPCRouter({
  // Get user's notifications
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(PAGINATION.NOTIFICATIONS_LIMIT),
      cursor: z.string().optional(),
      unreadOnly: z.boolean().optional().default(false),
      types: z.array(z.nativeEnum(NotificationType)).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const notifications = await notificationService.listNotifications({
        userId: ctx.session.user.id,
        ...input,
      })

      return notifications
    }),

  // Mark notification as read
  markAsRead: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const notification = await notificationService.markAsRead(
        input.id,
        ctx.session.user.id
      )

      return notification
    }),

  // Mark multiple notifications as read
  markManyAsRead: protectedProcedure
    .input(z.object({
      ids: z.array(z.string().cuid()).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const count = await notificationService.markManyAsRead(
        input.ids,
        ctx.session.user.id
      )

      return { success: true, count }
    }),

  // Mark all notifications as read
  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const count = await notificationService.markAllAsRead(ctx.session.user.id)

      return { success: true, count }
    }),

  // Get unread count
  getUnreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const count = await notificationService.getUnreadCount(ctx.session.user.id)

      return { count }
    }),

  // Delete a notification
  delete: protectedProcedure
    .input(z.object({
      id: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      await notificationService.deleteNotification(
        input.id,
        ctx.session.user.id
      )

      return { success: true }
    }),

  // Delete multiple notifications
  deleteMany: protectedProcedure
    .input(z.object({
      ids: z.array(z.string().cuid()).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const count = await notificationService.deleteManyNotifications(
        input.ids,
        ctx.session.user.id
      )

      return { success: true, count }
    }),

  // Update notification preferences
  updatePreferences: protectedProcedure
    .input(z.object({
      email: z.object({
        postLikes: z.boolean().optional(),
        comments: z.boolean().optional(),
        replies: z.boolean().optional(),
        follows: z.boolean().optional(),
        mentions: z.boolean().optional(),
        achievements: z.boolean().optional(),
        announcements: z.boolean().optional(),
      }).optional(),
      push: z.object({
        postLikes: z.boolean().optional(),
        comments: z.boolean().optional(),
        replies: z.boolean().optional(),
        follows: z.boolean().optional(),
        mentions: z.boolean().optional(),
        achievements: z.boolean().optional(),
        announcements: z.boolean().optional(),
      }).optional(),
      inApp: z.object({
        postLikes: z.boolean().optional(),
        comments: z.boolean().optional(),
        replies: z.boolean().optional(),
        follows: z.boolean().optional(),
        mentions: z.boolean().optional(),
        achievements: z.boolean().optional(),
        announcements: z.boolean().optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const preferences = await notificationService.updatePreferences(
        ctx.session.user.id,
        input
      )

      return preferences
    }),

  // Get notification preferences
  getPreferences: protectedProcedure
    .query(async ({ ctx }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const preferences = await notificationService.getPreferences(
        ctx.session.user.id
      )

      return preferences
    }),

  // Test notification (for debugging)
  test: protectedProcedure
    .input(z.object({
      type: z.nativeEnum(NotificationType),
      message: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      
      const notification = await notificationService.createNotification({
        type: input.type,
        userId: ctx.session.user.id,
        message: input.message || 'This is a test notification',
        data: { test: true },
      })

      return notification
    }),

  // Subscribe to notification updates (for real-time)
  onNotificationReceived: protectedProcedure
    .subscription(({ ctx }) => {
      // This would be implemented with WebSocket/SSE
      // Placeholder for now
      return {
        subscribe: () => {
          // Subscribe logic for user's notifications
        },
      }
    }),
})
