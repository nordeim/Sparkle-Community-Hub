// src/server/api/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server'
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { getServerSession } from 'next-auth'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { authOptions } from '@/lib/auth/auth.config'
import { db } from '@/lib/db'
import { ratelimit } from '@/lib/rate-limiter'
import type { Session } from 'next-auth'
import { headers } from 'next/headers'

// Context type definition
interface CreateContextOptions {
  session: Session | null
  headers: Headers
  req?: CreateNextContextOptions['req']
  res?: CreateNextContextOptions['res']
}

// Inner context creation (doesn't require Next.js req/res)
export const createContextInner = async (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    db,
    headers: opts.headers,
    req: opts.req,
    res: opts.res,
  }
}

// Outer context creation for Next.js
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts

  // Get user session
  const session = await getServerSession(authOptions)

  // Get headers
  const heads = new Headers(headers())
  heads.set('x-trpc-source', req.headers['x-trpc-source'] ?? 'unknown')

  return createContextInner({
    session,
    headers: heads,
    req,
    res,
  })
}

// Initialize tRPC with context
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

// Create tRPC router
export const createTRPCRouter = t.router

// Create caller for server-side calls
export const createCallerFactory = t.createCallerFactory

// Middleware for timing procedures
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now()

  if (t._config.isDev) {
    // Artificial delay in development
    const waitMs = Math.floor(Math.random() * 400) + 100
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  const result = await next()

  const end = Date.now()
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`)

  return result
})

// Rate limiting middleware
const rateLimitMiddleware = t.middleware(async ({ ctx, next, path }) => {
  const identifier = ctx.session?.user?.id ?? ctx.headers.get('x-forwarded-for') ?? 'anonymous'
  
  const { success } = await ratelimit.limit(identifier, {
    rate: 100,
    period: '1m',
  })

  if (!success) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
    })
  }

  return next()
})

// Auth middleware
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ 
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }

  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  })
})

// Procedures
export const publicProcedure = t.procedure
  .use(timingMiddleware)
  .use(rateLimitMiddleware)

export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(rateLimitMiddleware)
  .use(enforceUserIsAuthed)

// Admin procedure
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== 'ADMIN' && ctx.session.user.role !== 'MODERATOR') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }

  return next()
})

// Export types
export type Context = Awaited<ReturnType<typeof createTRPCContext>>
