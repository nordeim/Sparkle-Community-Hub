// src/server/api/routers/admin.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc'
import { TRPCError } from '@trpc/server'
import { AdminService } from '@/server/services/admin.service'
import { ModerationService } from '@/server/services/moderation.service'
import { AnalyticsService } from '@/server/services/analytics.service'
import { SystemService } from '@/server/services/system.service'

// Admin middleware to check permissions
const adminProcedure = protectedProcedure.use(async (opts) => {
  if (!['ADMIN', 'MODERATOR'].includes(opts.ctx.session.user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin or Moderator access required',
    })
  }
  return opts.next()
})

const superAdminProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.session.user.role !== 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }
  return opts.next()
})

export const adminRouter = createTRPCRouter({
  // ========== Dashboard ==========
  getDashboardStats: adminProcedure
    .input(z.object({
      timeRange: z.enum(['today', 'week', 'month', 'year']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getDashboardStats(input.timeRange || 'week')
    }),

  getRealtimeStats: adminProcedure
    .query(async ({ ctx }) => {
      const analyticsService = new AnalyticsService(ctx.db)
      return analyticsService.getRealtimeStats()
    }),

  getAnalytics: adminProcedure
    .input(z.object({
      period: z.enum(['today', 'week', 'month', 'year']),
      metrics: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const analyticsService = new AnalyticsService(ctx.db)
      return analyticsService.getAnalytics(input.period, input.metrics)
    }),

  getSystemHealth: adminProcedure
    .query(async ({ ctx }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.getHealthStatus()
    }),

  // ========== User Management ==========
  getUsers: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      role: z.enum(['USER', 'CREATOR', 'MODERATOR', 'ADMIN']).optional(),
      status: z.enum(['all', 'active', 'verified', 'banned', 'new']).optional(),
      levelMin: z.number().optional(),
      levelMax: z.number().optional(),
      dateStart: z.date().optional(),
      dateEnd: z.date().optional(),
      sortField: z.enum(['username', 'email', 'createdAt', 'level', 'posts', 'followers']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUsers(input)
    }),

  getUserDetails: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUserDetails(input.userId)
    }),

  updateUser: superAdminProcedure
    .input(z.object({
      userId: z.string(),
      data: z.object({
        username: z.string().optional(),
        email: z.string().email().optional(),
        bio: z.string().optional(),
        verified: z.boolean().optional(),
        level: z.number().optional(),
        experience: z.number().optional(),
        sparklePoints: z.number().optional(),
        premiumPoints: z.number().optional(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateUser(input.userId, input.data)
    }),

  banUser: adminProcedure
    .input(z.object({
      userId: z.string(),
      reason: z.string().optional(),
      duration: z.number().optional(), // Days, 0 = permanent
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.banUser(input.userId, input.reason, input.duration)
    }),

  unbanUser: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.unbanUser(input.userId)
    }),

  verifyUser: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.verifyUser(input.userId)
    }),

  changeUserRole: superAdminProcedure
    .input(z.object({
      userId: z.string(),
      role: z.enum(['USER', 'CREATOR', 'MODERATOR', 'ADMIN']),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.changeUserRole(input.userId, input.role)
    }),

  deleteUser: superAdminProcedure
    .input(z.object({
      userId: z.string(),
      hardDelete: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.deleteUser(input.userId, input.hardDelete)
    }),

  grantCurrency: adminProcedure
    .input(z.object({
      userId: z.string(),
      amount: z.number(),
      type: z.enum(['sparkle_points', 'premium_points']),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.grantCurrency(
        input.userId,
        input.amount,
        input.type,
        input.reason,
        ctx.session.user.id
      )
    }),

  exportUsers: adminProcedure
    .input(z.object({
      filters: z.any().optional(),
      format: z.enum(['csv', 'json']).default('csv'),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.exportUsers(input.filters, input.format)
    }),

  // ========== Content Moderation ==========
  getReports: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      type: z.enum(['posts', 'comments', 'users', 'messages']).optional(),
      status: z.enum(['pending', 'approved', 'rejected', 'escalated']).optional(),
      reason: z.enum(['spam', 'inappropriate', 'harassment', 'misinformation', 'copyright', 'other']).optional(),
      aiScoreMin: z.number().min(0).max(1).optional(),
      aiScoreMax: z.number().min(0).max(1).optional(),
      dateStart: z.date().optional(),
      dateEnd: z.date().optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.getReports(input)
    }),

  getModerationStats: adminProcedure
    .query(async ({ ctx }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.getModerationStats()
    }),

  getAIModerationInsights: adminProcedure
    .query(async ({ ctx }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.getAIInsights()
    }),

  moderateContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment', 'user', 'message']),
      decision: z.enum(['approved', 'rejected', 'deleted', 'banned']),
      reason: z.string().optional(),
      banDuration: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.moderateContent(
        input.contentId,
        input.type,
        input.decision,
        input.reason,
        ctx.session.user.id,
        input.banDuration
      )
    }),

  bulkModerate: adminProcedure
    .input(z.object({
      contentIds: z.array(z.string()),
      action: z.string(),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.bulkModerate(
        input.contentIds,
        input.action,
        input.reason,
        ctx.session.user.id
      )
    }),

  escalateContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment', 'user', 'message']),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.escalateContent(
        input.contentId,
        input.type,
        input.note,
        ctx.session.user.id
      )
    }),

  trainAIModeration: adminProcedure
    .input(z.object({
      contentId: z.string(),
      decision: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.trainAI(input)
    }),

  // ========== Site Settings ==========
  getSiteSettings: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getSiteSettings()
    }),

  updateSiteSettings: superAdminProcedure
    .input(z.object({
      settings: z.record(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateSiteSettings(input.settings, ctx.session.user.id)
    }),

  // ========== Feature Flags ==========
  getFeatureFlags: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getFeatureFlags()
    }),

  updateFeatureFlag: superAdminProcedure
    .input(z.object({
      flag: z.string(),
      enabled: z.boolean(),
      rolloutPercentage: z.number().min(0).max(100).optional(),
      conditions: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateFeatureFlag(input)
    }),

  // ========== System Management ==========
  getSystemLogs: superAdminProcedure
    .input(z.object({
      level: z.enum(['info', 'warning', 'error']).optional(),
      service: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(100),
    }))
    .query(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.getLogs(input)
    }),

  getBackupStatus: superAdminProcedure
    .query(async ({ ctx }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.getBackupStatus()
    }),

  triggerBackup: superAdminProcedure
    .input(z.object({
      type: z.enum(['full', 'incremental', 'data-only']),
    }))
    .mutation(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.triggerBackup(input.type, ctx.session.user.id)
    }),

  clearCache: superAdminProcedure
    .input(z.object({
      pattern: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.clearCache(input.pattern)
    }),

  // ========== Analytics & Reports ==========
  generateReport: adminProcedure
    .input(z.object({
      type: z.enum(['users', 'content', 'engagement', 'revenue', 'moderation']),
      period: z.enum(['day', 'week', 'month', 'quarter', 'year']),
      format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
    }))
    .mutation(async ({ ctx, input }) => {
      const analyticsService = new AnalyticsService(ctx.db)
      return analyticsService.generateReport(input.type, input.period, input.format)
    }),

  getActivityLog: adminProcedure
    .input(z.object({
      userId: z.string().optional(),
      action: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getActivityLog(input)
    }),

  // ========== Bulk Operations ==========
  bulkSendEmail: superAdminProcedure
    .input(z.object({
      userIds: z.array(z.string()).optional(),
      filters: z.any().optional(),
      subject: z.string(),
      content: z.string(),
      template: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.bulkSendEmail(input, ctx.session.user.id)
    }),

  bulkGrantAchievement: adminProcedure
    .input(z.object({
      userIds: z.array(z.string()),
      achievementId: z.string(),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.bulkGrantAchievement(
        input.userIds,
        input.achievementId,
        input.reason,
        ctx.session.user.id
      )
    }),

  // ========== Emergency Actions ==========
  enableMaintenanceMode: superAdminProcedure
    .input(z.object({
      message: z.string(),
      estimatedDuration: z.number().optional(), // minutes
    }))
    .mutation(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.enableMaintenanceMode(
        input.message,
        input.estimatedDuration,
        ctx.session.user.id
      )
    }),

  disableMaintenanceMode: superAdminProcedure
    .mutation(async ({ ctx }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.disableMaintenanceMode(ctx.session.user.id)
    }),

  emergencyShutdown: superAdminProcedure
    .input(z.object({
      reason: z.string(),
      confirmationCode: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify confirmation code
      if (input.confirmationCode !== process.env.EMERGENCY_SHUTDOWN_CODE) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Invalid confirmation code',
        })
      }

      const systemService = new SystemService(ctx.db)
      return systemService.emergencyShutdown(input.reason, ctx.session.user.id)
    }),
})
