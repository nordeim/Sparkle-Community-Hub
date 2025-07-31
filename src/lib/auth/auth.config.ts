// src/lib/auth/auth.config.ts
import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import DiscordProvider from 'next-auth/providers/discord'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { UserRole } from '@prisma/client'

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

// Extend default session types
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      username: string
      image?: string | null
      role: UserRole
      verified: boolean
      level: number
    }
  }

  interface User {
    id: string
    email: string
    username: string
    image?: string | null
    role: UserRole
    verified: boolean
    level: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    email: string
    username: string
    role: UserRole
    verified: boolean
    level: number
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as any,
  
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/auth/error',
    verifyRequest: '/auth/verify-request',
    newUser: '/onboarding',
  },

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),

    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'read:user user:email',
        },
      },
    }),

    ...(process.env.ENABLE_DISCORD_LOGIN === 'true' ? [
      DiscordProvider({
        clientId: process.env.DISCORD_CLIENT_ID!,
        clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      }),
    ] : []),

    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'email@example.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const validatedFields = loginSchema.parse(credentials)

          const user = await db.user.findUnique({
            where: { email: validatedFields.email },
            select: {
              id: true,
              email: true,
              username: true,
              hashedPassword: true,
              image: true,
              role: true,
              verified: true,
              level: true,
              banned: true,
              banExpiresAt: true,
            },
          })

          if (!user || !user.hashedPassword) {
            throw new Error('Invalid credentials')
          }

          // Check if user is banned
          if (user.banned) {
            if (user.banExpiresAt && user.banExpiresAt > new Date()) {
              throw new Error('Account temporarily banned')
            } else if (!user.banExpiresAt) {
              throw new Error('Account permanently banned')
            }
            // Ban has expired, unban the user
            await db.user.update({
              where: { id: user.id },
              data: { banned: false, banExpiresAt: null },
            })
          }

          const passwordValid = await bcrypt.compare(
            validatedFields.password,
            user.hashedPassword
          )

          if (!passwordValid) {
            throw new Error('Invalid credentials')
          }

          return {
            id: user.id,
            email: user.email,
            username: user.username,
            image: user.image,
            role: user.role,
            verified: user.verified,
            level: user.level,
          }
        } catch (error) {
          console.error('Auth error:', error)
          return null
        }
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false

      // Check if user is banned
      const dbUser = await db.user.findUnique({
        where: { email: user.email },
        select: { banned: true, banExpiresAt: true },
      })

      if (dbUser?.banned) {
        if (dbUser.banExpiresAt && dbUser.banExpiresAt > new Date()) {
          return false
        } else if (!dbUser.banExpiresAt) {
          return false
        }
      }

      // For OAuth providers, ensure username is set
      if (account?.provider !== 'credentials') {
        const existingUser = await db.user.findUnique({
          where: { email: user.email },
        })

        if (!existingUser) {
          // Generate username from email or profile
          let username = profile?.name?.toLowerCase().replace(/\s+/g, '') || 
                        user.email.split('@')[0]
          
          // Ensure username is unique
          let counter = 0
          let finalUsername = username
          while (await db.user.findUnique({ where: { username: finalUsername } })) {
            counter++
            finalUsername = `${username}${counter}`
          }

          await db.user.update({
            where: { email: user.email },
            data: { username: finalUsername },
          })
        }
      }

      return true
    },

    async session({ token, session }) {
      if (token) {
        session.user.id = token.id
        session.user.email = token.email
        session.user.username = token.username
        session.user.role = token.role
        session.user.verified = token.verified
        session.user.level = token.level
      }

      return session
    },

    async jwt({ token, user, trigger, session }) {
      // Initial sign in
      if (user) {
        token.id = user.id
        token.email = user.email
        token.username = user.username
        token.role = user.role
        token.verified = user.verified
        token.level = user.level
      }

      // Handle session updates
      if (trigger === 'update' && session) {
        token = { ...token, ...session }
      }

      // Refresh user data periodically
      if (trigger === 'update' || Date.now() - (token.iat || 0) * 1000 > 60 * 60 * 1000) {
        const dbUser = await db.user.findUnique({
          where: { id: token.id },
          select: {
            username: true,
            role: true,
            verified: true,
            level: true,
            banned: true,
          },
        })

        if (dbUser && !dbUser.banned) {
          token.username = dbUser.username
          token.role = dbUser.role
          token.verified = dbUser.verified
          token.level = dbUser.level
        }
      }

      return token
    },
  },

  events: {
    async signIn({ user, account, isNewUser }) {
      // Log sign in event
      await db.analyticsEvent.create({
        data: {
          eventName: 'user_signin',
          userId: user.id,
          properties: {
            provider: account?.provider,
            isNewUser,
          },
        },
      })

      // Award XP for daily login
      if (!isNewUser) {
        const lastLogin = await db.xPLog.findFirst({
          where: {
            userId: user.id,
            reason: 'Daily login',
            createdAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        })

        if (!lastLogin) {
          await db.xPLog.create({
            data: {
              userId: user.id,
              amount: 10,
              reason: 'Daily login',
            },
          })

          await db.user.update({
            where: { id: user.id },
            data: { experience: { increment: 10 } },
          })
        }
      }
    },

    async createUser({ user }) {
      // Send welcome email
      // TODO: Implement email service
      console.log('Send welcome email to:', user.email)

      // Create initial profile
      await db.profile.create({
        data: {
          userId: user.id,
          notificationSettings: {
            email: true,
            push: true,
            postLikes: true,
            comments: true,
            follows: true,
            achievements: true,
          },
          privacySettings: {
            profileVisibility: 'public',
            showEmail: false,
            showActivity: true,
          },
        },
      })

      // Award first-time achievement
      const firstTimeAchievement = await db.achievement.findUnique({
        where: { code: 'welcome' },
      })

      if (firstTimeAchievement) {
        await db.userAchievement.create({
          data: {
            userId: user.id,
            achievementId: firstTimeAchievement.id,
          },
        })

        await db.notification.create({
          data: {
            type: 'ACHIEVEMENT_UNLOCKED',
            userId: user.id,
            message: 'Welcome to Sparkle Universe! You earned your first achievement!',
            data: { achievementId: firstTimeAchievement.id },
          },
        })
      }
    },
  },

  debug: process.env.NODE_ENV === 'development',
}
