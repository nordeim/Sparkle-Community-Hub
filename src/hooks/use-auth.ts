// src/hooks/use-auth.ts
'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { UserRole } from '@prisma/client'

export function useAuth() {
  const { data: session, status, update } = useSession()
  const router = useRouter()

  const user = session?.user

  const isLoading = status === 'loading'
  const isAuthenticated = status === 'authenticated'
  const isUnauthenticated = status === 'unauthenticated'

  // Role checks
  const isAdmin = user?.role === 'ADMIN'
  const isModerator = user?.role === 'MODERATOR' || isAdmin
  const isVerified = user?.verified ?? false

  // Permission checks
  const hasRole = useCallback((role: UserRole | UserRole[]) => {
    if (!user) return false
    const roles = Array.isArray(role) ? role : [role]
    return roles.includes(user.role)
  }, [user])

  const canModerate = useCallback(() => {
    return hasRole(['MODERATOR', 'ADMIN'])
  }, [hasRole])

  const canAdmin = useCallback(() => {
    return hasRole('ADMIN')
  }, [hasRole])

  // Actions
  const login = useCallback(async (provider?: string) => {
    if (provider) {
      await signIn(provider, { callbackUrl: '/' })
    } else {
      router.push('/login')
    }
  }, [router])

  const logout = useCallback(async () => {
    await signOut({ callbackUrl: '/' })
  }, [])

  const updateSession = useCallback(async () => {
    await update()
  }, [update])

  // Memoized return value
  return useMemo(() => ({
    user,
    session,
    status,
    isLoading,
    isAuthenticated,
    isUnauthenticated,
    isAdmin,
    isModerator,
    isVerified,
    hasRole,
    canModerate,
    canAdmin,
    login,
    logout,
    update: updateSession,
  }), [
    user,
    session,
    status,
    isLoading,
    isAuthenticated,
    isUnauthenticated,
    isAdmin,
    isModerator,
    isVerified,
    hasRole,
    canModerate,
    canAdmin,
    login,
    logout,
    updateSession,
  ])
}
