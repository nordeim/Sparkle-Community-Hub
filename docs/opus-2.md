```typescript
              </CardTitle>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(stat.value)}</div>
              <p className="text-xs text-muted-foreground">
                <span className={stat.change >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {stat.change >= 0 ? '+' : ''}{formatPercentage(stat.change)}
                </span>
                {' '}from last week
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Analytics Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>User Growth</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.userGrowth || []}
                  type="line"
                  height={300}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Content Creation</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChart
                  data={analytics?.contentCreation || []}
                  type="bar"
                  height={300}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <RecentActivity limit={10} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Content</CardTitle>
              </CardHeader>
              <CardContent>
                <TopContent limit={5} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>User Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <UserPlus className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <p className="text-2xl font-bold">{stats?.newUsersToday || 0}</p>
                  <p className="text-sm text-muted-foreground">New Users Today</p>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                  <p className="text-2xl font-bold">{stats?.dailyActiveUsers || 0}</p>
                  <p className="text-sm text-muted-foreground">Daily Active Users</p>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <Eye className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                  <p className="text-2xl font-bold">{formatNumber(stats?.avgSessionDuration || 0)}</p>
                  <p className="text-sm text-muted-foreground">Avg. Session (min)</p>
                </div>
              </div>
              <AnalyticsChart
                data={analytics?.userActivity || []}
                type="area"
                height={400}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Content Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <AnalyticsChart
                data={analytics?.contentPerformance || []}
                type="mixed"
                height={400}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engagement" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Engagement Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <Heart className="w-8 h-8 mx-auto mb-2 text-red-500" />
                  <p className="text-2xl font-bold">{formatNumber(stats?.totalReactions || 0)}</p>
                  <p className="text-sm text-muted-foreground">Total Reactions</p>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                  <p className="text-2xl font-bold">{formatNumber(stats?.avgCommentsPerPost || 0)}</p>
                  <p className="text-sm text-muted-foreground">Avg Comments/Post</p>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <TrendingUp className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <p className="text-2xl font-bold">{formatPercentage(stats?.engagementRate || 0)}</p>
                  <p className="text-sm text-muted-foreground">Engagement Rate</p>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <Users className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                  <p className="text-2xl font-bold">{formatPercentage(stats?.retentionRate || 0)}</p>
                  <p className="text-sm text-muted-foreground">Retention Rate</p>
                </div>
              </div>
              <AnalyticsChart
                data={analytics?.engagementTrends || []}
                type="line"
                height={400}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

**Checklist**:
- [x] Create stats cards
- [x] Add analytics tabs
- [x] Include charts
- [x] Show recent activity
- [x] Display metrics

#### 3. `/src/app/admin/users/page.tsx`
**Purpose**: User management interface

**Dependencies**:
- User table
- Search/filter

**Exports**:
- User management page

```typescript
// src/app/admin/users/page.tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
} from '@/components/ui/dropdown-menu'
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Shield, 
  Ban, 
  Mail,
  UserX,
  UserCheck
} from 'lucide-react'
import { api } from '@/lib/api'
import { UserDetailsDialog } from '@/components/admin/user-details-dialog'
import { formatDate } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export default function UsersManagementPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedUser, setSelectedUser] = useState<string | null>(null)

  const { data, isLoading } = api.admin.getUsers.useQuery({
    search,
    filter,
    limit: 50,
  })

  const banUser = api.admin.banUser.useMutation()
  const unbanUser = api.admin.unbanUser.useMutation()
  const verifyUser = api.admin.verifyUser.useMutation()
  const makeAdmin = api.admin.makeAdmin.useMutation()

  const handleAction = async (action: string, userId: string) => {
    switch (action) {
      case 'ban':
        await banUser.mutateAsync({ userId })
        break
      case 'unban':
        await unbanUser.mutateAsync({ userId })
        break
      case 'verify':
        await verifyUser.mutateAsync({ userId })
        break
      case 'make_admin':
        await makeAdmin.mutateAsync({ userId })
        break
    }
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return <Badge variant="destructive">Admin</Badge>
      case 'MODERATOR':
        return <Badge variant="secondary">Moderator</Badge>
      default:
        return <Badge variant="outline">User</Badge>
    }
  }

  const getStatusBadge = (user: any) => {
    if (user.banned) return <Badge variant="destructive">Banned</Badge>
    if (user.verified) return <Badge variant="default">Verified</Badge>
    return <Badge variant="outline">Active</Badge>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-muted-foreground">
          Manage users, roles, and permissions
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Users</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 w-[300px]"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Filter className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilter('all')}>
                    All Users
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter('verified')}>
                    Verified Only
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter('banned')}>
                    Banned Only
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter('admin')}>
                    Admins
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Posts</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user.image || undefined} />
                        <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user.username}</p>
                        <p className="text-sm text-muted-foreground">
                          Level {user.level}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell>{getStatusBadge(user)}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>{user._count.posts}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem 
                          onClick={() => setSelectedUser(user.id)}
                        >
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Mail className="w-4 h-4 mr-2" />
                          Send Email
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {!user.verified && (
                          <DropdownMenuItem 
                            onClick={() => handleAction('verify', user.id)}
                          >
                            <UserCheck className="w-4 h-4 mr-2" />
                            Verify User
                          </DropdownMenuItem>
                        )}
                        {user.role !== 'ADMIN' && (
                          <DropdownMenuItem 
                            onClick={() => handleAction('make_admin', user.id)}
                          >
                            <Shield className="w-4 h-4 mr-2" />
                            Make Admin
                          </DropdownMenuItem>
                        )}
                        {user.banned ? (
                          <DropdownMenuItem 
                            onClick={() => handleAction('unban', user.id)}
                          >
                            <UserCheck className="w-4 h-4 mr-2" />
                            Unban User
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem 
                            onClick={() => handleAction('ban', user.id)}
                            className="text-destructive"
                          >
                            <UserX className="w-4 h-4 mr-2" />
                            Ban User
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedUser && (
        <UserDetailsDialog
          userId={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  )
}
```

**Checklist**:
- [x] Create user table
- [x] Add search functionality
- [x] Implement filters
- [x] Add user actions
- [x] Include role management

#### 4. `/src/app/admin/moderation/page.tsx`
**Purpose**: Content moderation interface

**Dependencies**:
- Moderation queue
- Content preview

**Exports**:
- Moderation page

```typescript
// src/app/admin/moderation/page.tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  Flag,
  MessageSquare,
  FileText,
  User
} from 'lucide-react'
import { api } from '@/lib/api'
import { ContentPreviewDialog } from '@/components/admin/content-preview-dialog'
import { formatDate } from '@/lib/utils'

export default function ModerationPage() {
  const [selectedContent, setSelectedContent] = useState<any>(null)
  const [activeTab, setActiveTab] = useState('posts')

  const { data: reports } = api.admin.getReports.useQuery({
    status: 'pending',
    type: activeTab,
  })

  const { data: stats } = api.admin.getModerationStats.useQuery()

  const approveContent = api.admin.approveContent.useMutation()
  const rejectContent = api.admin.rejectContent.useMutation()
  const escalateContent = api.admin.escalateContent.useMutation()

  const handleModeration = async (action: string, contentId: string, type: string) => {
    switch (action) {
      case 'approve':
        await approveContent.mutateAsync({ contentId, type })
        break
      case 'reject':
        await rejectContent.mutateAsync({ contentId, type })
        break
      case 'escalate':
        await escalateContent.mutateAsync({ contentId, type })
        break
    }
  }

  const getReasonBadge = (reason: string) => {
    const colors: Record<string, string> = {
      spam: 'bg-yellow-500',
      inappropriate: 'bg-red-500',
      harassment: 'bg-orange-500',
      misinformation: 'bg-purple-500',
      other: 'bg-gray-500',
    }
    
    return (
      <Badge 
        variant="secondary" 
        className={`${colors[reason] || colors.other} text-white`}
      >
        {reason}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Content Moderation</h1>
        <p className="text-muted-foreground">
          Review reported content and maintain community standards
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground">Awaiting moderation</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Approved Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{stats?.approvedToday || 0}</div>
            <p className="text-xs text-muted-foreground">Content approved</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Rejected Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{stats?.rejectedToday || 0}</div>
            <p className="text-xs text-muted-foreground">Content rejected</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Escalated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{stats?.escalated || 0}</div>
            <p className="text-xs text-muted-foreground">Requires admin review</p>
          </CardContent>
        </Card>
      </div>

      {/* Moderation Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Moderation Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="posts">
                <FileText className="w-4 h-4 mr-2" />
                Posts
              </TabsTrigger>
              <TabsTrigger value="comments">
                <MessageSquare className="w-4 h-4 mr-2" />
                Comments
              </TabsTrigger>
              <TabsTrigger value="users">
                <User className="w-4 h-4 mr-2" />
                Users
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-6">
              {reports?.items.length === 0 ? (
                <Alert>
                  <CheckCircle className="w-4 h-4" />
                  <AlertDescription>
                    No content pending moderation. Great job!
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  {reports?.items.map((report: any) => (
                    <Card key={report.id} className="border-l-4 border-l-orange-500">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Flag className="w-4 h-4 text-orange-500" />
                              {getReasonBadge(report.reason)}
                              <span className="text-sm text-muted-foreground">
                                Reported {formatDate(report.createdAt)}
                              </span>
                            </div>
                            
                            <h4 className="font-semibold mb-1">
                              {report.content.title || 'Comment'}
                            </h4>
                            
                            <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                              {report.content.content || report.content.text}
                            </p>
                            
                            <div className="flex items-center gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <User className="w-3 h-3" />
                                <span>By {report.content.author.username}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{report.reportCount} reports</span>
                              </div>
                            </div>
                            
                            {report.reporterNote && (
                              <Alert className="mt-2">
                                <AlertDescription className="text-sm">
                                  "{report.reporterNote}"
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2 ml-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedContent(report.content)}
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              Preview
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleModeration('approve', report.contentId, report.type)}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleModeration('reject', report.contentId, report.type)}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleModeration('escalate', report.contentId, report.type)}
                            >
                              Escalate
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {selectedContent && (
        <ContentPreviewDialog
          content={selectedContent}
          onClose={() => setSelectedContent(null)}
        />
      )}
    </div>
  )
}
```

**Checklist**:
- [x] Create moderation queue
- [x] Add content preview
- [x] Implement actions
- [x] Show report details
- [x] Add statistics

#### 5. `/src/server/api/routers/admin.ts`
**Purpose**: Admin API endpoints

**Dependencies**:
- Admin services
- Authorization

**Exports**:
- `adminRouter`: tRPC router

```typescript
// src/server/api/routers/admin.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc'
import { TRPCError } from '@trpc/server'
import { AdminService } from '@/server/services/admin.service'

const adminProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.session.user.role !== 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  }
  return opts.next()
})

export const adminRouter = createTRPCRouter({
  // Dashboard
  getDashboardStats: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getDashboardStats()
    }),

  getAnalytics: adminProcedure
    .input(z.object({
      period: z.enum(['day', 'week', 'month', 'year']),
      metric: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getAnalytics(input.period, input.metric)
    }),

  // User Management
  getUsers: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      filter: z.string().optional(),
      limit: z.number().default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUsers(input)
    }),

  banUser: adminProcedure
    .input(z.object({
      userId: z.string(),
      reason: z.string().optional(),
      duration: z.number().optional(), // Days
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.banUser(input)
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

  makeAdmin: adminProcedure
    .input(z.object({
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.changeUserRole(input.userId, 'ADMIN')
    }),

  // Content Moderation
  getReports: adminProcedure
    .input(z.object({
      status: z.enum(['pending', 'resolved', 'escalated']).optional(),
      type: z.enum(['posts', 'comments', 'users']).optional(),
      limit: z.number().default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getReports(input)
    }),

  getModerationStats: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getModerationStats()
    }),

  approveContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment']),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.moderateContent(input.contentId, input.type, 'approved')
    }),

  rejectContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment']),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.moderateContent(input.contentId, input.type, 'rejected', input.reason)
    }),

  escalateContent: adminProcedure
    .input(z.object({
      contentId: z.string(),
      type: z.enum(['post', 'comment']),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.escalateContent(input.contentId, input.type, input.note)
    }),

  // Site Settings
  getSiteSettings: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getSiteSettings()
    }),

  updateSiteSettings: adminProcedure
    .input(z.object({
      settings: z.record(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateSiteSettings(input.settings)
    }),

  // Feature Flags
  getFeatureFlags: adminProcedure
    .query(async ({ ctx }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getFeatureFlags()
    }),

  updateFeatureFlag: adminProcedure
    .input(z.object({
      flag: z.string(),
      enabled: z.boolean(),
      rolloutPercentage: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.updateFeatureFlag(input)
    }),
})
```

**Checklist**:
- [x] Create admin middleware
- [x] Add dashboard endpoints
- [x] Implement user management
- [x] Add moderation endpoints
- [x] Include settings management

---

## Phase 7: Performance & Polish (Week 13-14)

### Goals & Objectives
- ✅ Optimize performance
- ✅ Add caching layer
- ✅ Implement monitoring
- ✅ Add error handling
- ✅ Polish UI/UX

### Files to Complete

#### 1. `/src/lib/cache.ts`
**Purpose**: Caching implementation

**Dependencies**:
- Redis client
- Memory cache

**Exports**:
- `cache`: Cache instance

```typescript
// src/lib/cache.ts
import { Redis } from 'ioredis'
import { LRUCache } from 'lru-cache'

class CacheService {
  private redis: Redis | null = null
  private memoryCache: LRUCache<string, any>
  private isRedisConnected = false

  constructor() {
    // Memory cache as fallback
    this.memoryCache = new LRUCache({
      max: 500,
      ttl: 1000 * 60 * 5, // 5 minutes
    })

    // Try to connect to Redis
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL)
      
      this.redis.on('connect', () => {
        this.isRedisConnected = true
        console.log('Redis connected')
      })

      this.redis.on('error', (err) => {
        console.error('Redis error:', err)
        this.isRedisConnected = false
      })
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Try memory cache first
    const memoryResult = this.memoryCache.get(key)
    if (memoryResult !== undefined) {
      return memoryResult
    }

    // Try Redis if connected
    if (this.isRedisConnected && this.redis) {
      try {
        const result = await this.redis.get(key)
        if (result) {
          const parsed = JSON.parse(result)
          // Update memory cache
          this.memoryCache.set(key, parsed)
          return parsed
        }
      } catch (error) {
        console.error('Redis get error:', error)
      }
    }

    return null
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value)
    const ttlSeconds = ttl || 300 // Default 5 minutes

    // Set in memory cache
    this.memoryCache.set(key, value, { ttl: ttlSeconds * 1000 })

    // Set in Redis if connected
    if (this.isRedisConnected && this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, serialized)
      } catch (error) {
        console.error('Redis set error:', error)
      }
    }
  }

  async del(key: string): Promise<void> {
    // Delete from memory cache
    this.memoryCache.delete(key)

    // Delete from Redis if connected
    if (this.isRedisConnected && this.redis) {
      try {
        await this.redis.del(key)
      } catch (error) {
        console.error('Redis del error:', error)
      }
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    // Clear matching keys from memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key)
      }
    }

    // Clear from Redis if connected
    if (this.isRedisConnected && this.redis) {
      try {
        const keys = await this.redis.keys(`*${pattern}*`)
        if (keys.length > 0) {
          await this.redis.del(...keys)
        }
      } catch (error) {
        console.error('Redis invalidate error:', error)
      }
    }
  }

  // Cache key generators
  keys = {
    post: (slug: string) => `post:${slug}`,
    user: (username: string) => `user:${username}`,
    feed: (userId: string, page: number) => `feed:${userId}:${page}`,
    trending: (period: string) => `trending:${period}`,
    search: (query: string, type: string) => `search:${type}:${query}`,
  }
}

export const cache = new CacheService()
```

**Checklist**:
- [x] Create cache service
- [x] Add Redis connection
- [x] Implement memory fallback
- [x] Add key generators
- [x] Handle errors gracefully

#### 2. `/src/lib/monitoring.ts`
**Purpose**: Application monitoring

**Dependencies**:
- Analytics services
- Error tracking

**Exports**:
- Monitoring utilities

```typescript
// src/lib/monitoring.ts
import * as Sentry from '@sentry/nextjs'
import { Analytics } from '@vercel/analytics/react'

class MonitoringService {
  private initialized = false

  init() {
    if (this.initialized) return
    this.initialized = true

    // Initialize Sentry
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: process.env.NODE_ENV,
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        integrations: [
          new Sentry.BrowserTracing(),
          new Sentry.Replay({
            maskAllText: false,
            blockAllMedia: false,
          }),
        ],
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
      })
    }

    // Track Web Vitals
    if (typeof window !== 'undefined') {
      this.trackWebVitals()
    }
  }

  trackEvent(name: string, properties?: Record<string, any>) {
    // Send to analytics
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', name, properties)
    }

    // Send to custom analytics
    this.sendToAnalytics('event', { name, properties })
  }

  trackPageView(url: string) {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('config', process.env.NEXT_PUBLIC_GA_ID, {
        page_path: url,
      })
    }
  }

  trackError(error: Error, context?: Record<string, any>) {
    console.error('Application error:', error)
    
    Sentry.captureException(error, {
      extra: context,
    })

    this.sendToAnalytics('error', {
      message: error.message,
      stack: error.stack,
      ...context,
    })
  }

  trackPerformance(metric: string, value: number, unit: string = 'ms') {
    this.sendToAnalytics('performance', {
      metric,
      value,
      unit,
    })
  }

  setUser(user: { id: string; email: string; username: string }) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    })
  }

  private trackWebVitals() {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'web-vital') {
              this.trackPerformance(
                entry.name,
                Math.round(entry.name === 'CLS' ? entry.value * 1000 : entry.value)
              )
            }
          }
        })
        observer.observe({ entryTypes: ['web-vital'] })
      } catch (err) {
        console.error('Web Vitals tracking error:', err)
      }
    }
  }

  private async sendToAnalytics(type: string, data: any) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Analytics] ${type}:`, data)
      return
    }

    try {
      await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data, timestamp: Date.now() }),
      })
    } catch (error) {
      console.error('Analytics error:', error)
    }
  }
}

export const monitoring = new MonitoringService()
```

**Checklist**:
- [x] Set up error tracking
- [x] Add performance monitoring
- [x] Track custom events
- [x] Monitor Web Vitals
- [x] Implement user tracking

#### 3. `/src/components/error-boundary.tsx`
**Purpose**: Global error boundary

**Dependencies**:
- React error boundary
- Error tracking

**Exports**:
- `ErrorBoundary`: React component

```typescript
// src/components/error-boundary.tsx
'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { monitoring } from '@/lib/monitoring'
import Link from 'next/link'

interface Props {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; reset: () => void }>
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
    monitoring.trackError(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    })
  }

  resetError = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={this.state.error} reset={this.resetError} />
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6">
            <div className="text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              
              <h1 className="text-2xl font-bold">Something went wrong</h1>
              
              <p className="text-muted-foreground">
                We're sorry, but something unexpected happened. Our team has been notified.
              </p>

              {process.env.NODE_ENV === 'development' && (
                <details className="text-left">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Error details
                  </summary>
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              <div className="flex gap-2 justify-center pt-4">
                <Button onClick={this.resetError} variant="default">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
                <Link href="/">
                  <Button variant="outline">
                    <Home className="w-4 h-4 mr-2" />
                    Go Home
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
```

**Checklist**:
- [x] Create error boundary
- [x] Add error tracking
- [x] Show user-friendly error
- [x] Add recovery options
- [x] Include dev details

#### 4. `/src/lib/rate-limiter.ts`
**Purpose**: API rate limiting

**Dependencies**:
- Redis or memory store
- Rate limit algorithms

**Exports**:
- Rate limiting utilities

```typescript
// src/lib/rate-limiter.ts
import { Redis } from 'ioredis'
import { TRPCError } from '@trpc/server'

interface RateLimitOptions {
  windowMs: number
  max: number
  message?: string
  keyPrefix?: string
}

class RateLimiter {
  private redis: Redis | null = null
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map()

  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL)
    }
  }

  async limit(key: string, options: RateLimitOptions): Promise<void> {
    const {
      windowMs,
      max,
      message = 'Too many requests',
      keyPrefix = 'ratelimit',
    } = options

    const fullKey = `${keyPrefix}:${key}`
    const now = Date.now()
    const windowStart = now - windowMs

    if (this.redis) {
      // Redis implementation
      const multi = this.redis.multi()
      
      // Remove old entries
      multi.zremrangebyscore(fullKey, '-inf', windowStart)
      
      // Count current entries
      multi.zcard(fullKey)
      
      // Add current request
      multi.zadd(fullKey, now, `${now}-${Math.random()}`)
      
      // Set expiry
      multi.expire(fullKey, Math.ceil(windowMs / 1000))
      
      const results = await multi.exec()
      const count = results?.[1]?.[1] as number || 0

      if (count >= max) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message,
        })
      }
    } else {
      // Memory store fallback
      const record = this.memoryStore.get(fullKey)
      
      if (!record || record.resetTime < now) {
        this.memoryStore.set(fullKey, {
          count: 1,
          resetTime: now + windowMs,
        })
      } else {
        record.count++
        
        if (record.count > max) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message,
          })
        }
      }

      // Clean up old entries periodically
      if (Math.random() < 0.01) {
        this.cleanup()
      }
    }
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, record] of this.memoryStore.entries()) {
      if (record.resetTime < now) {
        this.memoryStore.delete(key)
      }
    }
  }

  // Preset configurations
  static presets = {
    strict: { windowMs: 60 * 1000, max: 10 }, // 10 requests per minute
    normal: { windowMs: 60 * 1000, max: 60 }, // 60 requests per minute
    relaxed: { windowMs: 60 * 1000, max: 200 }, // 200 requests per minute
    auth: { windowMs: 15 * 60 * 1000, max: 5 }, // 5 attempts per 15 minutes
  }
}

export const rateLimiter = new RateLimiter()

// Middleware for tRPC
export function withRateLimit(options: RateLimitOptions) {
  return async (opts: any) => {
    const key = opts.ctx.session?.user?.id || opts.ctx.req?.ip || 'anonymous'
    await rateLimiter.limit(key, options)
    return opts.next()
  }
}
```

**Checklist**:
- [x] Create rate limiter
- [x] Add Redis support
- [x] Implement memory fallback
- [x] Create presets
- [x] Add middleware helper

#### 5. `/src/lib/seo.ts`
**Purpose**: SEO utilities and metadata

**Dependencies**:
- Next.js metadata
- Schema.org

**Exports**:
- SEO helpers

```typescript
// src/lib/seo.ts
import { Metadata } from 'next'

interface SEOProps {
  title?: string
  description?: string
  image?: string
  url?: string
  type?: 'website' | 'article' | 'profile'
  author?: string
  publishedTime?: string
  modifiedTime?: string
  tags?: string[]
}

export function generateMetadata({
  title = 'Sparkle Universe',
  description = 'Where fans become stars - Join the ultimate community for Sparkle YouTube fans',
  image = '/og-image.png',
  url = process.env.NEXT_PUBLIC_APP_URL,
  type = 'website',
  author,
  publishedTime,
  modifiedTime,
  tags,
}: SEOProps): Metadata {
  const fullTitle = title === 'Sparkle Universe' ? title : `${title} | Sparkle Universe`
  const absoluteImage = image.startsWith('http') ? image : `${url}${image}`

  return {
    title: fullTitle,
    description,
    keywords: tags,
    authors: author ? [{ name: author }] : undefined,
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: 'Sparkle Universe',
      images: [
        {
          url: absoluteImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: 'en_US',
      type,
      publishedTime,
      modifiedTime,
      authors: author ? [author] : undefined,
      tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [absoluteImage],
      creator: '@sparkleuniverse',
    },
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

export function generateStructuredData(type: string, data: any) {
  switch (type) {
    case 'article':
      return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: data.title,
        description: data.excerpt,
        image: data.image,
        author: {
          '@type': 'Person',
          name: data.author.name,
          url: `${process.env.NEXT_PUBLIC_APP_URL}/user/${data.author.username}`,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Sparkle Universe',
          logo: {
            '@type': 'ImageObject',
            url: `${process.env.NEXT_PUBLIC_APP_URL}/logo.png`,
          },
        },
        datePublished: data.publishedAt,
        dateModified: data.updatedAt,
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': data.url,
        },
      }

    case 'profile':
      return {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: data.name,
        url: data.url,
        image: data.image,
        description: data.bio,
        sameAs: data.socialLinks || [],
      }

    case 'website':
      return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Sparkle Universe',
        description: 'The ultimate community for Sparkle YouTube fans',
        url: process.env.NEXT_PUBLIC_APP_URL,
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${process.env.NEXT_PUBLIC_APP_URL}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      }

    default:
      return null
  }
}

export function generateRobotsTxt(): string {
  return `# Sparkle Universe Robots.txt
User-agent: *
Allow: /

# Sitemaps
Sitemap: ${process.env.NEXT_PUBLIC_APP_URL}/sitemap.xml

# Crawl-delay
Crawl-delay: 1

# Disallow admin and API
User-agent: *
Disallow: /admin
Disallow: /api/

# Allow search engines
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Slurp
Allow: /

User-agent: DuckDuckBot
Allow: /`
}
```

**Checklist**:
- [x] Create metadata generator
- [x] Add structured data
- [x] Include Open Graph
- [x] Add Twitter cards
- [x] Generate robots.txt

---

## Database Schema

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum types
CREATE TYPE user_role AS ENUM ('USER', 'MODERATOR', 'ADMIN');
CREATE TYPE notification_type AS ENUM (
  'POST_LIKED',
  'POST_COMMENTED',
  'COMMENT_LIKED',
  'USER_FOLLOWED',
  'ACHIEVEMENT_UNLOCKED',
  'LEVEL_UP',
  'MENTION',
  'SYSTEM'
);
CREATE TYPE reaction_type AS ENUM ('LIKE', 'LOVE', 'FIRE', 'SPARKLE', 'MIND_BLOWN');
CREATE TYPE report_reason AS ENUM ('SPAM', 'INAPPROPRIATE', 'HARASSMENT', 'MISINFORMATION', 'OTHER');
CREATE TYPE moderation_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED');

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  hashed_password VARCHAR(255),
  email_verified TIMESTAMP,
  image VARCHAR(500),
  bio TEXT,
  role user_role DEFAULT 'USER',
  verified BOOLEAN DEFAULT FALSE,
  banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  ban_expires_at TIMESTAMP,
  experience INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_users_email (email),
  INDEX idx_users_username (username),
  INDEX idx_users_role (role),
  INDEX idx_users_level (level)
);

-- User profiles (extended user data)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(100),
  location VARCHAR(100),
  website VARCHAR(255),
  twitter_username VARCHAR(50),
  youtube_channel_id VARCHAR(100),
  youtube_channel_url VARCHAR(255),
  banner_image VARCHAR(500),
  theme_preference JSONB,
  notification_settings JSONB DEFAULT '{}',
  privacy_settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_profiles_user_id (user_id)
);

-- OAuth accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type VARCHAR(50),
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(provider, provider_account_id),
  INDEX idx_accounts_user_id (user_id)
);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_sessions_user_id (user_id),
  INDEX idx_sessions_token (session_token)
);

-- Posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  cover_image VARCHAR(500),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  published BOOLEAN DEFAULT FALSE,
  featured BOOLEAN DEFAULT FALSE,
  youtube_video_id VARCHAR(50),
  views INTEGER DEFAULT 0,
  reading_time INTEGER,
  meta_description TEXT,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_posts_slug (slug),
  INDEX idx_posts_author_id (author_id),
  INDEX idx_posts_published (published, published_at DESC),
  INDEX idx_posts_featured (featured)
);

-- Tags
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  color VARCHAR(7),
  post_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_tags_name (name),
  INDEX idx_tags_slug (slug)
);

-- Post tags (many-to-many)
CREATE TABLE post_tags (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (post_id, tag_id),
  INDEX idx_post_tags_post_id (post_id),
  INDEX idx_post_tags_tag_id (tag_id)
);

-- Comments
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP,
  deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_comments_post_id (post_id),
  INDEX idx_comments_author_id (author_id),
  INDEX idx_comments_parent_id (parent_id)
);

-- Reactions
CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type reaction_type NOT NULL,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure one reaction per user per content
  UNIQUE(post_id, user_id, type),
  UNIQUE(comment_id, user_id, type),
  
  -- Ensure reaction is for post OR comment, not both
  CONSTRAINT chk_reaction_target CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL) OR
    (post_id IS NULL AND comment_id IS NOT NULL)
  ),
  
  INDEX idx_reactions_post_id (post_id),
  INDEX idx_reactions_comment_id (comment_id),
  INDEX idx_reactions_user_id (user_id)
);

-- Follows (user relationships)
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(follower_id, following_id),
  CONSTRAINT chk_no_self_follow CHECK (follower_id != following_id),
  
  INDEX idx_follows_follower_id (follower_id),
  INDEX idx_follows_following_id (following_id)
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type notification_type NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_id VARCHAR(100),
  entity_type VARCHAR(50),
  message TEXT NOT NULL,
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_notifications_user_id (user_id, read, created_at DESC),
  INDEX idx_notifications_actor_id (actor_id)
);

-- Achievements
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  xp_reward INTEGER DEFAULT 0,
  rarity VARCHAR(20),
  category VARCHAR(50),
  criteria JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User achievements
CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  progress JSONB,
  
  UNIQUE(user_id, achievement_id),
  INDEX idx_user_achievements_user_id (user_id)
);

-- XP logs
CREATE TABLE xp_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_xp_logs_user_id (user_id, created_at DESC)
);

-- Reports (content moderation)
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason report_reason NOT NULL,
  description TEXT,
  status moderation_status DEFAULT 'PENDING',
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP,
  resolution_note TEXT,
  
  -- Polymorphic relation
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_reports_status (status),
  INDEX idx_reports_entity (entity_type, entity_id)
);

-- Site settings
CREATE TABLE site_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  category VARCHAR(50),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Feature flags
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag VARCHAR(100) UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  conditions JSONB,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analytics events
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(100),
  properties JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_analytics_events_name (event_name, timestamp DESC),
  INDEX idx_analytics_events_user_id (user_id),
  INDEX idx_analytics_events_session_id (session_id)
);

-- Search index queue
CREATE TABLE search_index_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'create', 'update', 'delete'
  processed BOOLEAN DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  
  INDEX idx_search_queue_processed (processed, created_at)
);

-- Functions

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update post count for tags
CREATE OR REPLACE FUNCTION update_tag_post_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET post_count = post_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tags SET post_count = post_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tag_counts
AFTER INSERT OR DELETE ON post_tags
FOR EACH ROW EXECUTE FUNCTION update_tag_post_count();

-- Function to calculate user level from XP
CREATE OR REPLACE FUNCTION calculate_user_level(xp INTEGER)
RETURNS INTEGER AS $$
BEGIN
  RETURN FLOOR(SQRT(xp::FLOAT / 100)) + 1;
END;
$$ LANGUAGE plpgsql;

-- Function to check and unlock achievements
CREATE OR REPLACE FUNCTION check_achievements(p_user_id UUID, p_trigger VARCHAR)
RETURNS TABLE(achievement_id UUID, achievement_name VARCHAR) AS $$
DECLARE
  v_achievement RECORD;
  v_unlocked BOOLEAN;
BEGIN
  FOR v_achievement IN 
    SELECT a.* FROM achievements a
    WHERE a.criteria->>'trigger' = p_trigger
    AND NOT EXISTS (
      SELECT 1 FROM user_achievements ua 
      WHERE ua.user_id = p_user_id AND ua.achievement_id = a.id
    )
  LOOP
    -- Check criteria (simplified, would be more complex in reality)
    v_unlocked := TRUE;
    
    IF v_unlocked THEN
      INSERT INTO user_achievements (user_id, achievement_id)
      VALUES (p_user_id, v_achievement.id);
      
      RETURN QUERY SELECT v_achievement.id, v_achievement.name;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Materialized view for trending posts
CREATE MATERIALIZED VIEW trending_posts AS
SELECT 
  p.id,
  p.slug,
  p.title,
  p.author_id,
  p.created_at,
  COUNT(DISTINCT r.user_id) AS reaction_count,
  COUNT(DISTINCT c.id) AS comment_count,
  p.views,
  (
    COUNT(DISTINCT r.user_id) * 3 + 
    COUNT(DISTINCT c.id) * 2 + 
    p.views * 0.1 +
    CASE WHEN p.created_at > NOW() - INTERVAL '7 days' THEN 10 ELSE 0 END
  ) AS trending_score
FROM posts p
LEFT JOIN reactions r ON r.post_id = p.id
LEFT JOIN comments c ON c.post_id = p.id
WHERE p.published = TRUE
  AND p.created_at > NOW() - INTERVAL '30 days'
GROUP BY p.id;

CREATE INDEX idx_trending_posts_score ON trending_posts(trending_score DESC);

-- Refresh trending posts every hour
CREATE OR REPLACE FUNCTION refresh_trending_posts()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY trending_posts;
END;
$$ LANGUAGE plpgsql;
```

---

## Conclusion

This comprehensive execution plan provides a complete roadmap for building Sparkle Universe from the ground up. Each phase builds upon the previous one, ensuring a solid foundation while progressively adding features.

### Key Success Factors:
1. **Follow the phases in order** - Each phase depends on the previous
2. **Complete all checklists** - Ensures nothing is missed
3. **Test as you build** - Write tests alongside implementation
4. **Document as you go** - Keep documentation updated
5. **Deploy incrementally** - Ship features as they're completed

### Next Steps:
1. Set up your development environment
2. Initialize the project with Phase 1
3. Follow the execution plan phase by phase
4. Deploy to production after Phase 3 for early feedback
5. Continue building advanced features

With this detailed plan, any developer can build Sparkle Universe with confidence, knowing exactly what needs to be implemented and how all the pieces fit together.

**Happy coding, and welcome to the future of fan communities! 🌟**
