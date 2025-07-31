// src/app/admin/layout.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getServerAuth } from '@/lib/auth/auth'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { AdminHeader } from '@/components/admin/admin-header'
import { AdminProvider } from '@/components/providers/admin-provider'
import { Toaster } from '@/components/ui/toaster'
import { monitoring } from '@/lib/monitoring'

export const metadata = {
  title: 'Admin Dashboard - Sparkle Universe',
  description: 'Admin panel for Sparkle Universe',
  robots: 'noindex, nofollow',
}

interface AdminLayoutProps {
  children: React.ReactNode
  params: { [key: string]: string | string[] | undefined }
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const session = await getServerAuth()
  
  // Check if user is admin or moderator
  if (!session?.user || !['ADMIN', 'MODERATOR'].includes(session.user.role)) {
    redirect('/')
  }

  // Track admin access
  monitoring.trackEvent('admin_access', {
    userId: session.user.id,
    role: session.user.role,
    path: headers().get('x-pathname') || '/admin',
  })

  return (
    <AdminProvider user={session.user}>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Sidebar */}
        <AdminSidebar role={session.user.role} />
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <AdminHeader user={session.user} />
          
          {/* Page Content */}
          <main className="flex-1 overflow-y-auto bg-muted/10">
            <div className="container mx-auto p-6 max-w-7xl">
              {children}
            </div>
          </main>
        </div>
        
        <Toaster />
      </div>
    </AdminProvider>
  )
}

// Force dynamic rendering for admin pages
export const dynamic = 'force-dynamic'
export const revalidate = 0
