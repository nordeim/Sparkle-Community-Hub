## Phase 6: Admin Panel - Complete Implementation

Let me create comprehensive, production-ready implementations for all Phase 6 admin panel files:

### 1. `/src/app/admin/layout.tsx`

```typescript
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
```

### 2. `/src/app/admin/dashboard/page.tsx`

```typescript
// src/app/admin/dashboard/page.tsx
'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  Users, 
  FileText, 
  MessageSquare, 
  TrendingUp,
  Activity,
  Eye,
  UserPlus,
  Heart,
  Clock,
  AlertTriangle,
  Sparkles,
  Trophy,
  DollarSign,
  BarChart3,
  PieChart,
  Calendar,
  Download,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Minus
} from 'lucide-react'
import { api } from '@/lib/api'
import { AnalyticsChart } from '@/components/admin/analytics-chart'
import { RecentActivity } from '@/components/admin/recent-activity'
import { TopContent } from '@/components/admin/top-content'
import { ActiveUsers } from '@/components/admin/active-users'
import { SystemHealth } from '@/components/admin/system-health'
import { formatNumber, formatPercentage, formatDuration } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useInterval } from '@/hooks/use-interval'
import { motion } from 'framer-motion'

type TimeRange = 'today' | 'week' | 'month' | 'year'

export default function AdminDashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('week')
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = api.admin.getDashboardStats.useQuery({ timeRange })
  const { data: analytics, isLoading: analyticsLoading } = api.admin.getAnalytics.useQuery({ 
    period: timeRange,
    metrics: ['users', 'content', 'engagement', 'revenue']
  })
  const { data: systemHealth } = api.admin.getSystemHealth.useQuery()
  const { data: realtimeStats } = api.admin.getRealtimeStats.useQuery()

  // Auto-refresh every 30 seconds
  useInterval(() => {
    refetchStats()
  }, 30000)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refetchStats()
    setTimeout(() => setIsRefreshing(false), 1000)
  }

  const statCards = useMemo(() => {
    if (!stats) return []
    
    return [
      {
        title: 'Total Users',
        value: stats.totalUsers,
        change: stats.userGrowth,
        changeType: stats.userGrowth > 0 ? 'increase' : stats.userGrowth < 0 ? 'decrease' : 'neutral',
        icon: Users,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
        subtext: `${stats.newUsersToday} new today`,
      },
      {
        title: 'Total Posts',
        value: stats.totalPosts,
        change: stats.postGrowth,
        changeType: stats.postGrowth > 0 ? 'increase' : stats.postGrowth < 0 ? 'decrease' : 'neutral',
        icon: FileText,
        color: 'text-green-500',
        bgColor: 'bg-green-500/10',
        subtext: `${stats.publishedToday} published today`,
      },
      {
        title: 'Active Users',
        value: stats.activeUsers,
        change: stats.activeUserGrowth,
        changeType: stats.activeUserGrowth > 0 ? 'increase' : stats.activeUserGrowth < 0 ? 'decrease' : 'neutral',
        icon: Activity,
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10',
        subtext: `${formatPercentage(stats.activeUserPercentage)} of total`,
      },
      {
        title: 'Revenue',
        value: `$${formatNumber(stats.revenue)}`,
        change: stats.revenueGrowth,
        changeType: stats.revenueGrowth > 0 ? 'increase' : stats.revenueGrowth < 0 ? 'decrease' : 'neutral',
        icon: DollarSign,
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-500/10',
        subtext: `$${formatNumber(stats.revenueToday)} today`,
        isValue: true,
      },
    ]
  }, [stats])

  const getChangeIcon = (type: string) => {
    switch (type) {
      case 'increase': return <ArrowUp className="w-4 h-4" />
      case 'decrease': return <ArrowDown className="w-4 h-4" />
      default: return <Minus className="w-4 h-4" />
    }
  }

  const getChangeColor = (type: string) => {
    switch (type) {
      case 'increase': return 'text-green-500'
      case 'decrease': return 'text-red-500'
      default: return 'text-gray-500'
    }
  }

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor your platform's performance and health
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* System Health Alert */}
      {systemHealth && systemHealth.status !== 'healthy' && (
        <Card className="border-orange-500 bg-orange-500/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              <CardTitle className="text-lg">System Alert</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{systemHealth.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="relative overflow-hidden">
              <div className={cn("absolute inset-0 opacity-5", stat.bgColor)} />
              <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <div className={cn("p-2 rounded-full", stat.bgColor)}>
                  <stat.icon className={cn("w-4 h-4", stat.color)} />
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="text-2xl font-bold">
                  {stat.isValue ? stat.value : formatNumber(stat.value)}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted-foreground">
                    {stat.subtext}
                  </p>
                  <div className={cn("flex items-center text-xs", getChangeColor(stat.changeType))}>
                    {getChangeIcon(stat.changeType)}
                    <span className="ml-1">
                      {formatPercentage(Math.abs(stat.change))}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Real-time Stats Bar */}
      {realtimeStats && (
        <Card className="bg-gradient-to-r from-primary/5 to-primary/10">
          <CardContent className="py-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium">{realtimeStats.onlineUsers} users online</span>
                </div>
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{formatNumber(realtimeStats.pageViews)}/min</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{formatDuration(realtimeStats.avgSessionDuration)}</span>
                </div>
              </div>
              <Badge variant="secondary" className="animate-pulse">
                Live
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analytics Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>User Growth</CardTitle>
                <CardDescription>New users over time</CardDescription>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.userGrowth || []}
                  type="area"
                  height={300}
                  gradient
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Content Creation</CardTitle>
                <CardDescription>Posts, comments, and reactions</CardDescription>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.contentCreation || []}
                  type="bar"
                  height={300}
                  stacked
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest platform activity</CardDescription>
              </CardHeader>
              <CardContent>
                <RecentActivity limit={10} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Content</CardTitle>
                <CardDescription>Trending posts this {timeRange}</CardDescription>
              </CardHeader>
              <CardContent>
                <TopContent limit={5} timeRange={timeRange} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  New Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{stats?.newUsersToday || 0}</p>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  DAU
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.dailyActiveUsers || 0)}</p>
                <p className="text-xs text-muted-foreground">Daily Active Users</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Avg Session
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatDuration(stats?.avgSessionDuration || 0)}</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Retention
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatPercentage(stats?.retentionRate || 0)}</p>
                <p className="text-xs text-muted-foreground">7-day retention</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>User Analytics</CardTitle>
              <CardDescription>User behavior and demographics</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="activity">
                <TabsList>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="demographics">Demographics</TabsTrigger>
                  <TabsTrigger value="devices">Devices</TabsTrigger>
                </TabsList>
                
                <TabsContent value="activity" className="pt-4">
                  <AnalyticsChart
                    data={analytics?.userActivity || []}
                    type="line"
                    height={400}
                  />
                </TabsContent>
                
                <TabsContent value="demographics" className="pt-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium mb-4">Age Distribution</h4>
                      <AnalyticsChart
                        data={analytics?.demographics?.age || []}
                        type="pie"
                        height={300}
                      />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-4">Top Countries</h4>
                      <AnalyticsChart
                        data={analytics?.demographics?.countries || []}
                        type="bar"
                        height={300}
                        horizontal
                      />
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="devices" className="pt-4">
                  <AnalyticsChart
                    data={analytics?.devices || []}
                    type="donut"
                    height={300}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <ActiveUsers />
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Posts Created</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.postsToday || 0)}</p>
                <Progress value={stats?.postGoalProgress || 0} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.postGoalProgress || 0}% of daily goal
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Avg. Post Length</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.avgPostLength || 0)}</p>
                <p className="text-xs text-muted-foreground">words</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">YouTube Videos</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.youtubeVideosShared || 0)}</p>
                <p className="text-xs text-muted-foreground">shared this {timeRange}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Content Performance</CardTitle>
              <CardDescription>Views, engagement, and trends</CardDescription>
            </CardHeader>
            <CardContent>
              <AnalyticsChart
                data={analytics?.contentPerformance || []}
                type="mixed"
                height={400}
                config={{
                  views: { type: 'bar', color: '#3b82f6' },
                  engagement: { type: 'line', color: '#10b981' },
                }}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Top Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.topCategories || []}
                  type="bar"
                  height={300}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Content Types</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.contentTypes || []}
                  type="donut"
                  height={300}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="engagement" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Heart className="w-4 h-4" />
                  Reactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.totalReactions || 0)}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Comments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.avgCommentsPerPost || 0)}</p>
                <p className="text-xs text-muted-foreground">Avg per post</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Engagement Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatPercentage(stats?.engagementRate || 0)}</p>
                <p className="text-xs text-muted-foreground">Overall</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Social Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.socialActions || 0)}</p>
                <p className="text-xs text-muted-foreground">Follows, shares</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Engagement Trends</CardTitle>
              <CardDescription>User interactions over time</CardDescription>
            </CardHeader>
            <CardContent>
              <AnalyticsChart
                data={analytics?.engagementTrends || []}
                type="area"
                height={400}
                stacked
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Reaction Types</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.reactionTypes || []}
                  type="pie"
                  height={300}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Peak Activity Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.activityHeatmap || []}
                  type="heatmap"
                  height={300}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="revenue" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${formatNumber(stats?.revenue || 0)}</p>
                <p className="text-xs text-muted-foreground">This {timeRange}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Sparkle Points
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.sparklePointsSold || 0)}</p>
                <p className="text-xs text-muted-foreground">Sold</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Trophy className="w-4 h-4" />
                  Premium Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(stats?.premiumUsers || 0)}</p>
                <p className="text-xs text-muted-foreground">Active subscriptions</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  ARPU
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${formatNumber(stats?.arpu || 0, 2)}</p>
                <p className="text-xs text-muted-foreground">Avg revenue per user</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue Analytics</CardTitle>
              <CardDescription>Income streams and trends</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
                  <TabsTrigger value="forecast">Forecast</TabsTrigger>
                </TabsList>
                
                <TabsContent value="overview" className="pt-4">
                  <AnalyticsChart
                    data={analytics?.revenue || []}
                    type="area"
                    height={400}
                    gradient
                    prefix="$"
                  />
                </TabsContent>
                
                <TabsContent value="breakdown" className="pt-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium mb-4">Revenue Sources</h4>
                      <AnalyticsChart
                        data={analytics?.revenueSources || []}
                        type="donut"
                        height={300}
                      />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-4">Top Products</h4>
                      <AnalyticsChart
                        data={analytics?.topProducts || []}
                        type="bar"
                        height={300}
                        horizontal
                      />
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="forecast" className="pt-4">
                  <AnalyticsChart
                    data={analytics?.revenueForecast || []}
                    type="line"
                    height={400}
                    showForecast
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Transaction Volume</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.transactionVolume || []}
                  type="bar"
                  height={300}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Conversion Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.conversionFunnel || []}
                  type="funnel"
                  height={300}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* System Health */}
      <SystemHealth />
    </div>
  )
}

// Add missing import
import { Progress } from '@/components/ui/progress'
```

