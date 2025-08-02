// src/server/api/root.ts
import { createTRPCRouter } from '@/server/api/trpc'
import { userRouter } from '@/server/api/routers/user'
import { postRouter } from '@/server/api/routers/post'
import { authRouter } from '@/server/api/routers/auth'
import { commentRouter } from '@/server/api/routers/comment'
import { notificationRouter } from '@/server/api/routers/notification'
import { searchRouter } from '@/server/api/routers/search'
import { uploadRouter } from '@/server/api/routers/upload'
import { analyticsRouter } from '@/server/api/routers/analytics'
import { adminRouter } from '@/server/api/routers/admin'
import { gamificationRouter } from '@/server/api/routers/gamification'
import { youtubeRouter } from '@/server/api/routers/youtube'
import { realtimeRouter } from '@/server/api/routers/realtime'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  user: userRouter,
  post: postRouter,
  auth: authRouter,
  comment: commentRouter,
  notification: notificationRouter,
  search: searchRouter,
  upload: uploadRouter,
  analytics: analyticsRouter,
  admin: adminRouter,
  gamification: gamificationRouter,
  youtube: youtubeRouter,
  realtime: realtimeRouter,
})

// Export type definition of API
export type AppRouter = typeof appRouter

// Create a server-side caller for the tRPC API
export const createCaller = createCallerFactory(appRouter)
