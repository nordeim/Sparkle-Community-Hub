// src/components/features/gamification/level-progress.tsx
'use client'

import { useMemo } from 'react'
import { Progress } from '@/components/ui/progress'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Trophy, 
  TrendingUp, 
  Star, 
  Zap,
  Target,
  Award,
  Sparkles,
  ChevronRight
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { motion } from 'framer-motion'

interface LevelProgressProps {
  userId: string
  variant?: 'default' | 'compact' | 'detailed'
  showActions?: boolean
  className?: string
}

export function LevelProgress({ 
  userId, 
  variant = 'default',
  showActions = true,
  className 
}: LevelProgressProps) {
  const { data: stats, isLoading } = api.gamification.getUserStats.useQuery({ userId })

  const levelMilestones = useMemo(() => {
    if (!stats?.levelProgress) return []
    
    const milestones = [10, 25, 50, 100]
    return milestones.map(milestone => ({
      level: milestone,
      reached: stats.user.level >= milestone,
      isCurrent: stats.user.level < milestone && 
                 stats.user.level >= (milestones[milestones.indexOf(milestone) - 1] || 0),
    }))
  }, [stats])

  if (isLoading) {
    return (
      <Card className={cn("relative overflow-hidden", className)}>
        <div className="p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-muted rounded w-1/3 mb-2" />
            <div className="h-8 bg-muted rounded mb-4" />
            <div className="h-2 bg-muted rounded" />
          </div>
        </div>
      </Card>
    )
  }

  if (!stats) return null

  if (variant === 'compact') {
    return (
      <Card className={cn("relative overflow-hidden group cursor-pointer", className)}>
        <Link href={`/user/${stats.user.username}`}>
          <div className="p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-sparkle-500 to-sparkle-700 flex items-center justify-center text-white font-bold">
                    {stats.user.level}
                  </div>
                  <Trophy className="w-4 h-4 text-yellow-500 absolute -bottom-1 -right-1" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Level {stats.user.level}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(stats.levelProgress.progressXP)} / {formatNumber(stats.levelProgress.nextLevelXP - stats.levelProgress.currentLevelXP)} XP
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <Progress 
              value={stats.levelProgress.progressPercentage} 
              className="h-1.5"
            />
          </div>
        </Link>
      </Card>
    )
  }

  if (variant === 'detailed') {
    return (
      <Card className={cn("relative overflow-hidden", className)}>
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-br from-sparkle-500/10 via-transparent to-sparkle-700/10 opacity-50" />
        
        <div className="relative p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <motion.div 
                  className="w-16 h-16 rounded-full bg-gradient-to-r from-sparkle-500 to-sparkle-700 flex items-center justify-center text-white font-bold text-2xl shadow-lg"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {stats.user.level}
                </motion.div>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -bottom-2 -right-2"
                >
                  <Trophy className="w-6 h-6 text-yellow-500" />
                </motion.div>
              </div>
              <div>
                <h3 className="text-2xl font-bold">Level {stats.user.level}</h3>
                <p className="text-muted-foreground">
                  Rank #{stats.rank} • {formatNumber(stats.user.experience)} Total XP
                </p>
              </div>
            </div>
            
            {showActions && (
              <Link href="/leaderboard">
                <Button variant="outline" size="sm">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Leaderboard
                </Button>
              </Link>
            )}
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress to Level {stats.user.level + 1}</span>
              <span className="font-medium">
                {formatNumber(stats.levelProgress.progressXP)} / {formatNumber(stats.levelProgress.nextLevelXP - stats.levelProgress.currentLevelXP)} XP
              </span>
            </div>
            <div className="relative">
              <Progress 
                value={stats.levelProgress.progressPercentage} 
                className="h-3"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-medium text-white drop-shadow">
                  {Math.round(stats.levelProgress.progressPercentage)}%
                </span>
              </div>
            </div>
          </div>

          {/* Milestones */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Target className="w-4 h-4" />
              Level Milestones
            </h4>
            <div className="grid grid-cols-4 gap-2">
              {levelMilestones.map((milestone) => (
                <div
                  key={milestone.level}
                  className={cn(
                    "relative p-3 rounded-lg text-center transition-all",
                    milestone.reached
                      ? "bg-sparkle-500/20 border border-sparkle-500/50"
                      : milestone.isCurrent
                      ? "bg-muted border border-primary/50 animate-pulse"
                      : "bg-muted/50 opacity-50"
                  )}
                >
                  <Award className={cn(
                    "w-6 h-6 mx-auto mb-1",
                    milestone.reached ? "text-sparkle-500" : "text-muted-foreground"
                  )} />
                  <p className="text-xs font-medium">Level {milestone.level}</p>
                  {milestone.reached && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1"
                    >
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Recent XP */}
          {stats.recentXP && stats.recentXP.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Recent XP Gains
              </h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {stats.recentXP.slice(0, 5).map((xp, index) => (
                  <motion.div
                    key={xp.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center justify-between text-sm p-2 rounded bg-muted/50"
                  >
                    <span className="text-muted-foreground">{xp.reason}</span>
                    <Badge variant="secondary" className="ml-2">
                      +{xp.amount} XP
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{stats.stats.posts}</p>
              <p className="text-xs text-muted-foreground">Posts</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{stats.stats.followers}</p>
              <p className="text-xs text-muted-foreground">Followers</p>
            </div>
          </div>

          {/* Currency */}
          <div className="flex items-center justify-between p-3 bg-sparkle-500/10 rounded-lg border border-sparkle-500/20">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sparkle-500" />
              <span className="font-medium">Sparkle Points</span>
            </div>
            <span className="font-bold text-lg">{formatNumber(stats.user.sparklePoints)}</span>
          </div>
        </div>
      </Card>
    )
  }

  // Default variant
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-sparkle-500 to-sparkle-700 flex items-center justify-center text-white font-bold text-lg">
                {stats.user.level}
              </div>
              <Trophy className="w-4 h-4 text-yellow-500 absolute -bottom-1 -right-1" />
            </div>
            <div>
              <p className="font-semibold">Level {stats.user.level}</p>
              <p className="text-sm text-muted-foreground">
                Rank #{stats.rank}
              </p>
            </div>
          </div>
          
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total XP</p>
            <p className="font-bold">{formatNumber(stats.user.experience)}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress to Level {stats.user.level + 1}</span>
            <span className="font-medium">
              {Math.round(stats.levelProgress.progressPercentage)}%
            </span>
          </div>
          <Progress 
            value={stats.levelProgress.progressPercentage} 
            className="h-2"
          />
          <p className="text-xs text-muted-foreground text-center">
            {formatNumber(stats.levelProgress.progressXP)} / {formatNumber(stats.levelProgress.nextLevelXP - stats.levelProgress.currentLevelXP)} XP
          </p>
        </div>

        {showActions && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Link href={`/user/${stats.user.username}/achievements`}>
              <Button variant="outline" size="sm" className="w-full">
                <Award className="w-4 h-4 mr-2" />
                Achievements
              </Button>
            </Link>
            <Link href="/quests">
              <Button variant="outline" size="sm" className="w-full">
                <Target className="w-4 h-4 mr-2" />
                Quests
              </Button>
            </Link>
          </div>
        )}
      </div>
    </Card>
  )
}