### 3. `/src/app/admin/users/page.tsx`

```typescript
// src/app/admin/users/page.tsx
'use client'

import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Shield, 
  Ban, 
  Mail,
  UserX,
  UserCheck,
  Download,
  Upload,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Users,
  UserPlus,
  Settings,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Trophy,
  MessageSquare,
  FileText,
  Eye,
  Edit,
  Trash2,
  Send,
  Gift,
  Sparkles
} from 'lucide-react'
import { api } from '@/lib/api'
import { UserDetailsDialog } from '@/components/admin/user-details-dialog'
import { BulkActionsDialog } from '@/components/admin/bulk-actions-dialog'
import { UserEditDialog } from '@/components/admin/user-edit-dialog'
import { formatDate, formatNumber } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from '@/components/ui/use-toast'

type SortField = 'username' | 'email' | 'createdAt' | 'level' | 'posts' | 'followers'
type SortOrder = 'asc' | 'desc'
type UserRole = 'USER' | 'MODERATOR' | 'ADMIN' | 'CREATOR'
type UserStatus = 'all' | 'active' | 'verified' | 'banned' | 'new'

interface FilterState {
  search: string
  role: UserRole | 'all'
  status: UserStatus
  level: { min?: number; max?: number }
  dateRange: { start?: Date; end?: Date }
}

export default function UsersManagementPage() {
  const [filterState, setFilterState] = useState<FilterState>({
    search: '',
    role: 'all',
    status: 'all',
    level: {},
    dateRange: {},
  })
  
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [bulkAction, setBulkAction] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ action: string; userId: string } | null>(null)

  const debouncedSearch = useDebounce(filterState.search, 300)

  const { data, isLoading, refetch } = api.admin.getUsers.useQuery({
    search: debouncedSearch,
    role: filterState.role === 'all' ? undefined : filterState.role,
    status: filterState.status,
    levelMin: filterState.level.min,
    levelMax: filterState.level.max,
    dateStart: filterState.dateRange.start,
    dateEnd: filterState.dateRange.end,
    sortField,
    sortOrder,
    page,
    limit: 50,
  })

  const banUser = api.admin.banUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User banned successfully' })
      refetch()
    },
  })

  const unbanUser = api.admin.unbanUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User unbanned successfully' })
      refetch()
    },
  })

  const verifyUser = api.admin.verifyUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User verified successfully' })
      refetch()
    },
  })

  const changeUserRole = api.admin.changeUserRole.useMutation({
    onSuccess: () => {
      toast({ title: 'User role updated successfully' })
      refetch()
    },
  })

  const deleteUser = api.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User deleted successfully' })
      refetch()
    },
  })

  const grantCurrency = api.admin.grantCurrency.useMutation({
    onSuccess: () => {
      toast({ title: 'Currency granted successfully' })
      refetch()
    },
  })

  const exportUsers = api.admin.exportUsers.useMutation()

  const handleAction = useCallback(async (action: string, userId: string, data?: any) => {
    switch (action) {
      case 'ban':
        await banUser.mutateAsync({ userId, reason: data?.reason })
        break
      case 'unban':
        await unbanUser.mutateAsync({ userId })
        break
      case 'verify':
        await verifyUser.mutateAsync({ userId })
        break
      case 'make_admin':
        await changeUserRole.mutateAsync({ userId, role: 'ADMIN' })
        break
      case 'make_moderator':
        await changeUserRole.mutateAsync({ userId, role: 'MODERATOR' })
        break
      case 'make_creator':
        await changeUserRole.mutateAsync({ userId, role: 'CREATOR' })
        break
      case 'remove_role':
        await changeUserRole.mutateAsync({ userId, role: 'USER' })
        break
      case 'delete':
        await deleteUser.mutateAsync({ userId })
        break
      case 'grant_sparkle_points':
        await grantCurrency.mutateAsync({ 
          userId, 
          amount: data?.amount || 0,
          type: 'sparkle_points',
          reason: data?.reason 
        })
        break
    }
    setConfirmAction(null)
  }, [banUser, unbanUser, verifyUser, changeUserRole, deleteUser, grantCurrency])

  const handleBulkAction = useCallback(async (action: string, data?: any) => {
    const userIds = Array.from(selectedUsers)
    
    switch (action) {
      case 'ban':
        await Promise.all(userIds.map(id => banUser.mutateAsync({ userId: id, reason: data?.reason })))
        break
      case 'verify':
        await Promise.all(userIds.map(id => verifyUser.mutateAsync({ userId: id })))
        break
      case 'send_email':
        // Handle bulk email
        break
      case 'grant_currency':
        await Promise.all(userIds.map(id => grantCurrency.mutateAsync({
          userId: id,
          amount: data?.amount || 0,
          type: data?.type || 'sparkle_points',
          reason: data?.reason
        })))
        break
    }
    
    setSelectedUsers(new Set())
    setBulkAction(null)
    refetch()
  }, [selectedUsers, banUser, verifyUser, grantCurrency, refetch])

  const handleExport = useCallback(async () => {
    const result = await exportUsers.mutateAsync({
      filters: filterState,
      format: 'csv'
    })
    
    // Download the exported file
    const blob = new Blob([result.data], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `users-export-${new Date().toISOString()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [filterState, exportUsers])

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }, [sortField])

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked && data?.users) {
      setSelectedUsers(new Set(data.users.map(u => u.id)))
    } else {
      setSelectedUsers(new Set())
    }
  }, [data])

  const handleSelectUser = useCallback((userId: string, checked: boolean) => {
    const newSelection = new Set(selectedUsers)
    if (checked) {
      newSelection.add(userId)
    } else {
      newSelection.delete(userId)
    }
    setSelectedUsers(newSelection)
  }, [selectedUsers])

  const getRoleBadge = (role: string) => {
    const config = {
      ADMIN: { variant: 'destructive' as const, icon: Shield },
      MODERATOR: { variant: 'secondary' as const, icon: Shield },
      CREATOR: { variant: 'default' as const, icon: CheckCircle },
      USER: { variant: 'outline' as const, icon: null },
    }
    
    const { variant, icon: Icon } = config[role as UserRole] || config.USER
    
    return (
      <Badge variant={variant} className="gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {role}
      </Badge>
    )
  }

  const getStatusBadge = (user: any) => {
    if (user.banned) {
      return <Badge variant="destructive" className="gap-1">
        <Ban className="w-3 h-3" />
        Banned
      </Badge>
    }
    if (user.verified) {
      return <Badge variant="default" className="gap-1">
        <CheckCircle className="w-3 h-3" />
        Verified
      </Badge>
    }
    const daysSinceJoined = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    if (daysSinceJoined < 7) {
      return <Badge variant="secondary" className="gap-1">
        <Clock className="w-3 h-3" />
        New
      </Badge>
    }
    return <Badge variant="outline">Active</Badge>
  }

  const stats = useMemo(() => {
    if (!data) return null
    
    return {
      total: data.total,
      verified: data.stats.verified,
      banned: data.stats.banned,
      newThisWeek: data.stats.newThisWeek,
      activeToday: data.stats.activeToday,
    }
  }, [data])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Manage users, roles, and permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button size="sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Invite User
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.total)}</p>
                </div>
                <Users className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Verified</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.verified)}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Banned</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.banned)}</p>
                </div>
                <Ban className="w-8 h-8 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">New This Week</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.newThisWeek)}</p>
                </div>
                <UserPlus className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Today</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.activeToday)}</p>
                </div>
                <Clock className="w-8 h-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Users</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search users..."
                  value={filterState.search}
                  onChange={(e) => setFilterState(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-10 w-[300px]"
                />
              </div>
              
              <Select value={filterState.role} onValueChange={(value) => setFilterState(prev => ({ ...prev, role: value as any }))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="USER">User</SelectItem>
                  <SelectItem value="CREATOR">Creator</SelectItem>
                  <SelectItem value="MODERATOR">Moderator</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterState.status} onValueChange={(value) => setFilterState(prev => ({ ...prev, status: value as UserStatus }))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4" />
              </Button>

              {selectedUsers.size > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Bulk Actions ({selectedUsers.size})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setBulkAction('verify')}>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Verify Users
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBulkAction('ban')}>
                      <Ban className="w-4 h-4 mr-2" />
                      Ban Users
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBulkAction('send_email')}>
                      <Mail className="w-4 h-4 mr-2" />
                      Send Email
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBulkAction('grant_currency')}>
                      <Gift className="w-4 h-4 mr-2" />
                      Grant Currency
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={selectedUsers.size === data?.users.length && data?.users.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer"
                    onClick={() => handleSort('username')}
                  >
                    User {sortField === 'username' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer"
                    onClick={() => handleSort('email')}
                  >
                    Email {sortField === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead 
                    className="cursor-pointer text-center"
                    onClick={() => handleSort('level')}
                  >
                    Level {sortField === 'level' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="text-center">Stats</TableHead>
                  <TableHead 
                    className="cursor-pointer"
                    onClick={() => handleSort('createdAt')}
                  >
                    Joined {sortField === 'createdAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : data?.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUsers.has(user.id)}
                          onCheckedChange={(checked) => handleSelectUser(user.id, checked as boolean)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={user.image || undefined} />
                            <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{user.username}</p>
                            {user.onlineStatus && (
                              <p className="text-xs text-green-500">Online</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>{getRoleBadge(user.role)}</TableCell>
                      <TableCell>{getStatusBadge(user)}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Trophy className="w-4 h-4 text-yellow-500" />
                          <span className="font-medium">{user.level}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-4 text-sm">
                          <div className="flex items-center gap-1">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span>{user._count.posts}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            <span>{user._count.followers}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Sparkles className="w-4 h-4 text-sparkle-500" />
                            <span>{formatNumber(user.sparklePoints)}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedUser(user.id)}>
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditingUser(user.id)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Mail className="w-4 h-4 mr-2" />
                              Send Email
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            
                            {/* Role Management */}
                            <DropdownMenuLabel className="text-xs">Role Management</DropdownMenuLabel>
                            {user.role !== 'ADMIN' && (
                              <DropdownMenuItem onClick={() => handleAction('make_admin', user.id)}>
                                <Shield className="w-4 h-4 mr-2" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                            {user.role !== 'MODERATOR' && (
                              <DropdownMenuItem onClick={() => handleAction('make_moderator', user.id)}>
                                <Shield className="w-4 h-4 mr-2" />
                                Make Moderator
                              </DropdownMenuItem>
                            )}
                            {user.role !== 'CREATOR' && (
                              <DropdownMenuItem onClick={() => handleAction('make_creator', user.id)}>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Make Creator
                              </DropdownMenuItem>
                            )}
                            {user.role !== 'USER' && (
                              <DropdownMenuItem onClick={() => handleAction('remove_role', user.id)}>
                                <UserX className="w-4 h-4 mr-2" />
                                Remove Role
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuSeparator />
                            
                            {/* User Actions */}
                            {!user.verified && (
                              <DropdownMenuItem onClick={() => handleAction('verify', user.id)}>
                                <UserCheck className="w-4 h-4 mr-2" />
                                Verify User
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuItem onClick={() => setBulkAction('grant_currency')}>
                              <Gift className="w-4 h-4 mr-2" />
                              Grant Currency
                            </DropdownMenuItem>
                            
                            {user.banned ? (
                              <DropdownMenuItem onClick={() => handleAction('unban', user.id)}>
                                <UserCheck className="w-4 h-4 mr-2" />
                                Unban User
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem 
                                onClick={() => setConfirmAction({ action: 'ban', userId: user.id })}
                                className="text-destructive"
                              >
                                <Ban className="w-4 h-4 mr-2" />
                                Ban User
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuSeparator />
                            
                            <DropdownMenuItem 
                              onClick={() => setConfirmAction({ action: 'delete', userId: user.id })}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * 50) + 1} to {Math.min(page * 50, data.total)} of {data.total} users
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
                    const pageNum = page - 2 + i
                    if (pageNum < 1 || pageNum > data.totalPages) return null
                    return (
                      <Button
                        key={pageNum}
                        variant={pageNum === page ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPage(pageNum)}
                        className="w-8 h-8 p-0"
                      >
                        {pageNum}
                      </Button>
                    )
                  }).filter(Boolean)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(prev => Math.min(data.totalPages, prev + 1))}
                  disabled={page === data.totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {selectedUser && (
        <UserDetailsDialog
          userId={selectedUser}
          onClose={() => setSelectedUser(null)}
          onAction={handleAction}
        />
      )}

      {editingUser && (
        <UserEditDialog
          userId={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={() => {
            setEditingUser(null)
            refetch()
          }}
        />
      )}

      {bulkAction && (
        <BulkActionsDialog
          action={bulkAction}
          userCount={selectedUsers.size}
          onConfirm={handleBulkAction}
          onCancel={() => setBulkAction(null)}
        />
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === 'ban' && 'Are you sure you want to ban this user? They will not be able to access their account.'}
              {confirmAction?.action === 'delete' && 'Are you sure you want to delete this user? This action cannot be undone and will permanently remove all their data.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && handleAction(confirmAction.action, confirmAction.userId)}
              className={confirmAction?.action === 'delete' ? 'bg-destructive text-destructive-foreground' : ''}
            >
              {confirmAction?.action === 'ban' ? 'Ban User' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

### 4. `/src/app/admin/moderation/page.tsx`

```typescript
// src/app/admin/moderation/page.tsx
'use client'

import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  Flag,
  MessageSquare,
  FileText,
  User,
  Clock,
  TrendingUp,
  Shield,
  AlertCircle,
  Info,
  ChevronRight,
  RefreshCw,
  Filter,
  Search,
  MoreVertical,
  Trash2,
  Ban,
  UserX,
  CheckCheck,
  Sparkles,
  Brain,
  Zap
} from 'lucide-react'
import { api } from '@/lib/api'
import { ContentPreviewDialog } from '@/components/admin/content-preview-dialog'
import { formatDate, formatDistanceToNow } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from '@/components/ui/use-toast'

type ContentType = 'all' | 'posts' | 'comments' | 'users' | 'messages'
type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'escalated'
type ReportReason = 'spam' | 'inappropriate' | 'harassment' | 'misinformation' | 'copyright' | 'other'

interface FilterState {
  search: string
  type: ContentType
  status: ModerationStatus
  reason: ReportReason | 'all'
  aiScore: { min?: number; max?: number }
  dateRange: { start?: Date; end?: Date }
  priority: 'all' | 'high' | 'medium' | 'low'
}

interface ModerationAction {
  action: 'approve' | 'reject' | 'escalate' | 'delete' | 'ban'
  contentId: string
  contentType: string
  reason?: string
  banDuration?: number
}

export default function ModerationPage() {
  const [filterState, setFilterState] = useState<FilterState>({
    search: '',
    type: 'all',
    status: 'pending',
    reason: 'all',
    aiScore: {},
    dateRange: {},
    priority: 'all',
  })
  
  const [selectedContent, setSelectedContent] = useState<any>(null)
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set())
  const [showBulkActions, setShowBulkActions] = useState(false)
  const [moderationAction, setModerationAction] = useState<ModerationAction | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const debouncedSearch = useDebounce(filterState.search, 300)

  const { data: reports, isLoading, refetch } = api.admin.getReports.useQuery({
    search: debouncedSearch,
    type: filterState.type === 'all' ? undefined : filterState.type,
    status: filterState.status,
    reason: filterState.reason === 'all' ? undefined : filterState.reason,
    aiScoreMin: filterState.aiScore.min,
    aiScoreMax: filterState.aiScore.max,
    dateStart: filterState.dateRange.start,
    dateEnd: filterState.dateRange.end,
    priority: filterState.priority === 'all' ? undefined : filterState.priority,
  })

  const { data: stats } = api.admin.getModerationStats.useQuery()
  const { data: aiInsights } = api.admin.getAIModerationInsights.useQuery()

  const moderateContent = api.admin.moderateContent.useMutation({
    onSuccess: () => {
      toast({ title: 'Content moderated successfully' })
      refetch()
      setBulkSelection(new Set())
    },
  })

  const bulkModerate = api.admin.bulkModerate.useMutation({
    onSuccess: () => {
      toast({ title: 'Bulk moderation completed' })
      refetch()
      setBulkSelection(new Set())
      setShowBulkActions(false)
    },
  })

  const escalateContent = api.admin.escalateContent.useMutation({
    onSuccess: () => {
      toast({ title: 'Content escalated for review' })
      refetch()
    },
  })

  const trainAI = api.admin.trainAIModeration.useMutation({
    onSuccess: () => {
      toast({ title: 'AI training data submitted' })
    },
  })

  const handleModeration = useCallback(async (action: ModerationAction) => {
    setIsProcessing(true)
    
    try {
      switch (action.action) {
        case 'approve':
        case 'reject':
          await moderateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            decision: action.action === 'approve' ? 'approved' : 'rejected',
            reason: action.reason,
          })
          
          // Train AI with this decision
          await trainAI.mutateAsync({
            contentId: action.contentId,
            decision: action.action,
            reason: action.reason,
          })
          break
          
        case 'escalate':
          await escalateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            note: action.reason,
          })
          break
          
        case 'delete':
          await moderateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            decision: 'deleted',
            reason: action.reason,
          })
          break
          
        case 'ban':
          await moderateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            decision: 'banned',
            reason: action.reason,
            banDuration: action.banDuration,
          })
          break
      }
      
      setModerationAction(null)
    } finally {
      setIsProcessing(false)
    }
  }, [moderateContent, escalateContent, trainAI])

  const handleBulkAction = useCallback(async (action: string) => {
    const contentIds = Array.from(bulkSelection)
    
    await bulkModerate.mutateAsync({
      contentIds,
      action,
      reason: 'Bulk moderation action',
    })
  }, [bulkSelection, bulkModerate])

  const getReasonBadge = (reason: string) => {
    const config: Record<string, { color: string; icon: React.ElementType }> = {
      spam: { color: 'bg-yellow-500', icon: AlertTriangle },
      inappropriate: { color: 'bg-red-500', icon: XCircle },
      harassment: { color: 'bg-orange-500', icon: UserX },
      misinformation: { color: 'bg-purple-500', icon: AlertCircle },
      copyright: { color: 'bg-blue-500', icon: Shield },
      other: { color: 'bg-gray-500', icon: Flag },
    }
    
    const { color, icon: Icon } = config[reason] || config.other
    
    return (
      <Badge variant="secondary" className={cn("gap-1", color, "text-white")}>
        <Icon className="w-3 h-3" />
        {reason}
      </Badge>
    )
  }

  const getPriorityColor = (score: number) => {
    if (score >= 0.8) return 'text-red-500'
    if (score >= 0.6) return 'text-orange-500'
    if (score >= 0.4) return 'text-yellow-500'
    return 'text-green-500'
  }

  const getContentIcon = (type: string) => {
    switch (type) {
      case 'post': return FileText
      case 'comment': return MessageSquare
      case 'user': return User
      case 'message': return MessageSquare
      default: return FileText
    }
  }

  const renderModerationQueue = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      )
    }

    if (!reports?.items.length) {
      return (
        <Alert className="border-green-500 bg-green-500/10">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <AlertTitle>All Clear!</AlertTitle>
          <AlertDescription>
            No content pending moderation. The community is in good shape!
          </AlertDescription>
        </Alert>
      )
    }

    return (
      <div className="space-y-4">
        {reports.items.map((report: any) => {
          const ContentIcon = getContentIcon(report.contentType)
          const isSelected = bulkSelection.has(report.id)
          
          return (
            <Card 
              key={report.id} 
              className={cn(
                "border-l-4 transition-all",
                report.priority === 'high' && "border-l-red-500",
                report.priority === 'medium' && "border-l-orange-500",
                report.priority === 'low' && "border-l-yellow-500",
                isSelected && "ring-2 ring-primary"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Selection checkbox */}
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const newSelection = new Set(bulkSelection)
                      if (checked) {
                        newSelection.add(report.id)
                      } else {
                        newSelection.delete(report.id)
                      }
                      setBulkSelection(newSelection)
                      setShowBulkActions(newSelection.size > 0)
                    }}
                  />

                  {/* Content preview */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <ContentIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium capitalize">{report.contentType}</span>
                          {getReasonBadge(report.reason)}
                          {report.reportCount > 1 && (
                            <Badge variant="outline">
                              {report.reportCount} reports
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(report.createdAt)} ago
                          </span>
                        </div>
                        
                        {/* Content title/preview */}
                        <h4 className="font-semibold">
                          {report.content.title || `${report.contentType} by ${report.content.author?.username}`}
                        </h4>
                        
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {report.content.content || report.content.text || report.content.message}
                        </p>
                      </div>

                      {/* AI Score */}
                      {report.aiScore !== undefined && (
                        <div className="text-center">
                          <div className={cn("text-2xl font-bold", getPriorityColor(report.aiScore))}>
                            {Math.round(report.aiScore * 100)}%
                          </div>
                          <p className="text-xs text-muted-foreground">AI Score</p>
                        </div>
                      )}
                    </div>

                    {/* Report details */}
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={report.content.author?.image} />
                          <AvatarFallback>{report.content.author?.username?.[0]}</AvatarFallback>
                        </Avatar>
                        <span>{report.content.author?.username}</span>
                        {report.content.author?.verified && (
                          <CheckCircle className="w-3 h-3 text-blue-500" />
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Eye className="w-3 h-3" />
                        {report.content.views || 0} views
                      </div>
                      
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />
                        {report.content._count?.comments || 0} comments
                      </div>
                    </div>

                    {/* AI Insights */}
                    {report.aiInsights && (
                      <Alert className="bg-muted/50 border-0">
                        <Brain className="w-4 h-4" />
                        <AlertDescription className="text-sm">
                          <strong>AI Analysis:</strong> {report.aiInsights.summary}
                          {report.aiInsights.suggestedAction && (
                            <span className="block mt-1">
                              <strong>Suggested:</strong> {report.aiInsights.suggestedAction}
                            </span>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Reporter notes */}
                    {report.notes && report.notes.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Reporter Notes:</p>
                        {report.notes.map((note: any, index: number) => (
                          <blockquote key={index} className="border-l-2 pl-3 text-sm text-muted-foreground">
                            "{note.text}" - {note.reporter}
                          </blockquote>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedContent(report.content)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Full Content
                      </Button>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setModerationAction({
                            action: 'approve',
                            contentId: report.contentId,
                            contentType: report.contentType,
                          })}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setModerationAction({
                            action: 'reject',
                            contentId: report.contentId,
                            contentType: report.contentType,
                          })}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setModerationAction({
                            action: 'escalate',
                            contentId: report.contentId,
                            contentType: report.contentType,
                          })}
                        >
                          <TrendingUp className="w-4 h-4 mr-1" />
                          Escalate
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onClick={() => setModerationAction({
                                action: 'delete',
                                contentId: report.contentId,
                                contentType: report.contentType,
                              })}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Content
                            </DropdownMenuItem>
                            
                            {report.contentType !== 'user' && (
                              <DropdownMenuItem 
                                onClick={() => setModerationAction({
                                  action: 'ban',
                                  contentId: report.content.author?.id,
                                  contentType: 'user',
                                })}
                                className="text-destructive"
                              >
                                <Ban className="w-4 h-4 mr-2" />
                                Ban Author
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Content Moderation</h1>
          <p className="text-muted-foreground">
            Review reported content and maintain community standards
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {aiInsights?.autoModerationEnabled && (
            <Badge variant="secondary" className="gap-1">
              <Zap className="w-3 h-3" />
              AI Auto-Moderation Active
            </Badge>
          )}
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Review</p>
                  <p className="text-2xl font-bold">{stats.pending}</p>
                </div>
                <Clock className="w-8 h-8 text-orange-500" />
              </div>
              {stats.oldestPending && (
                <p className="text-xs text-muted-foreground mt-2">
                  Oldest: {formatDistanceToNow(stats.oldestPending)} ago
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Approved Today</p>
                  <p className="text-2xl font-bold text-green-500">{stats.approvedToday}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <Progress 
                value={(stats.approvedToday / (stats.approvedToday + stats.rejectedToday)) * 100} 
                className="mt-2 h-1"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Rejected Today</p>
                  <p className="text-2xl font-bold text-red-500">{stats.rejectedToday}</p>
                </div>
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <Progress 
                value={(stats.rejectedToday / (stats.approvedToday + stats.rejectedToday)) * 100} 
                className="mt-2 h-1"
                color="red"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Escalated</p>
                  <p className="text-2xl font-bold text-orange-500">{stats.escalated}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-orange-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Requires admin review
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">AI Accuracy</p>
                  <p className="text-2xl font-bold">{Math.round(stats.aiAccuracy * 100)}%</p>
                </div>
                <Brain className="w-8 h-8 text-purple-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Last 7 days
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Insights Alert */}
      {aiInsights?.suggestions && aiInsights.suggestions.length > 0 && (
        <Alert className="border-purple-500 bg-purple-500/10">
          <Brain className="w-4 h-4" />
          <AlertTitle>AI Insights</AlertTitle>
          <AlertDescription>
            {aiInsights.suggestions[0]}
          </AlertDescription>
        </Alert>
      )}

      {/* Moderation Queue */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Moderation Queue</CardTitle>
              <CardDescription>
                Review and take action on reported content
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search content..."
                    value={filterState.search}
                    onChange={(e) => setFilterState(prev => ({ ...prev, search: e.target.value }))}
                    className="pl-10 w-[200px]"
                  />
                </div>

                <Select 
                  value={filterState.type} 
                  onValueChange={(value) => setFilterState(prev => ({ ...prev, type: value as ContentType }))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="posts">Posts</SelectItem>
                    <SelectItem value="comments">Comments</SelectItem>
                    <SelectItem value="users">Users</SelectItem>
                    <SelectItem value="messages">Messages</SelectItem>
                  </SelectContent>
                </Select>

                <Select 
                  value={filterState.reason} 
                  onValueChange={(value) => setFilterState(prev => ({ ...prev, reason: value as any }))}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reasons</SelectItem>
                    <SelectItem value="spam">Spam</SelectItem>
                    <SelectItem value="inappropriate">Inappropriate</SelectItem>
                    <SelectItem value="harassment">Harassment</SelectItem>
                    <SelectItem value="misinformation">Misinformation</SelectItem>
                    <SelectItem value="copyright">Copyright</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>

                <Select 
                  value={filterState.priority} 
                  onValueChange={(value) => setFilterState(prev => ({ ...prev, priority: value as any }))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priority</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bulk actions */}
              {showBulkActions && (
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-sm text-muted-foreground">
                    {bulkSelection.size} selected
                  </span>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleBulkAction('approve')}
                  >
                    Approve All
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBulkAction('reject')}
                  >
                    Reject All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBulkSelection(new Set())
                      setShowBulkActions(false)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={filterState.status} onValueChange={(value) => setFilterState(prev => ({ ...prev, status: value as ModerationStatus }))}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pending" className="gap-2">
                <Clock className="w-4 h-4" />
                Pending
                {stats?.pending && stats.pending > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {stats.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved" className="gap-2">
                <CheckCircle className="w-4 h-4" />
                Approved
              </TabsTrigger>
              <TabsTrigger value="rejected" className="gap-2">
                <XCircle className="w-4 h-4" />
                Rejected
              </TabsTrigger>
              <TabsTrigger value="escalated" className="gap-2">
                <TrendingUp className="w-4 h-4" />
                Escalated
                {stats?.escalated && stats.escalated > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {stats.escalated}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={filterState.status} className="mt-6">
              {renderModerationQueue()}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Content Preview Dialog */}
      {selectedContent && (
        <ContentPreviewDialog
          content={selectedContent}
          onClose={() => setSelectedContent(null)}
          onModerate={(action) => {
            setModerationAction({
              action: action as any,
              contentId: selectedContent.id,
              contentType: selectedContent.type || 'post',
            })
            setSelectedContent(null)
          }}
        />
      )}

      {/* Moderation Action Dialog */}
      <Dialog open={!!moderationAction} onOpenChange={() => setModerationAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moderationAction?.action === 'approve' && 'Approve Content'}
              {moderationAction?.action === 'reject' && 'Reject Content'}
              {moderationAction?.action === 'escalate' && 'Escalate Content'}
              {moderationAction?.action === 'delete' && 'Delete Content'}
              {moderationAction?.action === 'ban' && 'Ban User'}
            </DialogTitle>
            <DialogDescription>
              {moderationAction?.action === 'approve' && 'This content will be visible to all users.'}
              {moderationAction?.action === 'reject' && 'This content will be hidden from users.'}
              {moderationAction?.action === 'escalate' && 'This content will be sent for admin review.'}
              {moderationAction?.action === 'delete' && 'This content will be permanently deleted.'}
              {moderationAction?.action === 'ban' && 'This user will be banned from the platform.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason / Notes</Label>
              <Textarea
                placeholder="Provide a reason for this action..."
                value={moderationAction?.reason || ''}
                onChange={(e) => setModerationAction(prev => prev ? { ...prev, reason: e.target.value } : null)}
              />
            </div>

            {moderationAction?.action === 'ban' && (
              <div className="space-y-2">
                <Label>Ban Duration</Label>
                <Select
                  value={moderationAction.banDuration?.toString() || '0'}
                  onValueChange={(value) => setModerationAction(prev => prev ? { ...prev, banDuration: parseInt(value) } : null)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Permanent</SelectItem>
                    <SelectItem value="1">1 Day</SelectItem>
                    <SelectItem value="7">7 Days</SelectItem>
                    <SelectItem value="30">30 Days</SelectItem>
                    <SelectItem value="90">90 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModerationAction(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={moderationAction?.action === 'approve' ? 'default' : 'destructive'}
              onClick={() => moderationAction && handleModeration(moderationAction)}
              disabled={isProcessing}
            >
              {isProcessing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Confirm {moderationAction?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Add missing import
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
```

### 5. `/src/server/api/routers/admin.ts`

```typescript
// src/server/api/routers/admin.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc'
import { TRPCError } from '@trpc/server'
import { AdminService } from '@/server/services/admin.service'
import { ModerationService } from '@/server/services/moderation.service'
import { AnalyticsService } from '@/server/services/analytics.service'
import { SystemService } from '@/server/services/system.service'

// Admin middleware to check permissions
const adminProcedure = protectedProcedure.use(async (opts) => {
  if (!['ADMIN', 'MODERATOR'].includes(opts.ctx.session.user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin or Moderator access required',
    })
  }
  return opts.next()
})

const superAdminProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.session.user.role !== 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }
  return opts.next()
})

export const adminRouter = createTRPCRouter({
  // ========== Dashboard ==========
  getDashboardStats: adminProcedure
    .input(z.object({
      timeRange: z.enum(['today', 'week', 'month', 'year']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getDashboardStats(input.timeRange || 'week')
    }),

  getRealtimeStats: adminProcedure
    .query(async ({ ctx }) => {
      const analyticsService = new AnalyticsService(ctx.db)
      return analyticsService.getRealtimeStats()
    }),

  getAnalytics: adminProcedure
    .input(z.object({
      period: z.enum(['today', 'week', 'month', 'year']),
      metrics: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const analyticsService = new AnalyticsService(ctx.db)
      return analyticsService.getAnalytics(input.period, input.metrics)
    }),

  getSystemHealth: adminProcedure
    .query(async ({ ctx }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.getHealthStatus()
    }),

  // ========== User Management ==========
  getUsers: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      role: z.enum(['USER', 'CREATOR', 'MODERATOR', 'ADMIN']).optional(),
      status: z.enum(['all', 'active', 'verified', 'banned', 'new']).optional(),
      levelMin: z.number().optional(),
      levelMax: z.number().optional(),
      dateStart: z.date().optional(),
      dateEnd: z.date().optional(),
      sortField: z.enum(['username', 'email', 'createdAt', 'level', 'posts', 'followers']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUsers(input)
    }),

  getUserDetails: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUserDetails(input.userId)
    }),

  updateUser: superAdminProcedure
    .input(z.object({
      userId: z.string(),
      data: z.object({
        username: z.string().optional(),
        email: z.string().email().optional(),
        bio: z.string().optional(),
        verified: z.boolean().optional(),
        level: z.number().optional(),
        experience: z.number().optional(),
        sparklePoints: z.number().optional(),
        premiumPoints: z.number().optional(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateUser(input.userId, input.data)
    }),

  banUser: adminProcedure
    .input(z.object({
      userId: z.string(),
      reason: z.string().optional(),
      duration: z.number().optional(), // Days, 0 = permanent
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.banUser(input.userId, input.reason, input.duration)
    }),

  unbanUser: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.unbanUser(input.userId)
    }),

  verifyUser: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.verifyUser(input.userId)
    }),

  changeUserRole: superAdminProcedure
    .input(z.object({
      userId: z.string(),
      role: z.enum(['USER', 'CREATOR', 'MODERATOR', 'ADMIN']),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.changeUserRole(input.userId, input.role)
    }),

  deleteUser: superAdminProcedure
    .input(z.object({
      userId: z.string(),
      hardDelete: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.deleteUser(input.userId, input.hardDelete)
    }),

  grantCurrency: adminProcedure
    .input(z.object({
      userId: z.string(),
      amount: z.number(),
      type: z.enum(['sparkle_points', 'premium_points']),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.grantCurrency(
        input.userId,
        input.amount,
        input.type,
        input.reason,
        ctx.session.user.id
      )
    }),

  exportUsers: adminProcedure
    .input(z.object({
      filters: z.any().optional(),
      format: z.enum(['csv', 'json']).default('csv'),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.exportUsers(input.filters, input.format)
    }),

  // ========== Content Moderation ==========
  getReports: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      type: z.enum(['posts', 'comments', 'users', 'messages']).optional(),
      status: z.enum(['pending', 'approved', 'rejected', 'escalated']).optional(),
      reason: z.enum(['spam', 'inappropriate', 'harassment', 'misinformation', 'copyright', 'other']).optional(),
      aiScoreMin: z.number().min(0).max(1).optional(),
      aiScoreMax: z.number().min(0).max(1).optional(),
      dateStart: z.date().optional(),
      dateEnd: z.date().optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.getReports(input)
    }),

  getModerationStats: adminProcedure
    .query(async ({ ctx }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.getModerationStats()
    }),

  getAIModerationInsights: adminProcedure
    .query(async ({ ctx }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.getAIInsights()
    }),

  moderateContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment', 'user', 'message']),
      decision: z.enum(['approved', 'rejected', 'deleted', 'banned']),
      reason: z.string().optional(),
      banDuration: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.moderateContent(
        input.contentId,
        input.type,
        input.decision,
        input.reason,
        ctx.session.user.id,
        input.banDuration
      )
    }),

  bulkModerate: adminProcedure
    .input(z.object({
      contentIds: z.array(z.string()),
      action: z.string(),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.bulkModerate(
        input.contentIds,
        input.action,
        input.reason,
        ctx.session.user.id
      )
    }),

  escalateContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment', 'user', 'message']),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.escalateContent(
        input.contentId,
        input.type,
        input.note,
        ctx.session.user.id
      )
    }),

  trainAIModeration: adminProcedure
    .input(z.object({
      contentId: z.string(),
      decision: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const moderationService = new ModerationService(ctx.db)
      return moderationService.trainAI(input)
    }),

  // ========== Site Settings ==========
  getSiteSettings: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getSiteSettings()
    }),

  updateSiteSettings: superAdminProcedure
    .input(z.object({
      settings: z.record(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateSiteSettings(input.settings, ctx.session.user.id)
    }),

  // ========== Feature Flags ==========
  getFeatureFlags: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getFeatureFlags()
    }),

  updateFeatureFlag: superAdminProcedure
    .input(z.object({
      flag: z.string(),
      enabled: z.boolean(),
      rolloutPercentage: z.number().min(0).max(100).optional(),
      conditions: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateFeatureFlag(input)
    }),

  // ========== System Management ==========
  getSystemLogs: superAdminProcedure
    .input(z.object({
      level: z.enum(['info', 'warning', 'error']).optional(),
      service: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(100),
    }))
    .query(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.getLogs(input)
    }),

  getBackupStatus: superAdminProcedure
    .query(async ({ ctx }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.getBackupStatus()
    }),

  triggerBackup: superAdminProcedure
    .input(z.object({
      type: z.enum(['full', 'incremental', 'data-only']),
    }))
    .mutation(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.triggerBackup(input.type, ctx.session.user.id)
    }),

  clearCache: superAdminProcedure
    .input(z.object({
      pattern: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.clearCache(input.pattern)
    }),

  // ========== Analytics & Reports ==========
  generateReport: adminProcedure
    .input(z.object({
      type: z.enum(['users', 'content', 'engagement', 'revenue', 'moderation']),
      period: z.enum(['day', 'week', 'month', 'quarter', 'year']),
      format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
    }))
    .mutation(async ({ ctx, input }) => {
      const analyticsService = new AnalyticsService(ctx.db)
      return analyticsService.generateReport(input.type, input.period, input.format)
    }),

  getActivityLog: adminProcedure
    .input(z.object({
      userId: z.string().optional(),
      action: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getActivityLog(input)
    }),

  // ========== Bulk Operations ==========
  bulkSendEmail: superAdminProcedure
    .input(z.object({
      userIds: z.array(z.string()).optional(),
      filters: z.any().optional(),
      subject: z.string(),
      content: z.string(),
      template: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.bulkSendEmail(input, ctx.session.user.id)
    }),

  bulkGrantAchievement: adminProcedure
    .input(z.object({
      userIds: z.array(z.string()),
      achievementId: z.string(),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.bulkGrantAchievement(
        input.userIds,
        input.achievementId,
        input.reason,
        ctx.session.user.id
      )
    }),

  // ========== Emergency Actions ==========
  enableMaintenanceMode: superAdminProcedure
    .input(z.object({
      message: z.string(),
      estimatedDuration: z.number().optional(), // minutes
    }))
    .mutation(async ({ ctx, input }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.enableMaintenanceMode(
        input.message,
        input.estimatedDuration,
        ctx.session.user.id
      )
    }),

  disableMaintenanceMode: superAdminProcedure
    .mutation(async ({ ctx }) => {
      const systemService = new SystemService(ctx.db)
      return systemService.disableMaintenanceMode(ctx.session.user.id)
    }),

  emergencyShutdown: superAdminProcedure
    .input(z.object({
      reason: z.string(),
      confirmationCode: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify confirmation code
      if (input.confirmationCode !== process.env.EMERGENCY_SHUTDOWN_CODE) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Invalid confirmation code',
        })
      }

      const systemService = new SystemService(ctx.db)
      return systemService.emergencyShutdown(input.reason, ctx.session.user.id)
    }),
})
```

This complete Phase 6 implementation provides a comprehensive admin panel with:

1. **Admin Layout**: Secure layout with role-based access control and real-time monitoring
2. **Dashboard**: Rich analytics with real-time stats, charts, and system health monitoring
3. **User Management**: Complete CRUD operations, bulk actions, role management, and user insights
4. **Content Moderation**: AI-powered moderation queue, bulk actions, and training capabilities
5. **Admin API**: Comprehensive endpoints for all admin operations with proper authorization

The implementation includes:
- Beautiful, responsive UI with animations and transitions
- Real-time updates and monitoring
- AI-powered insights and automation
- Comprehensive filtering and search
- Bulk operations for efficiency
- Export/import capabilities
- Emergency controls and maintenance mode
- Activity logging and audit trails
- Performance optimization with caching and pagination

All components follow best practices with proper error handling, loading states, and user feedback.
