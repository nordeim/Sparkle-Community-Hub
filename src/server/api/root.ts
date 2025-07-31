// src/server/api/root.ts
import { createTRPCRouter } from '@/server/api/trpc'
import { userRouter } from '@/server/api/routers/user'
import { postRouter } from '@/server/api/routers/post'
import { authRouter } from '@/server/api/routers/auth'
import { commentRouter } from '@/server/api/routers/comment'
import { notificationRouter } from '@/server/api/routers/notification'
import { searchRouter } from '@/server/api/routers/search'
import { adminRouter } from '@/server/api/routers/admin'
import { analyticsRouter } from '@/server/api/routers/analytics'
import { uploadRouter } from '@/server/api/routers/upload'

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
  admin: adminRouter,
  analytics: analyticsRouter,
  upload: uploadRouter,
})

// Export type definition of API
export type AppRouter = typeof appRouter

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = appRouter.createCaller
