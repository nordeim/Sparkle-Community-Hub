// src/server/api/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server'
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { type Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { authOptions } from '@/lib/auth/auth.config'
import { db } from '@/lib/db'
import { type UserRole } from '@prisma/client'
import { headers } from 'next/headers'
import { RateLimiter } from '@/lib/rate-limiter'
import { monitoring } from '@/lib/monitoring'

/**
 * 1. CONTEXT
 * This section defines the "contexts" that are available in the backend API.
 */
interface CreateContextOptions {
  session: Session | null
  headers: Headers
  ip?: string
}

/**
 * This helper generates the "internals" for a tRPC context.
 */
export const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    db,
    headers: opts.headers,
    ip: opts.ip,
  }
}

/**
 * This is the actual context you will use in your router.
 * @see https://trpc.io/docs/context
 */
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts

  // Get the session from the server using the getServerSession wrapper function
  const session = await getServerSession(authOptions)

  // Get client IP for rate limiting
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.socket.remoteAddress

  return createInnerTRPCContext({
    session,
    headers: headers(),
    ip: ip as string,
  })
}

/**
 * 2. INITIALIZATION
 * This is where the tRPC API is initialized, connecting the context and transformer.
 */
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

/**
 * 3. MIDDLEWARES
 * These are pieces of code that run before your procedures.
 */

// Logger middleware
const loggerMiddleware = t.middleware(async ({ path, type, next, ctx }) => {
  const start = Date.now()

  const result = await next()

  const durationMs = Date.now() - start
  const meta = { path, type, durationMs }

  if (result.ok) {
    console.log('✅ tRPC Request:', meta)
  } else {
    console.error('❌ tRPC Error:', meta, result.error)
  }

  // Track performance metrics
  monitoring.trackPerformance(`trpc.${path}`, durationMs)

  return result
})

// Auth middleware - ensures user is authenticated
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
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

// Role-based access control middleware
const enforceUserHasRole = (allowedRoles: UserRole[]) => {
  return t.middleware(({ ctx, next }) => {
    if (!ctx.session || !ctx.session.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' })
    }

    if (!allowedRoles.includes(ctx.session.user.role)) {
      throw new TRPCError({ 
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      })
    }

    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
      },
    })
  })
}

// Rate limiting middleware
const rateLimiter = new RateLimiter()

const withRateLimit = (options?: { 
  windowMs?: number
  maxRequests?: number 
}) => {
  return t.middleware(async ({ ctx, next, path }) => {
    const identifier = ctx.session?.user?.id || ctx.ip || 'anonymous'
    
    const limited = await rateLimiter.checkLimit(identifier, {
      windowMs: options?.windowMs || 60000, // 1 minute default
      maxRequests: options?.maxRequests || 100, // 100 requests default
      namespace: `trpc:${path}`,
    })

    if (!limited.success) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Rate limit exceeded. Try again in ${limited.retryAfter} seconds.`,
      })
    }

    return next()
  })
}

/**
 * 4. ROUTER & PROCEDURES
 * These are the pieces you use to build your tRPC API.
 */

/**
 * Create a server-side router
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router

/**
 * Public (unauthenticated) procedure
 */
export const publicProcedure = t.procedure
  .use(loggerMiddleware)
  .use(withRateLimit())

/**
 * Protected (authenticated) procedure
 */
export const protectedProcedure = t.procedure
  .use(loggerMiddleware)
  .use(withRateLimit())
  .use(enforceUserIsAuthed)

/**
 * Moderator procedure - requires MODERATOR or ADMIN role
 */
export const moderatorProcedure = t.procedure
  .use(loggerMiddleware)
  .use(withRateLimit({ maxRequests: 200 }))
  .use(enforceUserHasRole(['MODERATOR', 'ADMIN']))

/**
 * Admin procedure - requires ADMIN role
 */
export const adminProcedure = t.procedure
  .use(loggerMiddleware)
  .use(withRateLimit({ maxRequests: 500 }))
  .use(enforceUserHasRole(['ADMIN']))

/**
 * Strict rate-limited procedure for sensitive operations
 */
export const strictProcedure = t.procedure
  .use(loggerMiddleware)
  .use(withRateLimit({ windowMs: 900000, maxRequests: 5 })) // 5 requests per 15 minutes
  .use(enforceUserIsAuthed)
