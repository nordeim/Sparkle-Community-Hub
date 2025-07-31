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

## Conclusion

This comprehensive execution plan provides a complete roadmap for building Sparkle Universe from the ground up. Each phase builds upon the previous one, ensuring a solid foundation while progressively adding features.

### Key Success Factors:
1. **Follow the phases in order** - Each phase depends on the previous
2. **Complete all checklists** - Ensures nothing is missed
3. **Test as you build** - Write tests alongside implementation
4. **Document as you go** - Keep documentation updated
5. **Deploy incrementally** - Ship features as they're completed
