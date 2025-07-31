// src/server/api/routers/user.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from '@/server/api/trpc'
import { UserService } from '@/server/services/user.service'
import { updateProfileSchema, updateSettingsSchema } from '@/lib/validations/user'
import { PAGINATION } from '@/config/constants'

export const userRouter = createTRPCRouter({
  // Get user profile by username
  getProfile: publicProcedure
    .input(z.object({
      username: z.string().min(1).max(50),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const profile = await userService.getProfileByUsername(input.username)
      
      if (!profile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      // Check if viewing own profile or public profile
      const isOwnProfile = ctx.session?.user?.id === profile.id
      const isFollowing = ctx.session?.user 
        ? await userService.isFollowing(ctx.session.user.id, profile.id)
        : false

      return {
        ...profile,
        isOwnProfile,
        isFollowing,
      }
    }),

  // Get current user's profile
  getMyProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const userService = new UserService(ctx.db)
      return userService.getFullProfile(ctx.session.user.id)
    }),

  // Update user profile
  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      
      // Check username availability if changing
      if (input.username && input.username !== ctx.session.user.username) {
        const isAvailable = await userService.isUsernameAvailable(input.username)
        if (!isAvailable) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Username is already taken',
          })
        }
      }

      const updatedProfile = await userService.updateProfile(
        ctx.session.user.id,
        input
      )

      // Update session if username changed
      if (input.username) {
        ctx.session.user.username = input.username
      }

      return updatedProfile
    }),

  // Update user settings
  updateSettings: protectedProcedure
    .input(updateSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.updateSettings(ctx.session.user.id, input)
    }),

  // Follow a user
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
      const result = await userService.followUser(
        ctx.session.user.id,
        input.userId
      )

      return result
    }),

  // Unfollow a user
  unfollow: protectedProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.unfollowUser(
        ctx.session.user.id,
        input.userId
      )
    }),

  // Get user's followers
  getFollowers: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const followers = await userService.getFollowers({
        userId: input.userId,
        limit: input.limit,
        cursor: input.cursor,
        currentUserId: ctx.session?.user?.id,
      })

      return followers
    }),

  // Get users that a user is following
  getFollowing: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
      limit: z.number().min(1).max(100).default(PAGINATION.DEFAULT_LIMIT),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const following = await userService.getFollowing({
        userId: input.userId,
        limit: input.limit,
        cursor: input.cursor,
        currentUserId: ctx.session?.user?.id,
      })

      return following
    }),

  // Search users
  searchUsers: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.searchUsers({
        query: input.query,
        limit: input.limit,
        cursor: input.cursor,
      })
    }),

  // Get user statistics
  getUserStats: publicProcedure
    .input(z.object({
      userId: z.string().cuid(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getUserStatistics(input.userId)
    }),

  // Delete user account
  deleteAccount: protectedProcedure
    .input(z.object({
      password: z.string().min(8),
      confirmation: z.literal('DELETE MY ACCOUNT'),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      
      // Verify password
      const isValid = await userService.verifyPassword(
        ctx.session.user.id,
        input.password
      )
      
      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid password',
        })
      }

      // Delete account
      await userService.deleteAccount(ctx.session.user.id)

      return { success: true }
    }),

  // Get recommended users
  getRecommendedUsers: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getRecommendedUsers(
        ctx.session.user.id,
        input.limit
      )
    }),

  // Check username availability
  checkUsername: publicProcedure
    .input(z.object({
      username: z.string().min(3).max(50),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      const isAvailable = await userService.isUsernameAvailable(input.username)
      
      return { 
        available: isAvailable,
        username: input.username,
      }
    }),
})
