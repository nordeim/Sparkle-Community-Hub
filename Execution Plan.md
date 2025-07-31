# 🚀 Sparkle Universe - Comprehensive Execution Plan

## 📋 Table of Contents

1. [Overview](#overview)
2. [Phase 1: Foundation](#phase-1-foundation-week-1-2)
3. [Phase 2: Core Features](#phase-2-core-features-week-3-4)
4. [Phase 3: Engagement Features](#phase-3-engagement-features-week-5-6)
5. [Phase 4: Advanced Features](#phase-4-advanced-features-week-7-8)
6. [Phase 5: Gamification & Social](#phase-5-gamification--social-week-9-10)
7. [Phase 6: Admin Panel](#phase-6-admin-panel-week-11-12)
8. [Phase 7: Performance & Polish](#phase-7-performance--polish-week-13-14)
9. [Database Schema](#database-schema)

## Overview

This execution plan provides a step-by-step guide to building Sparkle Universe. Each phase is self-contained and builds upon previous phases. Follow the checklists for each file to ensure complete implementation.

### Development Principles
- **Test-Driven Development**: Write tests first
- **Type Safety**: Use TypeScript strict mode
- **Code Review**: Every PR must be reviewed
- **Documentation**: Document as you code
- **Incremental Delivery**: Deploy after each phase

---

## Phase 1: Foundation (Week 1-2)

### Goals & Objectives
- ✅ Set up project infrastructure
- ✅ Implement authentication system
- ✅ Create base UI components
- ✅ Establish database connection
- ✅ Configure development environment

### Files to Complete

#### 1. `/package.json`
**Purpose**: Define project dependencies and scripts

```json
{
  "name": "sparkle-universe",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "playwright test",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "postinstall": "prisma generate"
  }
}
```

**Checklist**:
- [ ] Install Next.js 15 with TypeScript
- [ ] Add Prisma and PostgreSQL driver
- [ ] Include authentication packages
- [ ] Add UI library dependencies
- [ ] Configure testing frameworks
- [ ] Add development tools

#### 2. `/tsconfig.json`
**Purpose**: TypeScript configuration with strict settings

**Dependencies**: None

**Exports**: TypeScript configuration for entire project

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{"name": "next"}],
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Checklist**:
- [ ] Enable strict mode
- [ ] Configure path aliases
- [ ] Set appropriate target
- [ ] Enable incremental compilation
- [ ] Configure JSX for Next.js

#### 3. `/.env.local`
**Purpose**: Environment variables for local development

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/sparkle_universe"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-secret-key-here"

# OAuth Providers
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# External Services
YOUTUBE_API_KEY=""
UPLOADTHING_SECRET=""
UPLOADTHING_APP_ID=""

# Redis
REDIS_URL="redis://localhost:6379"

# Email
EMAIL_SERVER=""
EMAIL_FROM=""
```

**Checklist**:
- [ ] Add database connection string
- [ ] Generate NextAuth secret
- [ ] Configure OAuth providers
- [ ] Add external API keys
- [ ] Set up Redis URL
- [ ] Configure email settings

#### 4. `/prisma/schema.prisma`
**Purpose**: Database schema definition

**Dependencies**: None

**Exports**: Prisma Client types

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  username        String    @unique
  hashedPassword  String?
  emailVerified   DateTime?
  image           String?
  bio             String?
  
  accounts        Account[]
  sessions        Session[]
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  @@index([email])
  @@index([username])
}

model Account {
  // NextAuth Account model
}

model Session {
  // NextAuth Session model
}
```

**Checklist**:
- [ ] Define User model
- [ ] Add NextAuth models
- [ ] Create indexes for performance
- [ ] Add timestamp fields
- [ ] Generate Prisma Client

#### 5. `/src/lib/db.ts`
**Purpose**: Database client singleton

**Dependencies**: 
- `@prisma/client`

**Exports**: 
- `db`: PrismaClient instance

```typescript
// src/lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

**Checklist**:
- [ ] Create PrismaClient singleton
- [ ] Configure logging for development
- [ ] Prevent multiple instances in development
- [ ] Export typed database client
- [ ] Add connection error handling

#### 6. `/src/lib/auth/auth.config.ts`
**Purpose**: NextAuth configuration

**Dependencies**:
- `next-auth`
- `@auth/prisma-adapter`
- `bcryptjs`

**Exports**:
- `authOptions`: NextAuthOptions

```typescript
// src/lib/auth/auth.config.ts
import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { loginSchema } from '@/lib/validations/auth'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/auth/error',
    verifyRequest: '/auth/verify',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        const validated = loginSchema.safeParse(credentials)
        if (!validated.success) return null

        const user = await db.user.findUnique({
          where: { email: validated.data.email }
        })

        if (!user?.hashedPassword) return null

        const passwordMatch = await bcrypt.compare(
          validated.data.password,
          user.hashedPassword
        )

        if (!passwordMatch) return null

        return {
          id: user.id,
          email: user.email,
          username: user.username,
          image: user.image,
        }
      }
    })
  ],
  callbacks: {
    async session({ token, session }) {
      if (token) {
        session.user.id = token.id
        session.user.username = token.username
        session.user.role = token.role
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = user.username
        token.role = user.role
      }
      return token
    }
  }
}
```

**Checklist**:
- [ ] Configure Prisma adapter
- [ ] Set up OAuth providers
- [ ] Implement credentials provider
- [ ] Configure JWT strategy
- [ ] Add session callbacks
- [ ] Define custom pages

#### 7. `/src/app/api/auth/[...nextauth]/route.ts`
**Purpose**: NextAuth API route handler

**Dependencies**:
- `next-auth`
- `@/lib/auth/auth.config`

**Exports**: 
- GET and POST handlers

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth/auth.config'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
```

**Checklist**:
- [ ] Import NextAuth and config
- [ ] Create handler instance
- [ ] Export GET method
- [ ] Export POST method
- [ ] Test authentication flow

#### 8. `/src/lib/auth/auth.ts`
**Purpose**: Server-side auth utilities

**Dependencies**:
- `next-auth`
- `@/lib/auth/auth.config`

**Exports**:
- `getServerAuth()`: Get session server-side
- `requireAuth()`: Enforce authentication

```typescript
// src/lib/auth/auth.ts
import { getServerSession } from 'next-auth'
import { authOptions } from './auth.config'
import { redirect } from 'next/navigation'

export async function getServerAuth() {
  const session = await getServerSession(authOptions)
  return session
}

export async function requireAuth() {
  const session = await getServerAuth()
  if (!session?.user) {
    redirect('/login')
  }
  return session
}
```

**Checklist**:
- [ ] Create getServerAuth function
- [ ] Create requireAuth function
- [ ] Handle redirects properly
- [ ] Export typed functions
- [ ] Add error handling

#### 9. `/src/components/providers/auth-provider.tsx`
**Purpose**: Client-side auth provider

**Dependencies**:
- `next-auth/react`

**Exports**:
- `AuthProvider`: React component

```typescript
// src/components/providers/auth-provider.tsx
'use client'

import { SessionProvider } from 'next-auth/react'

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  return (
    <SessionProvider refetchInterval={0}>
      {children}
    </SessionProvider>
  )
}
```

**Checklist**:
- [ ] Mark as client component
- [ ] Import SessionProvider
- [ ] Accept children prop
- [ ] Configure refetch interval
- [ ] Export provider component

#### 10. `/src/hooks/use-auth.ts`
**Purpose**: Client-side auth hook

**Dependencies**:
- `next-auth/react`

**Exports**:
- `useAuth()`: Auth hook

```typescript
// src/hooks/use-auth.ts
'use client'

import { useSession } from 'next-auth/react'

export function useAuth() {
  const { data: session, status, update } = useSession()
  
  return {
    user: session?.user,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
    update,
  }
}
```

**Checklist**:
- [ ] Mark as client hook
- [ ] Use useSession hook
- [ ] Return user object
- [ ] Return loading state
- [ ] Return auth status

#### 11. `/src/app/layout.tsx`
**Purpose**: Root layout with providers

**Dependencies**:
- All providers
- Global styles

**Exports**:
- Default layout component

```typescript
// src/app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/providers/auth-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Sparkle Universe',
  description: 'Where fans become stars',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
```

**Checklist**:
- [ ] Configure metadata
- [ ] Set up font loading
- [ ] Add AuthProvider
- [ ] Add ThemeProvider
- [ ] Include Toaster
- [ ] Suppress hydration warning

#### 12. `/src/components/ui/button.tsx`
**Purpose**: Base button component

**Dependencies**:
- `class-variance-authority`
- `@/lib/utils`

**Exports**:
- `Button`: React component
- `buttonVariants`: Style variants

```typescript
// src/components/ui/button.tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        sparkle: 'bg-gradient-to-r from-sparkle-500 to-sparkle-700 text-white hover:from-sparkle-600 hover:to-sparkle-800 shadow-lg',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

**Checklist**:
- [ ] Install CVA for variants
- [ ] Define button variants
- [ ] Add sparkle variant
- [ ] Support asChild prop
- [ ] Forward refs properly

#### 13. `/src/lib/utils.ts`
**Purpose**: Utility functions

**Dependencies**:
- `clsx`
- `tailwind-merge`

**Exports**:
- `cn()`: Class name utility
- Other utilities

```typescript
// src/lib/utils.ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

export function absoluteUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${path}`
}

export function generateUsername(email: string): string {
  const base = email.split('@')[0]
  const random = Math.random().toString(36).substring(2, 6)
  return `${base}${random}`
}
```

**Checklist**:
- [ ] Create cn utility
- [ ] Add date formatting
- [ ] Add URL helpers
- [ ] Add username generator
- [ ] Export all utilities

---

## Phase 2: Core Features (Week 3-4)

### Goals & Objectives
- ✅ Implement user profiles
- ✅ Create blog post system
- ✅ Add content management
- ✅ Build feed algorithm
- ✅ Implement search functionality

### Files to Complete

#### 1. `/src/server/api/trpc.ts`
**Purpose**: tRPC configuration and context

**Dependencies**:
- `@trpc/server`
- `next-auth`
- `@/lib/db`

**Exports**:
- `createTRPCContext`: Context creator
- `createTRPCRouter`: Router creator
- `publicProcedure`: Public procedure
- `protectedProcedure`: Protected procedure

```typescript
// src/server/api/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server'
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { getServerSession } from 'next-auth'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { authOptions } from '@/lib/auth/auth.config'
import { db } from '@/lib/db'

export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts
  const session = await getServerSession(authOptions)

  return {
    db,
    session,
    req,
    res,
  }
}

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

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  })
})

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed)
```

**Checklist**:
- [ ] Create tRPC context
- [ ] Configure transformer
- [ ] Add error formatting
- [ ] Create auth middleware
- [ ] Export procedures

#### 2. `/src/server/api/root.ts`
**Purpose**: Root API router

**Dependencies**:
- tRPC routers
- `@/server/api/trpc`

**Exports**:
- `appRouter`: Root router
- `AppRouter`: Type

```typescript
// src/server/api/root.ts
import { createTRPCRouter } from '@/server/api/trpc'
import { userRouter } from '@/server/api/routers/user'
import { postRouter } from '@/server/api/routers/post'
import { authRouter } from '@/server/api/routers/auth'

export const appRouter = createTRPCRouter({
  user: userRouter,
  post: postRouter,
  auth: authRouter,
})

export type AppRouter = typeof appRouter
```

**Checklist**:
- [ ] Import all routers
- [ ] Create root router
- [ ] Export router instance
- [ ] Export router type
- [ ] Test API structure

#### 3. `/src/server/api/routers/user.ts`
**Purpose**: User-related API endpoints

**Dependencies**:
- `@/server/api/trpc`
- `@/lib/validations/user`
- `@/server/services/user.service`

**Exports**:
- `userRouter`: tRPC router

```typescript
// src/server/api/routers/user.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { updateProfileSchema } from '@/lib/validations/user'
import { UserService } from '@/server/services/user.service'

export const userRouter = createTRPCRouter({
  getProfile: publicProcedure
    .input(z.object({
      username: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getProfileByUsername(input.username)
    }),

  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.updateProfile(ctx.session.user.id, input)
    }),

  follow: protectedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.followUser(ctx.session.user.id, input.userId)
    }),

  unfollow: protectedProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.unfollowUser(ctx.session.user.id, input.userId)
    }),

  getFollowers: publicProcedure
    .input(z.object({
      userId: z.string(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userService = new UserService(ctx.db)
      return userService.getFollowers(input)
    }),
})
```

**Checklist**:
- [ ] Create profile endpoints
- [ ] Add follow functionality
- [ ] Implement pagination
- [ ] Add input validation
- [ ] Test all endpoints

#### 4. `/src/server/services/user.service.ts`
**Purpose**: User business logic

**Dependencies**:
- `@prisma/client`
- `@/lib/db`

**Exports**:
- `UserService`: Service class

```typescript
// src/server/services/user.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'

export class UserService {
  constructor(private db: PrismaClient) {}

  async getProfileByUsername(username: string) {
    const user = await this.db.user.findUnique({
      where: { username },
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

    return user
  }

  async updateProfile(userId: string, data: any) {
    return this.db.user.update({
      where: { id: userId },
      data: {
        bio: data.bio,
        profile: {
          upsert: {
            create: data.profile,
            update: data.profile,
          },
        },
      },
      include: {
        profile: true,
      },
    })
  }

  async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot follow yourself',
      })
    }

    try {
      await this.db.follow.create({
        data: {
          followerId,
          followingId,
        },
      })

      // TODO: Create notification
      // TODO: Update user stats

      return { success: true }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Already following this user',
          })
        }
      }
      throw error
    }
  }

  async unfollowUser(followerId: string, followingId: string) {
    await this.db.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    return { success: true }
  }

  async getFollowers(params: {
    userId: string
    limit: number
    cursor?: string
  }) {
    const followers = await this.db.follow.findMany({
      where: { followingId: params.userId },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        follower: {
          include: {
            profile: true,
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

    return {
      items: followers,
      nextCursor,
    }
  }
}
```

**Checklist**:
- [ ] Implement user queries
- [ ] Add follow logic
- [ ] Handle errors properly
- [ ] Add pagination support
- [ ] Include related data

#### 5. `/src/server/api/routers/post.ts`
**Purpose**: Post-related API endpoints

**Dependencies**:
- `@/server/api/trpc`
- `@/lib/validations/post`
- `@/server/services/post.service`

**Exports**:
- `postRouter`: tRPC router

```typescript
// src/server/api/routers/post.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { createPostSchema, updatePostSchema } from '@/lib/validations/post'
import { PostService } from '@/server/services/post.service'

export const postRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createPostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.createPost({
        ...input,
        authorId: ctx.session.user.id,
      })
    }),

  update: protectedProcedure
    .input(updatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.updatePost(
        input.id,
        ctx.session.user.id,
        input
      )
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.deletePost(input.id, ctx.session.user.id)
    }),

  getBySlug: publicProcedure
    .input(z.object({
      slug: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.getPostBySlug(input.slug)
    }),

  list: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(10),
      cursor: z.string().optional(),
      authorId: z.string().optional(),
      tag: z.string().optional(),
      featured: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.listPosts(input)
    }),

  like: protectedProcedure
    .input(z.object({
      postId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.likePost(input.postId, ctx.session.user.id)
    }),

  unlike: protectedProcedure
    .input(z.object({
      postId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const postService = new PostService(ctx.db)
      return postService.unlikePost(input.postId, ctx.session.user.id)
    }),
})
```

**Checklist**:
- [ ] Create CRUD endpoints
- [ ] Add like functionality
- [ ] Implement filtering
- [ ] Add pagination
- [ ] Handle authorization

#### 6. `/src/server/services/post.service.ts`
**Purpose**: Post business logic

**Dependencies**:
- `@prisma/client`
- `@/lib/utils`

**Exports**:
- `PostService`: Service class

```typescript
// src/server/services/post.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { generateSlug } from '@/lib/utils'

export class PostService {
  constructor(private db: PrismaClient) {}

  async createPost(input: {
    title: string
    content: string
    excerpt?: string
    tags?: string[]
    authorId: string
    youtubeVideoId?: string
  }) {
    const slug = await this.generateUniqueSlug(input.title)

    const post = await this.db.post.create({
      data: {
        title: input.title,
        content: input.content,
        excerpt: input.excerpt,
        slug,
        authorId: input.authorId,
        youtubeVideoId: input.youtubeVideoId,
        tags: input.tags ? {
          connectOrCreate: input.tags.map(tag => ({
            where: { name: tag },
            create: { name: tag },
          })),
        } : undefined,
      },
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
    })

    // TODO: Create activity
    // TODO: Send notifications to followers

    return post
  }

  async updatePost(
    postId: string,
    userId: string,
    input: Partial<{
      title: string
      content: string
      excerpt: string
      tags: string[]
    }>
  ) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    if (post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to edit this post',
      })
    }

    return this.db.post.update({
      where: { id: postId },
      data: {
        ...input,
        tags: input.tags ? {
          set: [],
          connectOrCreate: input.tags.map(tag => ({
            where: { name: tag },
            create: { name: tag },
          })),
        } : undefined,
      },
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
    })
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    if (post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to delete this post',
      })
    }

    await this.db.post.delete({
      where: { id: postId },
    })

    return { success: true }
  }

  async getPostBySlug(slug: string) {
    const post = await this.db.post.findUnique({
      where: { slug },
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
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    // Increment view count
    await this.db.post.update({
      where: { id: post.id },
      data: { views: { increment: 1 } },
    })

    return post
  }

  async listPosts(params: {
    limit: number
    cursor?: string
    authorId?: string
    tag?: string
    featured?: boolean
  }) {
    const where: Prisma.PostWhereInput = {
      published: true,
      authorId: params.authorId,
      featured: params.featured,
      tags: params.tag ? {
        some: { name: params.tag },
      } : undefined,
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

  async likePost(postId: string, userId: string) {
    try {
      await this.db.reaction.create({
        data: {
          postId,
          userId,
          type: 'LIKE',
        },
      })

      const post = await this.db.post.findUnique({
        where: { id: postId },
        include: {
          _count: {
            select: { reactions: true },
          },
        },
      })

      // TODO: Create notification
      // TODO: Update user stats

      return post
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Already liked this post',
          })
        }
      }
      throw error
    }
  }

  async unlikePost(postId: string, userId: string) {
    await this.db.reaction.delete({
      where: {
        postId_userId_type: {
          postId,
          userId,
          type: 'LIKE',
        },
      },
    })

    const post = await this.db.post.findUnique({
      where: { id: postId },
      include: {
        _count: {
          select: { reactions: true },
        },
      },
    })

    return post
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    let slug = generateSlug(title)
    let counter = 1

    while (await this.db.post.findUnique({ where: { slug } })) {
      slug = `${generateSlug(title)}-${counter}`
      counter++
    }

    return slug
  }
}
```

**Checklist**:
- [ ] Implement CRUD operations
- [ ] Add slug generation
- [ ] Handle tag relations
- [ ] Add view counting
- [ ] Implement reactions

#### 7. `/src/lib/validations/post.ts`
**Purpose**: Post validation schemas

**Dependencies**:
- `zod`

**Exports**:
- Validation schemas

```typescript
// src/lib/validations/post.ts
import { z } from 'zod'

export const createPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(10),
  excerpt: z.string().max(500).optional(),
  tags: z.array(z.string()).max(5).optional(),
  youtubeVideoId: z.string().optional(),
})

export const updatePostSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(10).optional(),
  excerpt: z.string().max(500).optional(),
  tags: z.array(z.string()).max(5).optional(),
})

export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
```

**Checklist**:
- [ ] Define create schema
- [ ] Define update schema
- [ ] Add validation rules
- [ ] Export types
- [ ] Test validation

#### 8. `/src/components/features/editor/rich-text-editor.tsx`
**Purpose**: Rich text editor component

**Dependencies**:
- `@tiptap/react`
- `@tiptap/starter-kit`

**Exports**:
- `RichTextEditor`: React component

```typescript
// src/components/features/editor/rich-text-editor.tsx
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Button } from '@/components/ui/button'
import { 
  Bold, 
  Italic, 
  List, 
  ListOrdered,
  Quote,
  Undo,
  Redo,
} from 'lucide-react'

interface RichTextEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
}

export function RichTextEditor({ 
  content, 
  onChange,
  placeholder = 'Start writing...'
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        placeholder: {
          placeholder,
        },
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  if (!editor) {
    return null
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="border-b p-2 flex items-center gap-1 bg-muted/50">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'bg-muted' : ''}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'bg-muted' : ''}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'bg-muted' : ''}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'bg-muted' : ''}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive('blockquote') ? 'bg-muted' : ''}
        >
          <Quote className="h-4 w-4" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            <Redo className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <EditorContent 
        editor={editor} 
        className="prose prose-sm dark:prose-invert max-w-none p-4 min-h-[200px] focus:outline-none"
      />
    </div>
  )
}
```

**Checklist**:
- [ ] Install Tiptap
- [ ] Create editor toolbar
- [ ] Add formatting buttons
- [ ] Handle content updates
- [ ] Style editor properly

#### 9. `/src/app/(main)/create/page.tsx`
**Purpose**: Post creation page

**Dependencies**:
- Editor components
- Form validation
- tRPC mutations

**Exports**:
- Default page component

```typescript
// src/app/(main)/create/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPostSchema, type CreatePostInput } from '@/lib/validations/post'
import { api } from '@/lib/api'
import { RichTextEditor } from '@/components/features/editor/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { Loader2 } from 'lucide-react'

export default function CreatePostPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(createPostSchema),
    defaultValues: {
      title: '',
      content: '',
      excerpt: '',
      tags: [],
    },
  })

  const createPost = api.post.create.useMutation({
    onSuccess: (post) => {
      toast({
        title: 'Post created!',
        description: 'Your post has been published successfully.',
      })
      router.push(`/post/${post.slug}`)
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
      setIsSubmitting(false)
    },
  })

  const onSubmit = async (data: CreatePostInput) => {
    setIsSubmitting(true)
    createPost.mutate(data)
  }

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="text-3xl font-bold mb-8">Create New Post</h1>
      
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            placeholder="Enter your post title"
            {...form.register('title')}
            className="mt-1"
          />
          {form.formState.errors.title && (
            <p className="text-sm text-destructive mt-1">
              {form.formState.errors.title.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="excerpt">Excerpt (optional)</Label>
          <Input
            id="excerpt"
            placeholder="Brief description of your post"
            {...form.register('excerpt')}
            className="mt-1"
          />
        </div>

        <div>
          <Label>Content</Label>
          <div className="mt-1">
            <RichTextEditor
              content={form.watch('content')}
              onChange={(content) => form.setValue('content', content)}
              placeholder="Write your post content..."
            />
          </div>
          {form.formState.errors.content && (
            <p className="text-sm text-destructive mt-1">
              {form.formState.errors.content.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input
            id="tags"
            placeholder="react, nextjs, typescript"
            onChange={(e) => {
              const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
              form.setValue('tags', tags)
            }}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="youtubeVideoId">YouTube Video ID (optional)</Label>
          <Input
            id="youtubeVideoId"
            placeholder="dQw4w9WgXcQ"
            {...form.register('youtubeVideoId')}
            className="mt-1"
          />
        </div>

        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish Post
          </Button>
        </div>
      </form>
    </div>
  )
}
```

**Checklist**:
- [ ] Create form layout
- [ ] Add form validation
- [ ] Integrate rich editor
- [ ] Handle submission
- [ ] Add loading states

#### 10. `/src/components/features/post/post-card.tsx`
**Purpose**: Post card component

**Dependencies**:
- UI components
- Post types

**Exports**:
- `PostCard`: React component

```typescript
// src/components/features/post/post-card.tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { formatDistanceToNow } from 'date-fns'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { PostActions } from './post-actions'
import { YouTubeEmbed } from '@/components/features/youtube/youtube-embed'
import { type RouterOutputs } from '@/lib/api'

type Post = RouterOutputs['post']['list']['items'][0]

interface PostCardProps {
  post: Post
  onLike?: () => void
  onUnlike?: () => void
  isLiked?: boolean
}

export function PostCard({ post, onLike, onUnlike, isLiked }: PostCardProps) {
  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow">
      <div className="p-6">
        {/* Author info */}
        <div className="flex items-center gap-3 mb-4">
          <Link href={`/user/${post.author.username}`}>
            <Avatar className="hover:ring-2 hover:ring-primary transition-all">
              <AvatarImage src={post.author.image || undefined} />
              <AvatarFallback>{post.author.username[0].toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <div>
            <Link 
              href={`/user/${post.author.username}`}
              className="font-semibold hover:underline"
            >
              {post.author.username}
            </Link>
            <p className="text-sm text-muted-foreground">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>

        {/* Content */}
        <Link href={`/post/${post.slug}`}>
          <h3 className="text-xl font-bold mb-2 hover:text-primary transition-colors">
            {post.title}
          </h3>
        </Link>
        
        {post.excerpt && (
          <p className="text-muted-foreground mb-4 line-clamp-3">
            {post.excerpt}
          </p>
        )}

        {/* YouTube embed */}
        {post.youtubeVideoId && (
          <div className="mb-4">
            <YouTubeEmbed videoId={post.youtubeVideoId} />
          </div>
        )}

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.tags.map(tag => (
              <Link key={tag.id} href={`/tag/${tag.name}`}>
                <Badge variant="secondary" className="hover:bg-secondary/80">
                  #{tag.name}
                </Badge>
              </Link>
            ))}
          </div>
        )}

        {/* Actions */}
        <PostActions
          postId={post.id}
          likes={post._count.reactions}
          comments={post._count.comments}
          isLiked={isLiked}
          onLike={onLike}
          onUnlike={onUnlike}
        />
      </div>
    </Card>
  )
}
```

**Checklist**:
- [ ] Create card layout
- [ ] Add author info
- [ ] Display content preview
- [ ] Include YouTube embed
- [ ] Add action buttons

---

## Phase 3: Engagement Features (Week 5-6)

### Goals & Objectives
- ✅ Implement comment system
- ✅ Add reaction features
- ✅ Create notification system
- ✅ Build activity feeds
- ✅ Add social sharing

### Files to Complete

#### 1. `/src/server/api/routers/comment.ts`
**Purpose**: Comment API endpoints

**Dependencies**:
- tRPC setup
- Comment service

**Exports**:
- `commentRouter`: tRPC router

```typescript
// src/server/api/routers/comment.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { CommentService } from '@/server/services/comment.service'

export const commentRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      postId: z.string(),
      content: z.string().min(1).max(1000),
      parentId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      return commentService.createComment({
        ...input,
        authorId: ctx.session.user.id,
      })
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      content: z.string().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      return commentService.updateComment(
        input.id,
        ctx.session.user.id,
        input.content
      )
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      return commentService.deleteComment(input.id, ctx.session.user.id)
    }),

  list: publicProcedure
    .input(z.object({
      postId: z.string(),
      limit: z.number().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      return commentService.listComments(input)
    }),

  like: protectedProcedure
    .input(z.object({
      commentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const commentService = new CommentService(ctx.db)
      return commentService.likeComment(input.commentId, ctx.session.user.id)
    }),
})
```

**Checklist**:
- [ ] Create comment endpoints
- [ ] Add nested comments
- [ ] Implement likes
- [ ] Add pagination
- [ ] Handle permissions

#### 2. `/src/server/services/comment.service.ts`
**Purpose**: Comment business logic

**Dependencies**:
- Prisma client
- Notification service

**Exports**:
- `CommentService`: Service class

```typescript
// src/server/services/comment.service.ts
import { PrismaClient } from '@prisma/client'
import { TRPCError } from '@trpc/server'

export class CommentService {
  constructor(private db: PrismaClient) {}

  async createComment(input: {
    postId: string
    content: string
    authorId: string
    parentId?: string
  }) {
    // Validate post exists
    const post = await this.db.post.findUnique({
      where: { id: input.postId },
      select: { id: true, authorId: true },
    })

    if (!post) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',
      })
    }

    // Validate parent comment if provided
    if (input.parentId) {
      const parentComment = await this.db.comment.findUnique({
        where: { id: input.parentId },
        select: { id: true, postId: true },
      })

      if (!parentComment || parentComment.postId !== input.postId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid parent comment',
        })
      }
    }

    const comment = await this.db.comment.create({
      data: {
        content: input.content,
        postId: input.postId,
        authorId: input.authorId,
        parentId: input.parentId,
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        _count: {
          select: {
            likes: true,
            replies: true,
          },
        },
      },
    })

    // Create notification for post author
    if (post.authorId !== input.authorId) {
      await this.db.notification.create({
        data: {
          type: 'POST_COMMENTED',
          userId: post.authorId,
          actorId: input.authorId,
          entityId: comment.id,
          entityType: 'COMMENT',
          message: `commented on your post`,
        },
      })
    }

    return comment
  }

  async updateComment(commentId: string, userId: string, content: string) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
    })

    if (!comment) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Comment not found',
      })
    }

    if (comment.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to edit this comment',
      })
    }

    return this.db.comment.update({
      where: { id: commentId },
      data: { 
        content,
        edited: true,
        editedAt: new Date(),
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        _count: {
          select: {
            likes: true,
            replies: true,
          },
        },
      },
    })
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      include: {
        post: {
          select: { authorId: true },
        },
      },
    })

    if (!comment) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Comment not found',
      })
    }

    // Allow deletion by comment author or post author
    if (comment.authorId !== userId && comment.post.authorId !== userId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to delete this comment',
      })
    }

    // Soft delete to preserve thread structure
    await this.db.comment.update({
      where: { id: commentId },
      data: {
        deleted: true,
        content: '[deleted]',
      },
    })

    return { success: true }
  }

  async listComments(params: {
    postId: string
    limit: number
    cursor?: string
  }) {
    const comments = await this.db.comment.findMany({
      where: {
        postId: params.postId,
        parentId: null, // Only top-level comments
      },
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        _count: {
          select: {
            likes: true,
            replies: true,
          },
        },
        replies: {
          take: 3, // Load first 3 replies
          include: {
            author: {
              include: {
                profile: true,
              },
            },
            _count: {
              select: {
                likes: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    let nextCursor: string | undefined = undefined
    if (comments.length > params.limit) {
      const nextItem = comments.pop()
      nextCursor = nextItem!.id
    }

    return {
      items: comments,
      nextCursor,
    }
  }

  async likeComment(commentId: string, userId: string) {
    try {
      await this.db.commentLike.create({
        data: {
          commentId,
          userId,
        },
      })

      const comment = await this.db.comment.findUnique({
        where: { id: commentId },
        select: {
          authorId: true,
          _count: {
            select: { likes: true },
          },
        },
      })

      // Create notification for comment author
      if (comment && comment.authorId !== userId) {
        await this.db.notification.create({
          data: {
            type: 'COMMENT_LIKED',
            userId: comment.authorId,
            actorId: userId,
            entityId: commentId,
            entityType: 'COMMENT',
            message: `liked your comment`,
          },
        })
      }

      return { success: true, likes: comment?._count.likes || 0 }
    } catch (error) {
      // Handle duplicate like
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Already liked this comment',
      })
    }
  }
}
```

**Checklist**:
- [ ] Implement CRUD operations
- [ ] Add nested comments
- [ ] Create notifications
- [ ] Handle soft deletes
- [ ] Add like functionality

#### 3. `/src/components/features/comments/comment-thread.tsx`
**Purpose**: Comment thread component

**Dependencies**:
- Comment components
- API hooks

**Exports**:
- `CommentThread`: React component

```typescript
// src/components/features/comments/comment-thread.tsx
'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { CommentItem } from './comment-item'
import { CommentForm } from './comment-form'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'

interface CommentThreadProps {
  postId: string
}

export function CommentThread({ postId }: CommentThreadProps) {
  const { user } = useAuth()
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = 
    api.comment.list.useInfiniteQuery(
      { postId, limit: 20 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    )

  const comments = data?.pages.flatMap(page => page.items) ?? []

  return (
    <div className="space-y-6">
      {/* Comment form */}
      {user && (
        <CommentForm 
          postId={postId}
          onSuccess={() => {
            // Refetch comments
          }}
        />
      )}

      {/* Comments list */}
      <div className="space-y-4">
        {comments.map(comment => (
          <CommentItem
            key={comment.id}
            comment={comment}
            postId={postId}
            onReply={() => setReplyingTo(comment.id)}
            isReplying={replyingTo === comment.id}
            onCancelReply={() => setReplyingTo(null)}
          />
        ))}
      </div>

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Load more comments
          </Button>
        </div>
      )}
    </div>
  )
}
```

**Checklist**:
- [ ] Create thread layout
- [ ] Add infinite scroll
- [ ] Handle replies
- [ ] Show loading states
- [ ] Add comment form

#### 4. `/src/server/api/routers/notification.ts`
**Purpose**: Notification API endpoints

**Dependencies**:
- tRPC setup
- Notification service

**Exports**:
- `notificationRouter`: tRPC router

```typescript
// src/server/api/routers/notification.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc'
import { NotificationService } from '@/server/services/notification.service'

export const notificationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(20),
      cursor: z.string().optional(),
      unreadOnly: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      return notificationService.listNotifications({
        ...input,
        userId: ctx.session.user.id,
      })
    }),

  markAsRead: protectedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      return notificationService.markAsRead(
        input.id,
        ctx.session.user.id
      )
    }),

  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const notificationService = new NotificationService(ctx.db)
      return notificationService.markAllAsRead(ctx.session.user.id)
    }),

  getUnreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      const notificationService = new NotificationService(ctx.db)
      return notificationService.getUnreadCount(ctx.session.user.id)
    }),

  deleteNotification: protectedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const notificationService = new NotificationService(ctx.db)
      return notificationService.deleteNotification(
        input.id,
        ctx.session.user.id
      )
    }),
})
```

**Checklist**:
- [ ] Create list endpoint
- [ ] Add read/unread functionality
- [ ] Implement count endpoint
- [ ] Add deletion
- [ ] Include filtering

#### 5. `/src/server/services/notification.service.ts`
**Purpose**: Notification business logic

**Dependencies**:
- Prisma client
- WebSocket service

**Exports**:
- `NotificationService`: Service class

```typescript
// src/server/services/notification.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'

export class NotificationService {
  constructor(private db: PrismaClient) {}

  async createNotification(input: {
    type: string
    userId: string
    actorId?: string
    entityId?: string
    entityType?: string
    message: string
    data?: any
  }) {
    const notification = await this.db.notification.create({
      data: input,
      include: {
        actor: {
          include: {
            profile: true,
          },
        },
      },
    })

    // TODO: Send real-time notification via WebSocket
    // TODO: Send push notification if enabled
    // TODO: Send email notification if enabled

    return notification
  }

  async listNotifications(params: {
    userId: string
    limit: number
    cursor?: string
    unreadOnly?: boolean
  }) {
    const where: Prisma.NotificationWhereInput = {
      userId: params.userId,
      read: params.unreadOnly ? false : undefined,
    }

    const notifications = await this.db.notification.findMany({
      where,
      take: params.limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      include: {
        actor: {
          include: {
            profile: true,
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

    return {
      items: notifications,
      nextCursor,
    }
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.db.notification.findUnique({
      where: { id: notificationId },
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
        message: 'Not authorized',
      })
    }

    return this.db.notification.update({
      where: { id: notificationId },
      data: { read: true },
    })
  }

  async markAllAsRead(userId: string) {
    await this.db.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: { read: true },
    })

    return { success: true }
  }

  async getUnreadCount(userId: string) {
    const count = await this.db.notification.count({
      where: {
        userId,
        read: false,
      },
    })

    return { count }
  }

  async deleteNotification(notificationId: string, userId: string) {
    const notification = await this.db.notification.findUnique({
      where: { id: notificationId },
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
        message: 'Not authorized',
      })
    }

    await this.db.notification.delete({
      where: { id: notificationId },
    })

    return { success: true }
  }

  async deleteOldNotifications(daysToKeep: number = 30) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

    await this.db.notification.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
        read: true,
      },
    })
  }
}
```

**Checklist**:
- [ ] Create notification logic
- [ ] Add listing with filters
- [ ] Implement read status
- [ ] Add cleanup function
- [ ] Include actor data

---

## Phase 4: Advanced Features (Week 7-8)

### Goals & Objectives
- ✅ Implement real-time features
- ✅ Add YouTube integration
- ✅ Create search functionality
- ✅ Build recommendation engine
- ✅ Add file uploads

### Files to Complete

#### 1. `/src/server/websocket/socket.server.ts`
**Purpose**: WebSocket server setup

**Dependencies**:
- Socket.io
- Authentication

**Exports**:
- `SocketServer`: WebSocket server class

```typescript
// src/server/websocket/socket.server.ts
import { Server as HTTPServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import { parse } from 'cookie'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/auth.config'

export class WebSocketServer {
  private io: SocketServer

  constructor(httpServer: HTTPServer) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL,
        credentials: true,
      },
    })

    this.setupMiddleware()
    this.setupHandlers()
  }

  private setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const cookies = parse(socket.request.headers.cookie || '')
        const sessionToken = cookies['next-auth.session-token']

        if (!sessionToken) {
          return next(new Error('Unauthorized'))
        }

        // Verify session
        const session = await getServerSession(authOptions)
        if (!session?.user) {
          return next(new Error('Invalid session'))
        }

        socket.data.userId = session.user.id
        socket.data.user = session.user
        next()
      } catch (error) {
        next(new Error('Authentication failed'))
      }
    })
  }

  private setupHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User ${socket.data.userId} connected`)

      // Join user's personal room
      socket.join(`user:${socket.data.userId}`)

      // Join post rooms
      socket.on('post:join', (postId: string) => {
        socket.join(`post:${postId}`)
      })

      socket.on('post:leave', (postId: string) => {
        socket.leave(`post:${postId}`)
      })

      // Handle typing indicators
      socket.on('comment:typing:start', (data: { postId: string }) => {
        socket.to(`post:${data.postId}`).emit('comment:typing', {
          userId: socket.data.userId,
          username: socket.data.user.username,
          isTyping: true,
        })
      })

      socket.on('comment:typing:stop', (data: { postId: string }) => {
        socket.to(`post:${data.postId}`).emit('comment:typing', {
          userId: socket.data.userId,
          username: socket.data.user.username,
          isTyping: false,
        })
      })

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User ${socket.data.userId} disconnected`)
      })
    })
  }

  // Emit events from server
  emitToUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, data)
  }

  emitToPost(postId: string, event: string, data: any) {
    this.io.to(`post:${postId}`).emit(event, data)
  }

  broadcast(event: string, data: any) {
    this.io.emit(event, data)
  }
}
```

**Checklist**:
- [ ] Set up Socket.io server
- [ ] Add authentication
- [ ] Create room management
- [ ] Handle events
- [ ] Add error handling

#### 2. `/src/hooks/use-socket.ts`
**Purpose**: WebSocket client hook

**Dependencies**:
- Socket.io client
- React hooks

**Exports**:
- `useSocket`: React hook

```typescript
// src/hooks/use-socket.ts
'use client'

import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from './use-auth'

let socket: Socket | null = null

export function useSocket() {
  const { user } = useAuth()
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect()
        socket = null
      }
      return
    }

    if (!socket) {
      socket = io(process.env.NEXT_PUBLIC_WS_URL || '', {
        withCredentials: true,
        transports: ['websocket', 'polling'],
      })

      socket.on('connect', () => {
        console.log('Connected to WebSocket')
        setIsConnected(true)
      })

      socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket')
        setIsConnected(false)
      })

      socket.on('error', (error) => {
        console.error('WebSocket error:', error)
      })
    }

    return () => {
      if (socket) {
        socket.disconnect()
        socket = null
      }
    }
  }, [user])

  const emit = (event: string, data?: any) => {
    if (socket && socket.connected) {
      socket.emit(event, data)
    }
  }

  const on = (event: string, handler: (...args: any[]) => void) => {
    if (socket) {
      socket.on(event, handler)
    }
    return () => {
      if (socket) {
        socket.off(event, handler)
      }
    }
  }

  const joinRoom = (room: string) => {
    emit(`${room.split(':')[0]}:join`, room.split(':')[1])
  }

  const leaveRoom = (room: string) => {
    emit(`${room.split(':')[0]}:leave`, room.split(':')[1])
  }

  return {
    isConnected,
    emit,
    on,
    joinRoom,
    leaveRoom,
  }
}
```

**Checklist**:
- [ ] Create socket connection
- [ ] Handle authentication
- [ ] Add event emitters
- [ ] Add event listeners
- [ ] Manage connection state

#### 3. `/src/server/services/youtube.service.ts`
**Purpose**: YouTube API integration

**Dependencies**:
- YouTube API client
- Caching

**Exports**:
- `YouTubeService`: Service class

```typescript
// src/server/services/youtube.service.ts
import { google } from 'googleapis'
import { cache } from '@/lib/cache'

export class YouTubeService {
  private youtube

  constructor() {
    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY,
    })
  }

  async getVideoDetails(videoId: string) {
    const cacheKey = `youtube:video:${videoId}`
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: [videoId],
      })

      const video = response.data.items?.[0]
      if (!video) {
        throw new Error('Video not found')
      }

      const details = {
        id: video.id,
        title: video.snippet?.title,
        description: video.snippet?.description,
        thumbnail: video.snippet?.thumbnails?.maxres?.url || 
                   video.snippet?.thumbnails?.high?.url,
        channelId: video.snippet?.channelId,
        channelTitle: video.snippet?.channelTitle,
        duration: this.parseDuration(video.contentDetails?.duration),
        viewCount: parseInt(video.statistics?.viewCount || '0'),
        likeCount: parseInt(video.statistics?.likeCount || '0'),
        publishedAt: video.snippet?.publishedAt,
      }

      // Cache for 1 hour
      await cache.set(cacheKey, details, 3600)

      return details
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new Error('Failed to fetch video details')
    }
  }

  async getChannelDetails(channelId: string) {
    const cacheKey = `youtube:channel:${channelId}`
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    try {
      const response = await this.youtube.channels.list({
        part: ['snippet', 'statistics'],
        id: [channelId],
      })

      const channel = response.data.items?.[0]
      if (!channel) {
        throw new Error('Channel not found')
      }

      const details = {
        id: channel.id,
        title: channel.snippet?.title,
        description: channel.snippet?.description,
        thumbnail: channel.snippet?.thumbnails?.high?.url,
        subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
        videoCount: parseInt(channel.statistics?.videoCount || '0'),
        viewCount: parseInt(channel.statistics?.viewCount || '0'),
      }

      // Cache for 24 hours
      await cache.set(cacheKey, details, 86400)

      return details
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new Error('Failed to fetch channel details')
    }
  }

  async searchVideos(query: string, maxResults: number = 10) {
    try {
      const response = await this.youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults,
        order: 'relevance',
      })

      return response.data.items?.map(item => ({
        id: item.id?.videoId,
        title: item.snippet?.title,
        description: item.snippet?.description,
        thumbnail: item.snippet?.thumbnails?.high?.url,
        channelTitle: item.snippet?.channelTitle,
        publishedAt: item.snippet?.publishedAt,
      })) || []
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new Error('Failed to search videos')
    }
  }

  private parseDuration(duration?: string): number {
    if (!duration) return 0

    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    if (!match) return 0

    const hours = parseInt(match[1] || '0')
    const minutes = parseInt(match[2] || '0')
    const seconds = parseInt(match[3] || '0')

    return hours * 3600 + minutes * 60 + seconds
  }
}
```

**Checklist**:
- [ ] Set up YouTube API
- [ ] Add video fetching
- [ ] Add channel fetching
- [ ] Implement search
- [ ] Add caching layer

#### 4. `/src/components/features/youtube/youtube-embed.tsx`
**Purpose**: YouTube embed component

**Dependencies**:
- YouTube service
- UI components

**Exports**:
- `YouTubeEmbed`: React component

```typescript
// src/components/features/youtube/youtube-embed.tsx
'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Play, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration, formatNumber } from '@/lib/utils'

interface YouTubeEmbedProps {
  videoId: string
  className?: string
  showDetails?: boolean
}

export function YouTubeEmbed({ 
  videoId, 
  className = '',
  showDetails = true 
}: YouTubeEmbedProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [showPlayer, setShowPlayer] = useState(false)

  const { data: video, isLoading } = api.youtube.getVideo.useQuery(
    { videoId },
    { enabled: showDetails }
  )

  if (isLoading && showDetails) {
    return (
      <div className={`relative aspect-video ${className}`}>
        <Skeleton className="absolute inset-0" />
      </div>
    )
  }

  if (showPlayer) {
    return (
      <div className={`relative aspect-video ${className}`}>
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          title={video?.title || 'YouTube video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full rounded-lg"
          onLoad={() => setIsLoaded(true)}
        />
        {!isLoaded && (
          <Skeleton className="absolute inset-0" />
        )}
      </div>
    )
  }

  return (
    <div className={`relative group ${className}`}>
      <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
        {video?.thumbnail ? (
          <Image
            src={video.thumbnail}
            alt={video.title || 'Video thumbnail'}
            fill
            className="object-cover"
          />
        ) : (
          <img
            src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
          <button
            onClick={() => setShowPlayer(true)}
            className="bg-red-600 hover:bg-red-700 rounded-full p-4 transform group-hover:scale-110 transition-transform"
            aria-label="Play video"
          >
            <Play className="w-8 h-8 text-white fill-white ml-1" />
          </button>
        </div>

        {/* Duration badge */}
        {video?.duration && (
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
            {formatDuration(video.duration)}
          </div>
        )}
      </div>

      {/* Video details */}
      {showDetails && video && (
        <div className="mt-3 space-y-2">
          <h3 className="font-semibold line-clamp-2">{video.title}</h3>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{video.channelTitle}</span>
            <div className="flex items-center gap-3">
              <span>{formatNumber(video.viewCount)} views</span>
              <a
                href={`https://youtube.com/watch?v=${videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Checklist**:
- [ ] Create embed component
- [ ] Add thumbnail preview
- [ ] Show video details
- [ ] Add play functionality
- [ ] Include loading states

#### 5. `/src/server/services/search.service.ts`
**Purpose**: Search functionality

**Dependencies**:
- Elasticsearch/Algolia
- Database

**Exports**:
- `SearchService`: Service class

```typescript
// src/server/services/search.service.ts
import { PrismaClient } from '@prisma/client'
import algoliasearch from 'algoliasearch'

export class SearchService {
  private algolia
  private postsIndex
  private usersIndex

  constructor(private db: PrismaClient) {
    this.algolia = algoliasearch(
      process.env.ALGOLIA_APP_ID!,
      process.env.ALGOLIA_ADMIN_KEY!
    )
    this.postsIndex = this.algolia.initIndex('posts')
    this.usersIndex = this.algolia.initIndex('users')

    // Configure indices
    this.configureIndices()
  }

  private async configureIndices() {
    // Posts index configuration
    await this.postsIndex.setSettings({
      searchableAttributes: [
        'title',
        'content',
        'excerpt',
        'tags',
        'author.username',
      ],
      attributesForFaceting: [
        'tags',
        'author.username',
        'featured',
      ],
      ranking: [
        'typo',
        'geo',
        'words',
        'filters',
        'proximity',
        'attribute',
        'exact',
        'custom',
      ],
      customRanking: [
        'desc(popularity)',
        'desc(createdAt)',
      ],
    })

    // Users index configuration
    await this.usersIndex.setSettings({
      searchableAttributes: [
        'username',
        'bio',
      ],
      ranking: [
        'typo',
        'geo',
        'words',
        'filters',
        'proximity',
        'attribute',
        'exact',
        'custom',
      ],
      customRanking: [
        'desc(followers)',
        'desc(posts)',
      ],
    })
  }

  async indexPost(post: any) {
    const record = {
      objectID: post.id,
      title: post.title,
      content: this.stripHtml(post.content).substring(0, 1000),
      excerpt: post.excerpt,
      slug: post.slug,
      tags: post.tags.map((t: any) => t.name),
      author: {
        id: post.author.id,
        username: post.author.username,
        image: post.author.image,
      },
      featured: post.featured,
      popularity: post._count.reactions + post._count.comments * 2,
      createdAt: post.createdAt.getTime(),
      publishedAt: post.publishedAt?.getTime(),
    }

    await this.postsIndex.saveObject(record)
  }

  async indexUser(user: any) {
    const record = {
      objectID: user.id,
      username: user.username,
      bio: user.bio,
      image: user.image,
      followers: user._count.followers,
      posts: user._count.posts,
      verified: user.verified,
      createdAt: user.createdAt.getTime(),
    }

    await this.usersIndex.saveObject(record)
  }

  async searchPosts(query: string, options: {
    page?: number
    hitsPerPage?: number
    filters?: string
    facets?: string[]
  } = {}) {
    const results = await this.postsIndex.search(query, {
      page: options.page || 0,
      hitsPerPage: options.hitsPerPage || 20,
      filters: options.filters,
      facets: options.facets || ['tags', 'author.username'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    })

    return {
      hits: results.hits,
      totalHits: results.nbHits,
      totalPages: results.nbPages,
      page: results.page,
      facets: results.facets,
      processingTime: results.processingTimeMS,
    }
  }

  async searchUsers(query: string, options: {
    page?: number
    hitsPerPage?: number
  } = {}) {
    const results = await this.usersIndex.search(query, {
      page: options.page || 0,
      hitsPerPage: options.hitsPerPage || 20,
    })

    return {
      hits: results.hits,
      totalHits: results.nbHits,
      totalPages: results.nbPages,
      page: results.page,
      processingTime: results.processingTimeMS,
    }
  }

  async searchAll(query: string) {
    const [posts, users] = await Promise.all([
      this.searchPosts(query, { hitsPerPage: 5 }),
      this.searchUsers(query, { hitsPerPage: 5 }),
    ])

    return {
      posts: posts.hits,
      users: users.hits,
      totalResults: posts.totalHits + users.totalHits,
    }
  }

  async deletePost(postId: string) {
    await this.postsIndex.deleteObject(postId)
  }

  async deleteUser(userId: string) {
    await this.usersIndex.deleteObject(userId)
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim()
  }

  // Fallback database search if Algolia is not available
  async searchDatabase(query: string, type: 'posts' | 'users' = 'posts') {
    if (type === 'posts') {
      return this.db.post.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
            { excerpt: { contains: query, mode: 'insensitive' } },
            { tags: { some: { name: { contains: query, mode: 'insensitive' } } } },
          ],
          published: true,
        },
        include: {
          author: true,
          tags: true,
          _count: {
            select: {
              comments: true,
              reactions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    } else {
      return this.db.user.findMany({
        where: {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { bio: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          _count: {
            select: {
              posts: true,
              followers: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    }
  }
}
```

**Checklist**:
- [ ] Set up search service
- [ ] Configure indices
- [ ] Add indexing methods
- [ ] Implement search
- [ ] Add fallback search

---

## Phase 5: Gamification & Social (Week 9-10)

### Goals & Objectives
- ✅ Implement achievement system
- ✅ Add XP and levels
- ✅ Create leaderboards
- ✅ Build badge system
- ✅ Add social features

### Files to Complete

#### 1. `/src/server/services/gamification.service.ts`
**Purpose**: Gamification logic

**Dependencies**:
- Database
- Achievement definitions

**Exports**:
- `GamificationService`: Service class

```typescript
// src/server/services/gamification.service.ts
import { PrismaClient } from '@prisma/client'
import { achievements } from '@/config/achievements'

export class GamificationService {
  constructor(private db: PrismaClient) {}

  async awardXP(userId: string, amount: number, reason: string) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        experience: { increment: amount },
      },
      select: {
        experience: true,
        level: true,
      },
    })

    // Check for level up
    const newLevel = this.calculateLevel(user.experience)
    if (newLevel > user.level) {
      await this.levelUp(userId, newLevel)
    }

    // Log XP gain
    await this.db.xpLog.create({
      data: {
        userId,
        amount,
        reason,
      },
    })

    return {
      totalXP: user.experience,
      level: newLevel,
      xpGained: amount,
    }
  }

  async checkAchievements(userId: string, trigger: string, data?: any) {
    const relevantAchievements = achievements.filter(a => a.trigger === trigger)
    const unlockedAchievements = []

    for (const achievement of relevantAchievements) {
      const isUnlocked = await this.isAchievementUnlocked(userId, achievement.id)
      if (!isUnlocked) {
        const criteria = await this.checkCriteria(userId, achievement, data)
        if (criteria) {
          await this.unlockAchievement(userId, achievement.id)
          unlockedAchievements.push(achievement)
        }
      }
    }

    return unlockedAchievements
  }

  private async unlockAchievement(userId: string, achievementId: string) {
    await this.db.userAchievement.create({
      data: {
        userId,
        achievementId,
        unlockedAt: new Date(),
      },
    })

    // Award XP for achievement
    const achievement = achievements.find(a => a.id === achievementId)
    if (achievement) {
      await this.awardXP(userId, achievement.xp, `Achievement: ${achievement.name}`)
    }

    // Create notification
    await this.db.notification.create({
      data: {
        type: 'ACHIEVEMENT_UNLOCKED',
        userId,
        message: `You unlocked the "${achievement?.name}" achievement!`,
        data: { achievementId },
      },
    })
  }

  private async checkCriteria(userId: string, achievement: any, data?: any): Promise<boolean> {
    switch (achievement.id) {
      case 'first_post':
        const postCount = await this.db.post.count({ where: { authorId: userId } })
        return postCount >= 1

      case 'prolific_writer':
        const posts = await this.db.post.count({ where: { authorId: userId } })
        return posts >= 10

      case 'social_butterfly':
        const followers = await this.db.follow.count({ where: { followingId: userId } })
        return followers >= 50

      case 'engagement_master':
        const reactions = await this.db.reaction.count({ where: { userId } })
        return reactions >= 100

      // Add more achievement criteria...
      
      default:
        return false
    }
  }

  private calculateLevel(xp: number): number {
    // Level calculation formula
    return Math.floor(Math.sqrt(xp / 100)) + 1
  }

  private async levelUp(userId: string, newLevel: number) {
    await this.db.user.update({
      where: { id: userId },
      data: { level: newLevel },
    })

    // Create notification
    await this.db.notification.create({
      data: {
        type: 'LEVEL_UP',
        userId,
        message: `Congratulations! You reached level ${newLevel}!`,
        data: { level: newLevel },
      },
    })

    // Check for level-based achievements
    await this.checkAchievements(userId, 'level_up', { level: newLevel })
  }

  async getLeaderboard(type: 'xp' | 'posts' | 'followers', timeframe?: 'week' | 'month' | 'all') {
    const dateFilter = this.getDateFilter(timeframe)

    switch (type) {
      case 'xp':
        return this.db.user.findMany({
          where: dateFilter ? {
            xpLogs: {
              some: {
                createdAt: { gte: dateFilter },
              },
            },
          } : undefined,
          select: {
            id: true,
            username: true,
            image: true,
            experience: true,
            level: true,
          },
          orderBy: { experience: 'desc' },
          take: 100,
        })

      case 'posts':
        // Complex aggregation for post count in timeframe
        const postLeaderboard = await this.db.$queryRaw`
          SELECT 
            u.id,
            u.username,
            u.image,
            u.level,
            COUNT(p.id) as post_count
          FROM users u
          LEFT JOIN posts p ON p."authorId" = u.id
          ${dateFilter ? `WHERE p."createdAt" >= ${dateFilter}` : ''}
          GROUP BY u.id
          ORDER BY post_count DESC
          LIMIT 100
        `
        return postLeaderboard

      case 'followers':
        // Complex aggregation for follower gain in timeframe
        const followerLeaderboard = await this.db.$queryRaw`
          SELECT 
            u.id,
            u.username,
            u.image,
            u.level,
            COUNT(f.id) as follower_count
          FROM users u
          LEFT JOIN follows f ON f."followingId" = u.id
          ${dateFilter ? `WHERE f."createdAt" >= ${dateFilter}` : ''}
          GROUP BY u.id
          ORDER BY follower_count DESC
          LIMIT 100
        `
        return followerLeaderboard
    }
  }

  private getDateFilter(timeframe?: 'week' | 'month' | 'all'): Date | null {
    if (!timeframe || timeframe === 'all') return null

    const now = new Date()
    if (timeframe === 'week') {
      now.setDate(now.getDate() - 7)
    } else if (timeframe === 'month') {
      now.setMonth(now.getMonth() - 1)
    }
    return now
  }

  async getUserStats(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        achievements: {
          include: {
            achievement: true,
          },
        },
        _count: {
          select: {
            posts: true,
            comments: true,
            reactions: true,
            followers: true,
            following: true,
          },
        },
      },
    })

    if (!user) throw new Error('User not found')

    const nextLevelXP = Math.pow(user.level, 2) * 100
    const currentLevelXP = Math.pow(user.level - 1, 2) * 100
    const progressXP = user.experience - currentLevelXP
    const neededXP = nextLevelXP - currentLevelXP

    return {
      level: user.level,
      experience: user.experience,
      progress: {
        current: progressXP,
        needed: neededXP,
        percentage: (progressXP / neededXP) * 100,
      },
      achievements: user.achievements,
      stats: user._count,
      rank: await this.getUserRank(userId),
    }
  }

  private async getUserRank(userId: string) {
    const rank = await this.db.user.count({
      where: {
        experience: {
          gt: await this.db.user.findUnique({
            where: { id: userId },
            select: { experience: true },
          }).then(u => u?.experience || 0),
        },
      },
    })

    return rank + 1
  }
}
```

**Checklist**:
- [ ] Create XP system
- [ ] Add achievement checking
- [ ] Implement leaderboards
- [ ] Add level calculation
- [ ] Create user stats

#### 2. `/src/config/achievements.ts`
**Purpose**: Achievement definitions

**Dependencies**: None

**Exports**:
- `achievements`: Achievement list

```typescript
// src/config/achievements.ts
export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  xp: number
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  trigger: string
  criteria: any
}

export const achievements: Achievement[] = [
  // Content Creation
  {
    id: 'first_post',
    name: 'First Steps',
    description: 'Create your first post',
    icon: '✍️',
    xp: 50,
    rarity: 'common',
    trigger: 'post_created',
    criteria: { postCount: 1 },
  },
  {
    id: 'prolific_writer',
    name: 'Prolific Writer',
    description: 'Create 10 posts',
    icon: '📚',
    xp: 200,
    rarity: 'uncommon',
    trigger: 'post_created',
    criteria: { postCount: 10 },
  },
  {
    id: 'viral_post',
    name: 'Gone Viral',
    description: 'Get 1000 reactions on a single post',
    icon: '🔥',
    xp: 500,
    rarity: 'rare',
    trigger: 'post_liked',
    criteria: { reactions: 1000 },
  },

  // Social
  {
    id: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Reach 50 followers',
    icon: '🦋',
    xp: 300,
    rarity: 'uncommon',
    trigger: 'user_followed',
    criteria: { followers: 50 },
  },
  {
    id: 'influencer',
    name: 'Influencer',
    description: 'Reach 1000 followers',
    icon: '⭐',
    xp: 1000,
    rarity: 'epic',
    trigger: 'user_followed',
    criteria: { followers: 1000 },
  },

  // Engagement
  {
    id: 'conversationalist',
    name: 'Conversationalist',
    description: 'Leave 100 comments',
    icon: '💬',
    xp: 150,
    rarity: 'common',
    trigger: 'comment_created',
    criteria: { comments: 100 },
  },
  {
    id: 'helpful_member',
    name: 'Helpful Member',
    description: 'Receive 50 likes on your comments',
    icon: '🤝',
    xp: 200,
    rarity: 'uncommon',
    trigger: 'comment_liked',
    criteria: { commentLikes: 50 },
  },

  // Special
  {
    id: 'early_adopter',
    name: 'Early Adopter',
    description: 'Join during the first month',
    icon: '🌟',
    xp: 500,
    rarity: 'legendary',
    trigger: 'user_created',
    criteria: { joinDate: 'first_month' },
  },
  {
    id: 'sparkle_fan',
    name: 'True Sparkle Fan',
    description: 'Complete all Sparkle-themed challenges',
    icon: '✨',
    xp: 1000,
    rarity: 'legendary',
    trigger: 'challenge_completed',
    criteria: { challenges: 'all_sparkle' },
  },
]
```

**Checklist**:
- [ ] Define achievement types
- [ ] Set XP rewards
- [ ] Add rarity levels
- [ ] Create trigger system
- [ ] Design achievement icons

#### 3. `/src/components/features/gamification/level-progress.tsx`
**Purpose**: Level progress display

**Dependencies**:
- UI components
- User stats

**Exports**:
- `LevelProgress`: React component

```typescript
// src/components/features/gamification/level-progress.tsx
'use client'

import { Progress } from '@/components/ui/progress'
import { Card } from '@/components/ui/card'
import { Trophy, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/utils'

interface LevelProgressProps {
  userId: string
  showDetails?: boolean
}

export function LevelProgress({ userId, showDetails = true }: LevelProgressProps) {
  const { data: stats, isLoading } = api.gamification.getUserStats.useQuery({ userId })

  if (isLoading || !stats) {
    return (
      <Card className="p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3 mb-2" />
          <div className="h-8 bg-muted rounded" />
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-sparkle-500 to-sparkle-700 flex items-center justify-center text-white font-bold text-lg">
                {stats.level}
              </div>
              <Trophy className="w-4 h-4 text-yellow-500 absolute -bottom-1 -right-1" />
            </div>
            <div>
              <p className="font-semibold">Level {stats.level}</p>
              <p className="text-sm text-muted-foreground">
                Rank #{stats.rank}
              </p>
            </div>
          </div>
          
          {showDetails && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total XP</p>
              <p className="font-bold">{formatNumber(stats.experience)}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress to Level {stats.level + 1}</span>
            <span className="font-medium">
              {formatNumber(stats.progress.current)} / {formatNumber(stats.progress.needed)}
            </span>
          </div>
          <Progress 
            value={stats.progress.percentage} 
            className="h-2"
          />
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="text-center p-2 bg-muted rounded">
              <p className="text-2xl font-bold">{stats.stats.posts}</p>
              <p className="text-xs text-muted-foreground">Posts</p>
            </div>
            <div className="text-center p-2 bg-muted rounded">
              <p className="text-2xl font-bold">{stats.stats.followers}</p>
              <p className="text-xs text-muted-foreground">Followers</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
```

**Checklist**:
- [ ] Create progress UI
- [ ] Show level info
- [ ] Display XP progress
- [ ] Add rank display
- [ ] Include stats summary

#### 4. `/src/components/features/gamification/achievement-grid.tsx`
**Purpose**: Achievement display grid

**Dependencies**:
- Achievement data
- UI components

**Exports**:
- `AchievementGrid`: React component

```typescript
// src/components/features/gamification/achievement-grid.tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Lock, Trophy, Star } from 'lucide-react'
import { api } from '@/lib/api'
import { achievements } from '@/config/achievements'
import { cn } from '@/lib/utils'

interface AchievementGridProps {
  userId: string
}

export function AchievementGrid({ userId }: AchievementGridProps) {
  const [selectedCategory, setSelectedCategory] = useState('all')
  
  const { data: userAchievements = [] } = api.gamification.getUserAchievements.useQuery({ userId })
  
  const unlockedIds = new Set(userAchievements.map(a => a.achievementId))
  
  const categories = ['all', 'content', 'social', 'engagement', 'special']
  
  const filteredAchievements = achievements.filter(achievement => {
    if (selectedCategory === 'all') return true
    // Filter by category logic
    return true
  })

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'bg-gray-500'
      case 'uncommon': return 'bg-green-500'
      case 'rare': return 'bg-blue-500'
      case 'epic': return 'bg-purple-500'
      case 'legendary': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Achievements</h2>
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">
            {unlockedIds.size} / {achievements.length}
          </span>
        </div>
      </div>

      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList>
          {categories.map(category => (
            <TabsTrigger key={category} value={category}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={selectedCategory} className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAchievements.map(achievement => {
              const isUnlocked = unlockedIds.has(achievement.id)
              const userAchievement = userAchievements.find(
                ua => ua.achievementId === achievement.id
              )

              return (
                <Card
                  key={achievement.id}
                  className={cn(
                    'p-4 transition-all',
                    isUnlocked
                      ? 'bg-gradient-to-br from-sparkle-500/10 to-sparkle-700/10 border-sparkle-500/50'
                      : 'opacity-75'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'w-12 h-12 rounded-full flex items-center justify-center text-2xl',
                      isUnlocked ? 'bg-gradient-to-br from-sparkle-500 to-sparkle-700' : 'bg-muted'
                    )}>
                      {isUnlocked ? achievement.icon : <Lock className="w-5 h-5" />}
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{achievement.name}</h3>
                        <Badge 
                          variant="secondary" 
                          className={cn('text-xs', getRarityColor(achievement.rarity))}
                        >
                          {achievement.rarity}
                        </Badge>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-2">
                        {achievement.description}
                      </p>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-yellow-500" />
                          <span className="text-sm font-medium">{achievement.xp} XP</span>
                        </div>
                        
                        {isUnlocked && userAchievement && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(userAchievement.unlockedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

**Checklist**:
- [ ] Create achievement grid
- [ ] Show locked/unlocked state
- [ ] Add category filtering
- [ ] Display rarity
- [ ] Show unlock dates

---

## Phase 6: Admin Panel (Week 11-12)

### Goals & Objectives
- ✅ Build admin dashboard
- ✅ Create user management
- ✅ Add content moderation
- ✅ Implement analytics
- ✅ Add site settings

### Files to Complete

#### 1. `/src/app/admin/layout.tsx`
**Purpose**: Admin panel layout

**Dependencies**:
- Auth guards
- Admin navigation

**Exports**:
- Admin layout component

```typescript
// src/app/admin/layout.tsx
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/auth/auth'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { AdminHeader } from '@/components/admin/admin-header'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerAuth()
  
  // Check if user is admin
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar />
      <div className="flex-1 flex flex-col">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
```

**Checklist**:
- [ ] Add auth check
- [ ] Create layout structure
- [ ] Include sidebar
- [ ] Add header
- [ ] Handle permissions

#### 2. `/src/app/admin/dashboard/page.tsx`
**Purpose**: Admin dashboard overview

**Dependencies**:
- Analytics data
- Charts

**Exports**:
- Dashboard page component

```typescript
// src/app/admin/dashboard/page.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Users, 
  FileText, 
  MessageSquare, 
  TrendingUp,
  Activity,
  Eye,
  UserPlus,
  Heart
} from 'lucide-react'
import { api } from '@/lib/api'
import { AnalyticsChart } from '@/components/admin/analytics-chart'
import { RecentActivity } from '@/components/admin/recent-activity'
import { TopContent } from '@/components/admin/top-content'
import { formatNumber, formatPercentage } from '@/lib/utils'

export default function AdminDashboard() {
  const { data: stats } = api.admin.getDashboardStats.useQuery()
  const { data: analytics } = api.admin.getAnalytics.useQuery({ period: 'week' })

  const statCards = [
    {
      title: 'Total Users',
      value: stats?.totalUsers || 0,
      change: stats?.userGrowth || 0,
      icon: Users,
      color: 'text-blue-500',
    },
    {
      title: 'Total Posts',
      value: stats?.totalPosts || 0,
      change: stats?.postGrowth || 0,
      icon: FileText,
      color: 'text-green-500',
    },
    {
      title: 'Total Comments',
      value: stats?.totalComments || 0,
      change: stats?.commentGrowth || 0,
      icon: MessageSquare,
      color: 'text-purple-500',
    },
    {
      title: 'Active Users',
      value: stats?.activeUsers || 0,
      change: stats?.activeUserGrowth || 0,
      icon: Activity,
      color: 'text-orange-500',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here's what's happening on Sparkle Universe.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
