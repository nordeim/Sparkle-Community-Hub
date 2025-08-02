// src/server/api/routers/user.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { TRPCError } from '@trpc/server'
import { UserService } from '@/server/services/user.service'
import { updateProfileSchema, userPreferencesSchema } from '@/lib/validations/user'
import { cache } from '@/lib/cache'

export const userRouter = createTRPCRouter({
  // Get user profile by username
  getProfile: publicProcedure
    .input(z.object({
      username: z.string().min(1).max(50),
      includePrivate: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const cacheKey = cache.keys.user(input.username)
      const cached = await cache.get(cacheKey)
      
      if (cached && !input.includePrivate) {
        return cached
      }

      const userService = new UserService(ctx.db)
      const profile = await userService.getProfileByUsername(input.username, {
        viewerId: ctx.session?.user?.id,
        includePrivate: input.includePrivate && ctx.session?.user?.id === profile?.id,
      })

      if (!input.includePrivate) {
        await cache.set(cacheKey, profile, 300) // Cache for 5 minutes
      }

      return profile
    }),

  // Get user by ID
  getById: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserById(input.userId, ctx.session?.user?.id)
    }),

  // Update user profile
  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const updated = await userService.updateProfile(ctx.session.user.id, input)
      
      // Invalidate cache
      await cache.del(cache.keys.user(updated.username))
      
      return updated
    }),

  // Update user preferences
  updatePreferences: protectedProcedure
    .input(userPreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.updatePreferences(ctx.session.user.id, input)
    }),

  // Upload avatar
  uploadAvatar: protectedProcedure
    .input(z.object({
      imageUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const updated = await userService.updateAvatar(ctx.session.user.id, input.imageUrl)
      
      // Invalidate cache
      await cache.del(cache.keys.user(updated.username))
      
      return updated
    }),

  // Follow user
  follow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.id === input.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You cannot follow yourself',
        })
      }

      const userService = new UserService(ctx.db)
      const result = await userService.followUser(ctx.session.user.id, input.userId)
      
      // Invalidate caches
      await Promise.all([
        cache.del(cache.keys.user(result.follower.username)),
        cache.del(cache.keys.user(result.following.username)),
      ])
      
      return result
    }),

  // Unfollow user
  unfollow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const result = await userService.unfollowUser(ctx.session.user.id, input.userId)
      
      // Invalidate caches
      await Promise.all([
        cache.del(cache.keys.user(result.follower.username)),
        cache.del(cache.keys.user(result.following.username)),
      ])
      
      return result
    }),

  // Get followers
  getFollowers: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowers({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Get following
  getFollowing: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowing({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Check if following
  isFollowing: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.session?.user) {
        return { isFollowing: false }
      }

      const userService = new UserService(ctx.db)
      return userService.isFollowing(ctx.session.user.id, input.userId)
    }),

  // Get user posts
  getPosts: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
      includeReplies: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserPosts({
        ...input,
        viewerId: ctx.session?.user?.id,
      })
    }),

  // Get user stats
  getStats: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserStats(input.userId)
    }),

  // Search users
  search: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.searchUsers(input)
    }),

  // Get suggested users
  getSuggestions: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getSuggestedUsers(ctx.session.user.id, input.limit)
    }),

  // Block user
  block: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.blockUser(ctx.session.user.id, input.userId)
    }),

  // Unblock user
  unblock: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.unblockUser(ctx.session.user.id, input.userId)
    }),

  // Get blocked users
  getBlockedUsers: protectedProcedure
    .query(async ({ ctx }) => {
      const userService = new UserService(ctx.db)
      return userService.getBlockedUsers(ctx.session.user.id)
    }),

  // Report user
  report: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
      reason: z.enum(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']),
      description: z.string().min(10).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.reportUser({
        reporterId: ctx.session.user.id,
        ...input,
      })
    }),

  // Delete account
  deleteAccount: protectedProcedure
    .input(z.object({
      password: z.string(),
      confirmation: z.literal('DELETE'),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.deleteAccount(ctx.session.user.id, input.password)
    }),
})
