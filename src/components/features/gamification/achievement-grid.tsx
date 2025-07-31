// src/components/features/gamification/achievement-grid.tsx
'use client'

import { useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { 
  Lock, 
  Trophy, 
  Star, 
  Search,
  Filter,
  Sparkles,
  Award,
  TrendingUp,
  Clock,
  Eye,
  EyeOff
} from 'lucide-react'
import { api } from '@/lib/api'
import { 
  achievements, 
  achievementCategories,
  getRarityColor,
  getRarityGradient,
  getVisibleAchievements,
  type Achievement
} from '@/config/achievements'
import { cn } from '@/lib/utils'
import { formatDate, formatNumber } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface AchievementGridProps {
  userId: string
  showHidden?: boolean
  onAchievementClick?: (achievement: Achievement) => void
}

export function AchievementGrid({ 
  userId, 
  showHidden = false,
  onAchievementClick 
}: AchievementGridProps) {
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null)
  const [showLocked, setShowLocked] = useState(true)
  
  const { data: userAchievements = [] } = api.gamification.getUserAchievements.useQuery({ 
    userId,
    includeProgress: true 
  })
  
  const unlockedIds = new Set(userAchievements.map(a => a.achievementId))
  
  // Filter achievements
  const filteredAchievements = useMemo(() => {
    let filtered = showHidden ? achievements : getVisibleAchievements()
    
    // Category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(a => a.category === selectedCategory)
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(a => 
        a.name.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query)
      )
    }
    
    // Show/hide locked
    if (!showLocked) {
      filtered = filtered.filter(a => unlockedIds.has(a.id))
    }
    
    // Sort: unlocked first, then by rarity
    const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
    return filtered.sort((a, b) => {
      const aUnlocked = unlockedIds.has(a.id)
      const bUnlocked = unlockedIds.has(b.id)
      
      if (aUnlocked !== bUnlocked) {
        return aUnlocked ? -1 : 1
      }
      
      return rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity)
    })
  }, [selectedCategory, searchQuery, showLocked, showHidden, unlockedIds])

  const stats = useMemo(() => {
    const total = showHidden ? achievements.length : getVisibleAchievements().length
    const unlocked = userAchievements.length
    const percentage = total > 0 ? (unlocked / total) * 100 : 0
    
    const byCategory = achievementCategories.reduce((acc, cat) => {
      if (cat.id === 'all') return acc
      
      const catAchievements = achievements.filter(a => a.category === cat.id && (!a.hidden || showHidden))
      const catUnlocked = catAchievements.filter(a => unlockedIds.has(a.id)).length
      
      acc[cat.id] = {
        total: catAchievements.length,
        unlocked: catUnlocked,
        percentage: catAchievements.length > 0 ? (catUnlocked / catAchievements.length) * 100 : 0
      }
      return acc
    }, {} as Record<string, { total: number; unlocked: number; percentage: number }>)
    
    const totalXP = userAchievements.reduce((sum, ua) => {
      const achievement = achievements.find(a => a.id === ua.achievementId)
      return sum + (achievement?.xp || 0)
    }, 0)
    
    const totalSparklePoints = userAchievements.reduce((sum, ua) => {
      const achievement = achievements.find(a => a.id === ua.achievementId)
      return sum + (achievement?.sparklePoints || 0)
    }, 0)
    
    return {
      total,
      unlocked,
      percentage,
      byCategory,
      totalXP,
      totalSparklePoints
    }
  }, [userAchievements, showHidden, unlockedIds])

  const handleAchievementClick = (achievement: Achievement) => {
    setSelectedAchievement(achievement)
    onAchievementClick?.(achievement)
  }

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Progress</p>
              <p className="text-2xl font-bold">{stats.unlocked} / {stats.total}</p>
            </div>
            <Trophy className="w-8 h-8 text-yellow-500" />
          </div>
          <Progress value={stats.percentage} className="mt-2" />
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total XP Earned</p>
              <p className="text-2xl font-bold">{formatNumber(stats.totalXP)}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-500" />
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Sparkle Points Earned</p>
              <p className="text-2xl font-bold">{formatNumber(stats.totalSparklePoints)}</p>
            </div>
            <Sparkles className="w-8 h-8 text-sparkle-500" />
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search achievements..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLocked(!showLocked)}
            className="whitespace-nowrap"
          >
            {showLocked ? (
              <>
                <Eye className="w-4 h-4 mr-2" />
                Show All
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4 mr-2" />
                Unlocked Only
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList className="w-full justify-start flex-wrap h-auto p-1">
          {achievementCategories
            .filter(cat => !cat.id.includes('hidden') || showHidden)
            .map(category => {
              const catStats = stats.byCategory[category.id]
              return (
                <TabsTrigger 
                  key={category.id} 
                  value={category.id}
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <span className="mr-1">{category.icon}</span>
                  {category.name}
                  {catStats && category.id !== 'all' && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {catStats.unlocked}/{catStats.total}
                    </Badge>
                  )}
                </TabsTrigger>
              )
            })}
        </TabsList>

        <TabsContent value={selectedCategory} className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredAchievements.map((achievement, index) => {
                const isUnlocked = unlockedIds.has(achievement.id)
                const userAchievement = userAchievements.find(
                  ua => ua.achievementId === achievement.id
                )
                const progress = userAchievement?.progress as any

                return (
                  <motion.div
                    key={achievement.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.02 }}
                  >
                    <Card
                      className={cn(
                        'relative p-4 cursor-pointer transition-all hover:shadow-lg',
                        isUnlocked
                          ? `bg-gradient-to-br ${getRarityGradient(achievement.rarity)} bg-opacity-10 border-2`
                          : 'opacity-75 hover:opacity-100'
                      )}
                      style={{
                        borderColor: isUnlocked ? getRarityColor(achievement.rarity) : undefined
                      }}
                      onClick={() => handleAchievementClick(achievement)}
                    >
                      {/* Sparkle effect for unlocked achievements */}
                      {isUnlocked && (
                        <div className="absolute inset-0 overflow-hidden rounded-lg">
                          <div className="sparkle-effect" />
                        </div>
                      )}

                      <div className="relative flex items-start gap-3">
                        <div className={cn(
                          'w-14 h-14 rounded-full flex items-center justify-center text-2xl flex-shrink-0',
                          isUnlocked 
                            ? `bg-gradient-to-br ${getRarityGradient(achievement.rarity)}`
                            : 'bg-muted'
                        )}>
                          {isUnlocked ? (
                            <motion.span
                              initial={{ scale: 0, rotate: -180 }}
                              animate={{ scale: 1, rotate: 0 }}
                              transition={{ type: "spring", stiffness: 200 }}
                            >
                              {achievement.icon}
                            </motion.span>
                          ) : (
                            <Lock className="w-6 h-6 text-muted-foreground" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h3 className="font-semibold line-clamp-1">
                              {achievement.hidden && !isUnlocked ? '???' : achievement.name}
                            </h3>
                            <Badge 
                              variant="secondary" 
                              className="text-xs flex-shrink-0"
                              style={{
                                backgroundColor: `${getRarityColor(achievement.rarity)}20`,
                                color: getRarityColor(achievement.rarity)
                              }}
                            >
                              {achievement.rarity}
                            </Badge>
                          </div>
                          
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {achievement.hidden && !isUnlocked 
                              ? 'This achievement is hidden. Unlock it to see details!' 
                              : achievement.description
                            }
                          </p>

                          {/* Progress bar for trackable achievements */}
                          {!isUnlocked && progress && progress.current !== undefined && (
                            <div className="mb-2">
                              <Progress 
                                value={(progress.current / progress.required) * 100} 
                                className="h-1.5"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                {progress.current} / {progress.required}
                              </p>
                            </div>
                          )}
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs">
                              <span className="flex items-center gap-1">
                                <TrendingUp className="w-3 h-3" />
                                {achievement.xp} XP
                              </span>
                              <span className="flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                {achievement.sparklePoints} SP
                              </span>
                            </div>
                            
                            {isUnlocked && userAchievement && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Clock className="w-3 h-3 text-muted-foreground" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Unlocked {formatDate(userAchievement.unlockedAt)}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Completion indicator */}
                      {isUnlocked && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-2 -right-2"
                        >
                          <div className="bg-green-500 rounded-full p-1">
                            <Star className="w-4 h-4 text-white fill-white" />
                          </div>
                        </motion.div>
                      )}
                    </Card>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>

          {filteredAchievements.length === 0 && (
            <div className="text-center py-12">
              <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No achievements found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Achievement Detail Dialog */}
      <Dialog open={!!selectedAchievement} onOpenChange={() => setSelectedAchievement(null)}>
        <DialogContent>
          {selectedAchievement && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-16 h-16 rounded-full flex items-center justify-center text-3xl',
                    unlockedIds.has(selectedAchievement.id)
                      ? `bg-gradient-to-br ${getRarityGradient(selectedAchievement.rarity)}`
                      : 'bg-muted'
                  )}>
                    {unlockedIds.has(selectedAchievement.id) ? (
                      selectedAchievement.icon
                    ) : (
                      <Lock className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <DialogTitle>{selectedAchievement.name}</DialogTitle>
                    <Badge 
                      variant="secondary"
                      style={{
                        backgroundColor: `${getRarityColor(selectedAchievement.rarity)}20`,
                        color: getRarityColor(selectedAchievement.rarity)
                      }}
                    >
                      {selectedAchievement.rarity}
                    </Badge>
                  </div>
                </div>
              </DialogHeader>
              <DialogDescription>
                {selectedAchievement.description}
              </DialogDescription>
              
              <div className="space-y-4 mt-4">
                <div className="flex items-center justify-around p-4 bg-muted rounded-lg">
                  <div className="text-center">
                    <TrendingUp className="w-6 h-6 mx-auto mb-1 text-green-500" />
                    <p className="text-2xl font-bold">{selectedAchievement.xp}</p>
                    <p className="text-xs text-muted-foreground">XP Reward</p>
                  </div>
                  <div className="text-center">
                    <Sparkles className="w-6 h-6 mx-auto mb-1 text-sparkle-500" />
                    <p className="text-2xl font-bold">{selectedAchievement.sparklePoints}</p>
                    <p className="text-xs text-muted-foreground">Sparkle Points</p>
                  </div>
                </div>

                {unlockedIds.has(selectedAchievement.id) && (
                  <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <Award className="w-4 h-4" />
                    <span>Achievement Unlocked!</span>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// CSS for sparkle effect
const sparkleStyles = `
@keyframes sparkle {
  0% {
    opacity: 0;
    transform: scale(0) rotate(0deg);
  }
  50% {
    opacity: 1;
    transform: scale(1) rotate(180deg);
  }
  100% {
    opacity: 0;
    transform: scale(0) rotate(360deg);
  }
}

.sparkle-effect::before {
  content: '';
  position: absolute;
  top: 20%;
  left: 20%;
  width: 10px;
  height: 10px;
  background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
  border-radius: 50%;
  animation: sparkle 2s infinite;
}

.sparkle-effect::after {
  content: '';
  position: absolute;
  bottom: 30%;
  right: 30%;
  width: 8px;
  height: 8px;
  background: radial-gradient(circle, rgba(255,255,255,0.6) 0%, transparent 70%);
  border-radius: 50%;
  animation: sparkle 2s infinite 0.5s;
}
`

// Add styles to document
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = sparkleStyles
  document.head.appendChild(style)
}
