// src/lib/auth/auth.ts
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { authOptions } from './auth.config'
import { UserRole } from '@prisma/client'

// Cache the session for the duration of the request
export const getServerAuth = cache(async () => {
  const session = await getServerSession(authOptions)
  return session
})

// Get the current user or redirect to login
export async function requireAuth(redirectTo: string = '/login') {
  const session = await getServerAuth()
  
  if (!session?.user) {
    redirect(`${redirectTo}?callbackUrl=${encodeURIComponent(redirectTo)}`)
  }
  
  return session
}

// Check if user has required role
export async function requireRole(
  role: UserRole | UserRole[], 
  redirectTo: string = '/'
) {
  const session = await requireAuth()
  const roles = Array.isArray(role) ? role : [role]
  
  if (!roles.includes(session.user.role)) {
    redirect(redirectTo)
  }
  
  return session
}

// Check if user is admin
export async function requireAdmin() {
  return requireRole('ADMIN', '/')
}

// Check if user is moderator or admin
export async function requireModerator() {
  return requireRole(['MODERATOR', 'ADMIN'], '/')
}

// Get user without requiring auth
export async function getOptionalAuth() {
  try {
    const session = await getServerAuth()
    return session
  } catch {
    return null
  }
}

// Check if user can perform action on resource
export async function canModify(
  resourceOwnerId: string,
  allowRoles: UserRole[] = ['ADMIN', 'MODERATOR']
) {
  const session = await getServerAuth()
  
  if (!session?.user) return false
  
  // Owner can always modify
  if (session.user.id === resourceOwnerId) return true
  
  // Check if user has required role
  return allowRoles.includes(session.user.role)
}

// Server-side sign out
export async function signOutServer() {
  // Clear any server-side session data
  // This is handled by NextAuth, but you can add custom cleanup here
  redirect('/login')
}
