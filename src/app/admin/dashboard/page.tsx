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
