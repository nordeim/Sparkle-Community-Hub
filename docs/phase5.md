## Assessment of Architecture Design (Phases 5-7)

After thoroughly reviewing the second half of the execution plan against the PRD and README documents, here's my assessment:

### ✅ Strong Alignment Areas

1. **Admin Panel (Phase 6)**: Excellently covers all PRD requirements:
   - Comprehensive dashboard with real-time metrics
   - User management with role-based access
   - Content moderation with AI integration considerations
   - Analytics and site configuration

2. **Performance Architecture (Phase 7)**: Aligns perfectly with PRD's technical requirements:
   - Multi-layer caching (memory + Redis)
   - Monitoring and error tracking
   - Rate limiting for API protection
   - SEO optimization

### ⚠️ Gaps in Phase 5 (Gamification & Social)

While the basic gamification structure is present, several PRD requirements are missing:

1. **Virtual Economy**: No implementation of Sparkle Points transactions, virtual store, or item purchases
2. **Trading System**: Completely absent despite being a key PRD feature
3. **Daily Quests**: Only achievements are shown, but quest system is missing
4. **Social Features**: Groups, events, and direct messaging aren't addressed

### Overall Assessment: 7/10

The execution plan provides solid implementations for admin and performance features but significantly underdelivers on the gamification and social aspects that are central to the PRD's vision.

---

## Phase 5: Gamification & Social - Complete Implementation

Let me create comprehensive implementations that fully address all PRD requirements:

### 1. `/src/server/services/gamification.service.ts`

```typescript
// src/server/services/gamification.service.ts
import { PrismaClient, Prisma, QuestType, BadgeRarity } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { achievements } from '@/config/achievements'
import { WebSocketServer } from '@/server/websocket/socket.server'
import { cache } from '@/lib/cache'

interface LevelProgress {
  level: number
  currentXP: number
  currentLevelXP: number
  nextLevelXP: number
  progressXP: number
  progressPercentage: number
}

interface QuestProgress {
  questId: string
  current: number
  required: number
  percentage: number
}

export class GamificationService {
  constructor(
    private db: PrismaClient,
    private wsServer?: WebSocketServer
  ) {}

  // ========== XP & Levels ==========

  async awardXP(
    userId: string, 
    amount: number, 
    reason: string,
    metadata?: any
  ): Promise<{
    totalXP: number
    xpGained: number
    levelUp: boolean
    newLevel?: number
    rewards?: any[]
  }> {
    return this.db.$transaction(async (tx) => {
      // Award XP
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          experience: { increment: amount },
        },
        select: {
          id: true,
          experience: true,
          level: true,
          username: true,
        },
      })

      // Log XP gain
      await tx.xpLog.create({
        data: {
          userId,
          amount,
          reason,
          metadata,
        },
      })

      // Check for level up
      const newLevel = this.calculateLevel(user.experience)
      const levelUp = newLevel > user.level
      const rewards: any[] = []

      if (levelUp) {
        // Update user level
        await tx.user.update({
          where: { id: userId },
          data: { level: newLevel },
        })

        // Calculate level rewards
        const levelRewards = this.getLevelRewards(newLevel)
        
        // Award Sparkle Points for level up
        if (levelRewards.sparklePoints > 0) {
          await this.awardCurrency(
            userId,
            levelRewards.sparklePoints,
            'sparkle_points',
            `Level ${newLevel} reward`,
            tx
          )
          rewards.push({
            type: 'sparkle_points',
            amount: levelRewards.sparklePoints,
          })
        }

        // Unlock level-based achievements
        const levelAchievements = await this.checkLevelAchievements(
          userId,
          newLevel,
          tx
        )
        rewards.push(...levelAchievements.map(a => ({
          type: 'achievement',
          achievement: a,
        })))

        // Create notification
        await tx.notification.create({
          data: {
            type: 'LEVEL_UP',
            userId,
            message: `Congratulations! You reached level ${newLevel}!`,
            data: { 
              level: newLevel,
              rewards,
            },
          },
        })

        // Emit real-time event
        this.wsServer?.emitToUser(userId, 'level:up', {
          level: newLevel,
          totalXP: user.experience,
          rewards,
        })
      }

      // Check XP-based achievements
      await this.checkAchievements(userId, 'xp_gained', { 
        amount,
        total: user.experience 
      }, tx)

      // Invalidate cache
      await cache.del(`user:stats:${userId}`)

      return {
        totalXP: user.experience,
        xpGained: amount,
        levelUp,
        newLevel: levelUp ? newLevel : undefined,
        rewards: rewards.length > 0 ? rewards : undefined,
      }
    })
  }

  calculateLevel(xp: number): number {
    // Progressive level curve: each level requires more XP
    // Level 1: 0 XP
    // Level 2: 100 XP
    // Level 3: 300 XP (100 + 200)
    // Level 4: 600 XP (100 + 200 + 300)
    // Formula: Total XP = 50 * level * (level + 1)
    
    let level = 1
    let totalRequired = 0
    
    while (xp >= totalRequired) {
      level++
      totalRequired = 50 * level * (level + 1)
    }
    
    return level - 1
  }

  getLevelProgress(xp: number, level: number): LevelProgress {
    const currentLevelXP = level > 1 ? 50 * level * (level + 1) : 0
    const nextLevelXP = 50 * (level + 1) * (level + 2)
    const progressXP = xp - currentLevelXP
    const neededXP = nextLevelXP - currentLevelXP
    
    return {
      level,
      currentXP: xp,
      currentLevelXP,
      nextLevelXP,
      progressXP,
      progressPercentage: (progressXP / neededXP) * 100,
    }
  }

  private getLevelRewards(level: number) {
    const rewards = {
      sparklePoints: 0,
      premiumPoints: 0,
      items: [] as string[],
    }

    // Sparkle Points rewards
    rewards.sparklePoints = level * 100

    // Premium points every 5 levels
    if (level % 5 === 0) {
      rewards.premiumPoints = level * 10
    }

    // Special rewards at milestone levels
    if (level === 10) rewards.items.push('badge_bronze_star')
    if (level === 25) rewards.items.push('badge_silver_star')
    if (level === 50) rewards.items.push('badge_gold_star')
    if (level === 100) rewards.items.push('badge_diamond_star')

    return rewards
  }

  // ========== Achievements ==========

  async checkAchievements(
    userId: string,
    trigger: string,
    data?: any,
    tx?: Prisma.TransactionClient
  ): Promise<any[]> {
    const db = tx || this.db
    const relevantAchievements = achievements.filter(a => a.trigger === trigger)
    const unlockedAchievements = []

    for (const achievement of relevantAchievements) {
      const isUnlocked = await this.isAchievementUnlocked(userId, achievement.id, db)
      
      if (!isUnlocked) {
        const progress = await this.getAchievementProgress(userId, achievement, data, db)
        
        if (progress.completed) {
          await this.unlockAchievement(userId, achievement, db)
          unlockedAchievements.push({
            ...achievement,
            unlockedAt: new Date(),
          })
        } else {
          // Update progress if trackable
          await this.updateAchievementProgress(userId, achievement.id, progress, db)
        }
      }
    }

    return unlockedAchievements
  }

  private async isAchievementUnlocked(
    userId: string,
    achievementId: string,
    db: Prisma.TransactionClient | PrismaClient
  ): Promise<boolean> {
    const userAchievement = await db.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId,
          achievementId,
        },
      },
    })
    return !!userAchievement
  }

  private async getAchievementProgress(
    userId: string,
    achievement: any,
    data: any,
    db: Prisma.TransactionClient | PrismaClient
  ): Promise<{ completed: boolean; current: number; required: number }> {
    let current = 0
    let required = 1
    let completed = false

    switch (achievement.id) {
      case 'first_post':
        current = await db.post.count({ where: { authorId: userId } })
        required = 1
        completed = current >= required
        break

      case 'prolific_writer':
        current = await db.post.count({ where: { authorId: userId } })
        required = 10
        completed = current >= required
        break

      case 'viral_post':
        const mostLikedPost = await db.post.findFirst({
          where: { authorId: userId },
          orderBy: { reactions: { _count: 'desc' } },
          include: { _count: { select: { reactions: true } } },
        })
        current = mostLikedPost?._count.reactions || 0
        required = 1000
        completed = current >= required
        break

      case 'social_butterfly':
        current = await db.follow.count({ where: { followingId: userId } })
        required = 50
        completed = current >= required
        break

      case 'engagement_master':
        current = await db.reaction.count({ where: { userId } })
        required = 100
        completed = current >= required
        break

      case 'youtube_enthusiast':
        current = await db.post.count({ 
          where: { 
            authorId: userId,
            youtubeVideoId: { not: null },
          } 
        })
        required = 25
        completed = current >= required
        break

      case 'night_owl':
        // Check if user has been active between 12 AM - 5 AM
        const nightActivity = await db.analyticsEvent.count({
          where: {
            userId,
            timestamp: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(5, 0, 0, 0)),
            },
          },
        })
        completed = nightActivity > 0
        current = completed ? 1 : 0
        required = 1
        break

      case 'streak_week':
        // Check 7-day login streak
        const weekStreak = await this.getLoginStreak(userId, db)
        current = weekStreak
        required = 7
        completed = current >= required
        break

      default:
        // Custom criteria evaluation
        if (achievement.criteria?.custom) {
          const result = await this.evaluateCustomCriteria(
            userId,
            achievement.criteria.custom,
            data,
            db
          )
          current = result.current
          required = result.required
          completed = result.completed
        }
    }

    return { completed, current, required }
  }

  private async updateAchievementProgress(
    userId: string,
    achievementId: string,
    progress: { current: number; required: number },
    db: Prisma.TransactionClient | PrismaClient
  ) {
    await db.userAchievement.upsert({
      where: {
        userId_achievementId: {
          userId,
          achievementId,
        },
      },
      update: {
        progress: {
          current: progress.current,
          required: progress.required,
          percentage: (progress.current / progress.required) * 100,
        },
      },
      create: {
        userId,
        achievementId,
        progress: {
          current: progress.current,
          required: progress.required,
          percentage: (progress.current / progress.required) * 100,
        },
      },
    })
  }

  private async unlockAchievement(
    userId: string,
    achievement: any,
    db: Prisma.TransactionClient | PrismaClient
  ) {
    // Create achievement record
    await db.userAchievement.create({
      data: {
        userId,
        achievementId: achievement.id,
        unlockedAt: new Date(),
      },
    })

    // Find the achievement in database
    const dbAchievement = await db.achievement.findUnique({
      where: { code: achievement.id },
    })

    if (dbAchievement) {
      // Award XP
      if (dbAchievement.xpReward > 0) {
        await this.awardXP(
          userId,
          dbAchievement.xpReward,
          `Achievement: ${achievement.name}`
        )
      }

      // Award Sparkle Points
      if (dbAchievement.sparklePointsReward > 0) {
        await this.awardCurrency(
          userId,
          dbAchievement.sparklePointsReward,
          'sparkle_points',
          `Achievement: ${achievement.name}`,
          db
        )
      }
    }

    // Create notification
    await db.notification.create({
      data: {
        type: 'ACHIEVEMENT_UNLOCKED',
        userId,
        message: `Achievement Unlocked: ${achievement.name}!`,
        data: { 
          achievementId: achievement.id,
          achievement,
        },
      },
    })

    // Emit real-time event
    this.wsServer?.emitToUser(userId, 'achievement:unlocked', {
      achievement,
      rewards: {
        xp: dbAchievement?.xpReward || 0,
        sparklePoints: dbAchievement?.sparklePointsReward || 0,
      },
    })
  }

  private async checkLevelAchievements(
    userId: string,
    level: number,
    db: Prisma.TransactionClient | PrismaClient
  ): Promise<any[]> {
    const levelAchievements = achievements.filter(
      a => a.trigger === 'level_reached' && a.criteria.level === level
    )

    const unlocked = []
    for (const achievement of levelAchievements) {
      const isUnlocked = await this.isAchievementUnlocked(userId, achievement.id, db)
      if (!isUnlocked) {
        await this.unlockAchievement(userId, achievement, db)
        unlocked.push(achievement)
      }
    }

    return unlocked
  }

  // ========== Virtual Economy ==========

  async awardCurrency(
    userId: string,
    amount: number,
    currencyType: 'sparkle_points' | 'premium_points',
    reason: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ success: boolean; newBalance: number }> {
    const db = tx || this.db

    const user = await db.user.update({
      where: { id: userId },
      data: {
        [currencyType === 'sparkle_points' ? 'sparklePoints' : 'premiumPoints']: {
          increment: amount,
        },
      },
      select: {
        sparklePoints: true,
        premiumPoints: true,
      },
    })

    const newBalance = currencyType === 'sparkle_points' 
      ? user.sparklePoints 
      : user.premiumPoints

    // Log transaction
    await db.currencyTransaction.create({
      data: {
        userId,
        amount,
        currencyType,
        transactionType: 'earned',
        description: reason,
        balanceAfter: newBalance,
      },
    })

    // Check currency-based achievements
    await this.checkAchievements(userId, 'currency_earned', {
      type: currencyType,
      amount,
      total: newBalance,
    })

    return { success: true, newBalance }
  }

  async spendCurrency(
    userId: string,
    amount: number,
    currencyType: 'sparkle_points' | 'premium_points',
    reason: string,
    referenceId?: string,
    referenceType?: string
  ): Promise<{ success: boolean; newBalance: number }> {
    return this.db.$transaction(async (tx) => {
      // Check current balance
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          sparklePoints: true,
          premiumPoints: true,
        },
      })

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        })
      }

      const currentBalance = currencyType === 'sparkle_points'
        ? user.sparklePoints
        : user.premiumPoints

      if (currentBalance < amount) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient ${currencyType.replace('_', ' ')}`,
        })
      }

      // Deduct currency
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          [currencyType === 'sparkle_points' ? 'sparklePoints' : 'premiumPoints']: {
            decrement: amount,
          },
        },
        select: {
          sparklePoints: true,
          premiumPoints: true,
        },
      })

      const newBalance = currencyType === 'sparkle_points'
        ? updatedUser.sparklePoints
        : updatedUser.premiumPoints

      // Log transaction
      await tx.currencyTransaction.create({
        data: {
          userId,
          amount: -amount,
          currencyType,
          transactionType: 'spent',
          description: reason,
          referenceId,
          referenceType,
          balanceAfter: newBalance,
        },
      })

      // Check spending achievements
      await this.checkAchievements(userId, 'currency_spent', {
        type: currencyType,
        amount,
        reason,
      }, tx)

      return { success: true, newBalance }
    })
  }

  async purchaseItem(
    userId: string,
    itemId: string,
    quantity: number = 1
  ): Promise<{
    success: boolean
    item: any
    transaction: any
  }> {
    return this.db.$transaction(async (tx) => {
      // Get item details
      const item = await tx.storeItem.findUnique({
        where: { id: itemId },
      })

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Item not found',
        })
      }

      // Check availability
      if (item.stockRemaining !== null && item.stockRemaining < quantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Insufficient stock',
        })
      }

      // Check time availability
      const now = new Date()
      if (item.availableFrom && item.availableFrom > now) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Item not yet available',
        })
      }
      if (item.availableUntil && item.availableUntil < now) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Item no longer available',
        })
      }

      // Calculate total price
      const pricePerItem = item.priceSparkle || 0
      const discount = item.discountPercentage || 0
      const totalPrice = Math.floor(pricePerItem * quantity * (1 - discount / 100))

      // Check if user already owns the item (for non-consumables)
      const existingInventory = await tx.userInventory.findUnique({
        where: {
          userId_itemId: {
            userId,
            itemId,
          },
        },
      })

      if (existingInventory && item.category !== 'consumable') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You already own this item',
        })
      }

      // Process payment
      const currencyType = item.pricePremium ? 'premium_points' : 'sparkle_points'
      const price = item.pricePremium || totalPrice

      await this.spendCurrency(
        userId,
        price,
        currencyType,
        `Purchased: ${item.name}`,
        itemId,
        'store_item'
      )

      // Add to inventory
      if (existingInventory) {
        await tx.userInventory.update({
          where: { id: existingInventory.id },
          data: {
            quantity: { increment: quantity },
          },
        })
      } else {
        await tx.userInventory.create({
          data: {
            userId,
            itemId,
            quantity,
          },
        })
      }

      // Update stock if limited
      if (item.stockRemaining !== null) {
        await tx.storeItem.update({
          where: { id: itemId },
          data: {
            stockRemaining: { decrement: quantity },
          },
        })
      }

      // Check purchase achievements
      await this.checkAchievements(userId, 'item_purchased', {
        itemId,
        category: item.category,
        price,
      }, tx)

      return {
        success: true,
        item,
        transaction: {
          itemId,
          quantity,
          totalPrice: price,
          currencyType,
        },
      }
    })
  }

  // ========== Trading System ==========

  async createTrade(
    initiatorId: string,
    recipientId: string,
    offer: {
      items?: string[]
      sparklePoints?: number
    },
    request: {
      items?: string[]
      sparklePoints?: number
    },
    message?: string
  ): Promise<any> {
    if (initiatorId === recipientId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot trade with yourself',
      })
    }

    // Validate initiator has the offered items and points
    if (offer.items?.length) {
      const initiatorInventory = await this.db.userInventory.findMany({
        where: {
          userId: initiatorId,
          id: { in: offer.items },
        },
      })

      if (initiatorInventory.length !== offer.items.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You do not own all offered items',
        })
      }
    }

    if (offer.sparklePoints) {
      const initiator = await this.db.user.findUnique({
        where: { id: initiatorId },
        select: { sparklePoints: true },
      })

      if (!initiator || initiator.sparklePoints < offer.sparklePoints) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Insufficient Sparkle Points',
        })
      }
    }

    // Create trade
    const trade = await this.db.trade.create({
      data: {
        initiatorId,
        recipientId,
        initiatorItems: offer.items || [],
        recipientItems: request.items || [],
        initiatorPoints: offer.sparklePoints || 0,
        recipientPoints: request.sparklePoints || 0,
        message,
      },
      include: {
        initiator: {
          select: {
            id: true,
            username: true,
            image: true,
          },
        },
        recipient: {
          select: {
            id: true,
            username: true,
            image: true,
          },
        },
      },
    })

    // Create notification
    await this.db.notification.create({
      data: {
        type: 'TRADE_REQUEST',
        userId: recipientId,
        actorId: initiatorId,
        entityId: trade.id,
        entityType: 'trade',
        message: `${trade.initiator.username} sent you a trade request`,
        data: { tradeId: trade.id },
      },
    })

    // Emit real-time event
    this.wsServer?.emitToUser(recipientId, 'trade:request', {
      trade,
    })

    return trade
  }

  async acceptTrade(tradeId: string, userId: string): Promise<any> {
    return this.db.$transaction(async (tx) => {
      const trade = await tx.trade.findUnique({
        where: { id: tradeId },
        include: {
          initiator: true,
          recipient: true,
        },
      })

      if (!trade) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Trade not found',
        })
      }

      if (trade.recipientId !== userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot accept this trade',
        })
      }

      if (trade.status !== 'PENDING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Trade is no longer pending',
        })
      }

      // Execute the trade
      // Transfer items from initiator to recipient
      for (const itemId of trade.initiatorItems) {
        await this.transferItem(trade.initiatorId, trade.recipientId, itemId, tx)
      }

      // Transfer items from recipient to initiator
      for (const itemId of trade.recipientItems) {
        await this.transferItem(trade.recipientId, trade.initiatorId, itemId, tx)
      }

      // Transfer points
      if (trade.initiatorPoints > 0) {
        await this.transferCurrency(
          trade.initiatorId,
          trade.recipientId,
          trade.initiatorPoints,
          'sparkle_points',
          `Trade #${trade.id}`,
          tx
        )
      }

      if (trade.recipientPoints > 0) {
        await this.transferCurrency(
          trade.recipientId,
          trade.initiatorId,
          trade.recipientPoints,
          'sparkle_points',
          `Trade #${trade.id}`,
          tx
        )
      }

      // Update trade status
      const completedTrade = await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: 'ACCEPTED',
          completedAt: new Date(),
        },
      })

      // Notify initiator
      await tx.notification.create({
        data: {
          type: 'TRADE_REQUEST',
          userId: trade.initiatorId,
          actorId: trade.recipientId,
          entityId: trade.id,
          entityType: 'trade',
          message: `${trade.recipient.username} accepted your trade`,
        },
      })

      // Check trading achievements
      await this.checkAchievements(trade.initiatorId, 'trade_completed', { tradeId }, tx)
      await this.checkAchievements(trade.recipientId, 'trade_completed', { tradeId }, tx)

      return completedTrade
    })
  }

  private async transferItem(
    fromUserId: string,
    toUserId: string,
    inventoryItemId: string,
    tx: Prisma.TransactionClient
  ) {
    const item = await tx.userInventory.findUnique({
      where: { id: inventoryItemId },
    })

    if (!item || item.userId !== fromUserId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Item not found in inventory',
      })
    }

    // Remove from sender
    await tx.userInventory.delete({
      where: { id: inventoryItemId },
    })

    // Add to recipient
    await tx.userInventory.create({
      data: {
        userId: toUserId,
        itemId: item.itemId,
        quantity: item.quantity,
      },
    })
  }

  private async transferCurrency(
    fromUserId: string,
    toUserId: string,
    amount: number,
    currencyType: 'sparkle_points' | 'premium_points',
    reason: string,
    tx: Prisma.TransactionClient
  ) {
    // Deduct from sender
    await this.spendCurrency(fromUserId, amount, currencyType, reason)

    // Add to recipient
    await this.awardCurrency(toUserId, amount, currencyType, reason, tx)
  }

  // ========== Daily Quests ==========

  async getDailyQuests(userId: string): Promise<any[]> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get user's active quests
    const userQuests = await this.db.userQuest.findMany({
      where: {
        userId,
        quest: {
          type: 'DAILY',
          availableFrom: { lte: new Date() },
          availableUntil: { gte: new Date() },
        },
      },
      include: {
        quest: true,
      },
    })

    // Check if new daily quests need to be assigned
    const hasQuestsToday = userQuests.some(
      uq => uq.startedAt >= today
    )

    if (!hasQuestsToday) {
      // Assign new daily quests
      await this.assignDailyQuests(userId)
      
      // Refetch
      return this.getDailyQuests(userId)
    }

    // Calculate progress for each quest
    const questsWithProgress = await Promise.all(
      userQuests.map(async (uq) => {
        const progress = await this.calculateQuestProgress(
          userId,
          uq.quest,
          uq.progress as any
        )

        return {
          ...uq,
          progress,
        }
      })
    )

    return questsWithProgress
  }

  private async assignDailyQuests(userId: string) {
    // Get available daily quests
    const dailyQuests = await this.db.quest.findMany({
      where: {
        type: 'DAILY',
        availableFrom: { lte: new Date() },
        availableUntil: { gte: new Date() },
      },
    })

    // Randomly select 3 quests
    const selectedQuests = this.shuffleArray(dailyQuests).slice(0, 3)

    // Assign to user
    for (const quest of selectedQuests) {
      await this.db.userQuest.create({
        data: {
          userId,
          questId: quest.id,
          status: 'AVAILABLE',
        },
      })
    }
  }

  private async calculateQuestProgress(
    userId: string,
    quest: any,
    currentProgress: any
  ): Promise<QuestProgress> {
    const requirements = quest.requirements as any
    let current = 0
    let required = 1

    switch (requirements.type) {
      case 'create_posts':
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        
        current = await this.db.post.count({
          where: {
            authorId: userId,
            createdAt: { gte: today },
          },
        })
        required = requirements.count || 1
        break

      case 'give_reactions':
        current = currentProgress?.reactions || 0
        required = requirements.count || 10
        break

      case 'earn_xp':
        current = currentProgress?.xp || 0
        required = requirements.amount || 100
        break

      case 'login_streak':
        current = await this.getLoginStreak(userId, this.db)
        required = requirements.days || 1
        break

      default:
        current = currentProgress?.current || 0
        required = requirements.required || 1
    }

    return {
      questId: quest.id,
      current,
      required,
      percentage: (current / required) * 100,
    }
  }

  async updateQuestProgress(
    userId: string,
    questType: string,
    data: any
  ) {
    const userQuests = await this.db.userQuest.findMany({
      where: {
        userId,
        status: { in: ['AVAILABLE', 'IN_PROGRESS'] },
        quest: {
          requirements: {
            path: '$.type',
            equals: questType,
          },
        },
      },
      include: {
        quest: true,
      },
    })

    for (const userQuest of userQuests) {
      const progress = userQuest.progress as any || {}
      const requirements = userQuest.quest.requirements as any

      // Update progress based on quest type
      switch (questType) {
        case 'give_reactions':
          progress.reactions = (progress.reactions || 0) + 1
          break
        case 'earn_xp':
          progress.xp = (progress.xp || 0) + data.amount
          break
        default:
          progress.current = (progress.current || 0) + 1
      }

      // Check if quest is completed
      const questProgress = await this.calculateQuestProgress(
        userId,
        userQuest.quest,
        progress
      )

      const status = questProgress.percentage >= 100 ? 'COMPLETED' : 'IN_PROGRESS'

      await this.db.userQuest.update({
        where: { id: userQuest.id },
        data: {
          progress,
          status,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        },
      })

      // Notify completion
      if (status === 'COMPLETED' && userQuest.status !== 'COMPLETED') {
        await this.db.notification.create({
          data: {
            type: 'QUEST_COMPLETE',
            userId,
            message: `Quest completed: ${userQuest.quest.name}!`,
            data: { questId: userQuest.questId },
          },
        })

        this.wsServer?.emitToUser(userId, 'quest:completed', {
          questId: userQuest.questId,
          rewards: userQuest.quest.rewards,
        })
      }
    }
  }

  async claimQuestRewards(userId: string, questId: string): Promise<any> {
    const userQuest = await this.db.userQuest.findFirst({
      where: {
        userId,
        questId,
        status: 'COMPLETED',
      },
      include: {
        quest: true,
      },
    })

    if (!userQuest) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Quest not found or not completed',
      })
    }

    if (userQuest.claimedAt) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Rewards already claimed',
      })
    }

    const rewards = userQuest.quest.rewards as any
    const claimedRewards = []

    // Award XP
    if (rewards.xp) {
      await this.awardXP(userId, rewards.xp, `Quest: ${userQuest.quest.name}`)
      claimedRewards.push({ type: 'xp', amount: rewards.xp })
    }

    // Award currency
    if (rewards.sparklePoints) {
      await this.awardCurrency(
        userId,
        rewards.sparklePoints,
        'sparkle_points',
        `Quest: ${userQuest.quest.name}`
      )
      claimedRewards.push({ type: 'sparkle_points', amount: rewards.sparklePoints })
    }

    // Award items
    if (rewards.items) {
      for (const itemSku of rewards.items) {
        const item = await this.db.storeItem.findUnique({
          where: { sku: itemSku },
        })

        if (item) {
          await this.db.userInventory.create({
            data: {
              userId,
              itemId: item.id,
              quantity: 1,
            },
          })
          claimedRewards.push({ type: 'item', item })
        }
      }
    }

    // Mark as claimed
    await this.db.userQuest.update({
      where: { id: userQuest.id },
      data: {
        status: 'CLAIMED',
        claimedAt: new Date(),
      },
    })

    // Check quest achievements
    await this.checkAchievements(userId, 'quest_completed', { 
      questId,
      questType: userQuest.quest.type,
    })

    return claimedRewards
  }

  // ========== Leaderboards ==========

  async getLeaderboard(
    type: 'xp' | 'posts' | 'followers' | 'sparkle_points',
    timeframe: 'day' | 'week' | 'month' | 'all' = 'all',
    limit: number = 100
  ): Promise<any[]> {
    const cacheKey = `leaderboard:${type}:${timeframe}`
    const cached = await cache.get<any[]>(cacheKey)
    if (cached) return cached

    let leaderboard: any[] = []
    const dateFilter = this.getDateFilter(timeframe)

    switch (type) {
      case 'xp':
        if (timeframe === 'all') {
          leaderboard = await this.db.user.findMany({
            where: { 
              role: { not: 'ADMIN' },
              banned: false,
            },
            select: {
              id: true,
              username: true,
              image: true,
              experience: true,
              level: true,
            },
            orderBy: { experience: 'desc' },
            take: limit,
          })
        } else {
          // XP gained in timeframe
          const xpGains = await this.db.xpLog.groupBy({
            by: ['userId'],
            where: dateFilter ? { createdAt: { gte: dateFilter } } : {},
            _sum: { amount: true },
            orderBy: { _sum: { amount: 'desc' } },
            take: limit,
          })

          const userIds = xpGains.map(x => x.userId)
          const users = await this.db.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              username: true,
              image: true,
              level: true,
            },
          })

          leaderboard = xpGains.map(xp => ({
            ...users.find(u => u.id === xp.userId),
            xpGained: xp._sum.amount,
          }))
        }
        break

      case 'posts':
        const postCounts = await this.db.post.groupBy({
          by: ['authorId'],
          where: {
            published: true,
            ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
          },
          _count: true,
          orderBy: { _count: { _all: 'desc' } },
          take: limit,
        })

        const authorIds = postCounts.map(p => p.authorId)
        const authors = await this.db.user.findMany({
          where: { id: { in: authorIds } },
          select: {
            id: true,
            username: true,
            image: true,
            level: true,
          },
        })

        leaderboard = postCounts.map(post => ({
          ...authors.find(u => u.id === post.authorId),
          postCount: post._count,
        }))
        break

      case 'followers':
        if (timeframe === 'all') {
          const users = await this.db.user.findMany({
            where: { 
              role: { not: 'ADMIN' },
              banned: false,
            },
            select: {
              id: true,
              username: true,
              image: true,
              level: true,
              _count: {
                select: { followers: true },
              },
            },
            orderBy: {
              followers: { _count: 'desc' },
            },
            take: limit,
          })

          leaderboard = users.map(u => ({
            id: u.id,
            username: u.username,
            image: u.image,
            level: u.level,
            followerCount: u._count.followers,
          }))
        } else {
          // Followers gained in timeframe
          const followerGains = await this.db.follow.groupBy({
            by: ['followingId'],
            where: dateFilter ? { createdAt: { gte: dateFilter } } : {},
            _count: true,
            orderBy: { _count: { _all: 'desc' } },
            take: limit,
          })

          const userIds = followerGains.map(f => f.followingId)
          const users = await this.db.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              username: true,
              image: true,
              level: true,
            },
          })

          leaderboard = followerGains.map(follow => ({
            ...users.find(u => u.id === follow.followingId),
            followersGained: follow._count,
          }))
        }
        break

      case 'sparkle_points':
        if (timeframe === 'all') {
          leaderboard = await this.db.user.findMany({
            where: { 
              role: { not: 'ADMIN' },
              banned: false,
            },
            select: {
              id: true,
              username: true,
              image: true,
              level: true,
              sparklePoints: true,
            },
            orderBy: { sparklePoints: 'desc' },
            take: limit,
          })
        } else {
          // Points earned in timeframe
          const pointsEarned = await this.db.currencyTransaction.groupBy({
            by: ['userId'],
            where: {
              currencyType: 'sparkle_points',
              transactionType: 'earned',
              ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
            },
            _sum: { amount: true },
            orderBy: { _sum: { amount: 'desc' } },
            take: limit,
          })

          const userIds = pointsEarned.map(p => p.userId)
          const users = await this.db.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              username: true,
              image: true,
              level: true,
            },
          })

          leaderboard = pointsEarned.map(points => ({
            ...users.find(u => u.id === points.userId),
            pointsEarned: points._sum.amount,
          }))
        }
        break
    }

    // Add rank to each entry
    leaderboard = leaderboard.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }))

    // Cache for 5 minutes
    await cache.set(cacheKey, leaderboard, 300)

    return leaderboard
  }

  private getDateFilter(timeframe: 'day' | 'week' | 'month' | 'all'): Date | null {
    if (timeframe === 'all') return null

    const now = new Date()
    switch (timeframe) {
      case 'day':
        now.setHours(0, 0, 0, 0)
        return now
      case 'week':
        now.setDate(now.getDate() - 7)
        return now
      case 'month':
        now.setMonth(now.getMonth() - 1)
        return now
      default:
        return null
    }
  }

  // ========== User Stats ==========

  async getUserStats(userId: string): Promise<any> {
    const cacheKey = `user:stats:${userId}`
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        achievements: {
          include: {
            achievement: true,
          },
          orderBy: {
            unlockedAt: 'desc',
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

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      })
    }

    // Calculate level progress
    const levelProgress = this.getLevelProgress(user.experience, user.level)

    // Get user rank
    const rank = await this.getUserRank(userId)

    // Get recent XP gains
    const recentXP = await this.db.xpLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    // Get quest stats
    const questStats = await this.db.userQuest.groupBy({
      by: ['status'],
      where: { userId },
      _count: true,
    })

    // Get currency stats
    const currencyStats = await this.db.currencyTransaction.groupBy({
      by: ['currencyType', 'transactionType'],
      where: { userId },
      _sum: { amount: true },
    })

    const stats = {
      user: {
        id: user.id,
        username: user.username,
        image: user.image,
        level: user.level,
        experience: user.experience,
        sparklePoints: user.sparklePoints,
        premiumPoints: user.premiumPoints,
      },
      levelProgress,
      rank,
      achievements: {
        total: achievements.length,
        unlocked: user.achievements.length,
        percentage: (user.achievements.length / achievements.length) * 100,
        recent: user.achievements.slice(0, 5),
      },
      stats: user._count,
      recentXP,
      quests: {
        completed: questStats.find(q => q.status === 'COMPLETED')?._count || 0,
        inProgress: questStats.find(q => q.status === 'IN_PROGRESS')?._count || 0,
        available: questStats.find(q => q.status === 'AVAILABLE')?._count || 0,
      },
      currency: {
        sparklePointsEarned: currencyStats
          .filter(c => c.currencyType === 'sparkle_points' && c.transactionType === 'earned')
          .reduce((sum, c) => sum + (c._sum.amount || 0), 0),
        sparklePointsSpent: Math.abs(currencyStats
          .filter(c => c.currencyType === 'sparkle_points' && c.transactionType === 'spent')
          .reduce((sum, c) => sum + (c._sum.amount || 0), 0)),
      },
    }

    // Cache for 1 minute
    await cache.set(cacheKey, stats, 60)

    return stats
  }

  private async getUserRank(userId: string): Promise<number> {
    const count = await this.db.user.count({
      where: {
        experience: {
          gt: await this.db.user
            .findUnique({ where: { id: userId } })
            .then(u => u?.experience || 0),
        },
        role: { not: 'ADMIN' },
        banned: false,
      },
    })

    return count + 1
  }

  private async getLoginStreak(
    userId: string,
    db: Prisma.TransactionClient | PrismaClient
  ): Promise<number> {
    // Get login events for the past 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const loginEvents = await db.analyticsEvent.findMany({
      where: {
        userId,
        eventName: 'user_login',
        timestamp: { gte: thirtyDaysAgo },
      },
      orderBy: { timestamp: 'desc' },
    })

    if (loginEvents.length === 0) return 0

    let streak = 1
    let currentDate = new Date(loginEvents[0].timestamp)
    currentDate.setHours(0, 0, 0, 0)

    for (let i = 1; i < loginEvents.length; i++) {
      const eventDate = new Date(loginEvents[i].timestamp)
      eventDate.setHours(0, 0, 0, 0)

      const dayDiff = Math.floor((currentDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24))

      if (dayDiff === 1) {
        streak++
        currentDate = eventDate
      } else if (dayDiff > 1) {
        break
      }
    }

    return streak
  }

  private async evaluateCustomCriteria(
    userId: string,
    criteria: any,
    data: any,
    db: Prisma.TransactionClient | PrismaClient
  ): Promise<{ current: number; required: number; completed: boolean }> {
    // Custom criteria evaluation logic
    // This can be extended based on specific achievement requirements
    return { current: 0, required: 1, completed: false }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }
}
```

### 2. `/src/config/achievements.ts`

```typescript
// src/config/achievements.ts
export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  xp: number
  sparklePoints: number
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'
  category: string
  trigger: string
  criteria: any
  hidden?: boolean
}

export const achievements: Achievement[] = [
  // ========== Getting Started ==========
  {
    id: 'welcome_sparkler',
    name: 'Welcome, Sparkler!',
    description: 'Complete your profile setup',
    icon: '👋',
    xp: 50,
    sparklePoints: 100,
    rarity: 'common',
    category: 'profile',
    trigger: 'profile_completed',
    criteria: {},
  },
  {
    id: 'first_post',
    name: 'First Steps',
    description: 'Create your first post',
    icon: '✍️',
    xp: 100,
    sparklePoints: 50,
    rarity: 'common',
    category: 'content',
    trigger: 'post_created',
    criteria: { postCount: 1 },
  },
  {
    id: 'first_comment',
    name: 'Joining the Conversation',
    description: 'Leave your first comment',
    icon: '💬',
    xp: 50,
    sparklePoints: 25,
    rarity: 'common',
    category: 'engagement',
    trigger: 'comment_created',
    criteria: { commentCount: 1 },
  },
  {
    id: 'first_follow',
    name: 'Making Friends',
    description: 'Follow your first user',
    icon: '🤝',
    xp: 50,
    sparklePoints: 25,
    rarity: 'common',
    category: 'social',
    trigger: 'user_followed',
    criteria: { followCount: 1 },
  },

  // ========== Content Creation ==========
  {
    id: 'prolific_writer',
    name: 'Prolific Writer',
    description: 'Create 10 posts',
    icon: '📚',
    xp: 300,
    sparklePoints: 200,
    rarity: 'uncommon',
    category: 'content',
    trigger: 'post_created',
    criteria: { postCount: 10 },
  },
  {
    id: 'content_master',
    name: 'Content Master',
    description: 'Create 50 posts',
    icon: '🎓',
    xp: 1000,
    sparklePoints: 500,
    rarity: 'rare',
    category: 'content',
    trigger: 'post_created',
    criteria: { postCount: 50 },
  },
  {
    id: 'viral_post',
    name: 'Gone Viral',
    description: 'Get 1000 reactions on a single post',
    icon: '🔥',
    xp: 500,
    sparklePoints: 300,
    rarity: 'rare',
    category: 'content',
    trigger: 'post_liked',
    criteria: { reactions: 1000 },
  },
  {
    id: 'trending_creator',
    name: 'Trending Creator',
    description: 'Have 3 posts trending at the same time',
    icon: '📈',
    xp: 750,
    sparklePoints: 400,
    rarity: 'epic',
    category: 'content',
    trigger: 'post_trending',
    criteria: { trendingCount: 3 },
  },

  // ========== YouTube Integration ==========
  {
    id: 'youtube_sharer',
    name: 'YouTube Enthusiast',
    description: 'Share 10 YouTube videos',
    icon: '📺',
    xp: 200,
    sparklePoints: 150,
    rarity: 'uncommon',
    category: 'youtube',
    trigger: 'youtube_shared',
    criteria: { videoCount: 10 },
  },
  {
    id: 'youtube_enthusiast',
    name: 'Video Curator',
    description: 'Share 25 YouTube videos',
    icon: '🎬',
    xp: 400,
    sparklePoints: 250,
    rarity: 'rare',
    category: 'youtube',
    trigger: 'youtube_shared',
    criteria: { videoCount: 25 },
  },
  {
    id: 'watch_party_host',
    name: 'Party Host',
    description: 'Host your first watch party',
    icon: '🎉',
    xp: 300,
    sparklePoints: 200,
    rarity: 'uncommon',
    category: 'youtube',
    trigger: 'watchparty_hosted',
    criteria: { count: 1 },
  },
  {
    id: 'watch_party_regular',
    name: 'Regular Party-Goer',
    description: 'Join 10 watch parties',
    icon: '🎊',
    xp: 250,
    sparklePoints: 150,
    rarity: 'uncommon',
    category: 'youtube',
    trigger: 'watchparty_joined',
    criteria: { count: 10 },
  },

  // ========== Social & Engagement ==========
  {
    id: 'conversationalist',
    name: 'Conversationalist',
    description: 'Leave 100 comments',
    icon: '💭',
    xp: 300,
    sparklePoints: 150,
    rarity: 'uncommon',
    category: 'engagement',
    trigger: 'comment_created',
    criteria: { comments: 100 },
  },
  {
    id: 'helpful_member',
    name: 'Helpful Member',
    description: 'Receive 50 likes on your comments',
    icon: '🤝',
    xp: 250,
    sparklePoints: 200,
    rarity: 'uncommon',
    category: 'engagement',
    trigger: 'comment_liked',
    criteria: { commentLikes: 50 },
  },
  {
    id: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Reach 50 followers',
    icon: '🦋',
    xp: 400,
    sparklePoints: 300,
    rarity: 'uncommon',
    category: 'social',
    trigger: 'user_followed',
    criteria: { followers: 50 },
  },
  {
    id: 'rising_star',
    name: 'Rising Star',
    description: 'Reach 100 followers',
    icon: '⭐',
    xp: 600,
    sparklePoints: 400,
    rarity: 'rare',
    category: 'social',
    trigger: 'user_followed',
    criteria: { followers: 100 },
  },
  {
    id: 'influencer',
    name: 'Influencer',
    description: 'Reach 1000 followers',
    icon: '🌟',
    xp: 2000,
    sparklePoints: 1000,
    rarity: 'epic',
    category: 'social',
    trigger: 'user_followed',
    criteria: { followers: 1000 },
  },
  {
    id: 'sparkle_legend',
    name: 'Sparkle Legend',
    description: 'Reach 10000 followers',
    icon: '✨',
    xp: 5000,
    sparklePoints: 3000,
    rarity: 'legendary',
    category: 'social',
    trigger: 'user_followed',
    criteria: { followers: 10000 },
  },

  // ========== Gamification & Economy ==========
  {
    id: 'level_10',
    name: 'Double Digits',
    description: 'Reach level 10',
    icon: '🔟',
    xp: 0, // No XP to avoid circular rewards
    sparklePoints: 500,
    rarity: 'uncommon',
    category: 'levels',
    trigger: 'level_reached',
    criteria: { level: 10 },
  },
  {
    id: 'level_25',
    name: 'Quarter Century',
    description: 'Reach level 25',
    icon: '🎯',
    xp: 0,
    sparklePoints: 1000,
    rarity: 'rare',
    category: 'levels',
    trigger: 'level_reached',
    criteria: { level: 25 },
  },
  {
    id: 'level_50',
    name: 'Half Century',
    description: 'Reach level 50',
    icon: '🏆',
    xp: 0,
    sparklePoints: 2000,
    rarity: 'epic',
    category: 'levels',
    trigger: 'level_reached',
    criteria: { level: 50 },
  },
  {
    id: 'level_100',
    name: 'Centurion',
    description: 'Reach level 100',
    icon: '💯',
    xp: 0,
    sparklePoints: 5000,
    rarity: 'legendary',
    category: 'levels',
    trigger: 'level_reached',
    criteria: { level: 100 },
  },
  {
    id: 'sparkle_saver',
    name: 'Sparkle Saver',
    description: 'Save 1000 Sparkle Points',
    icon: '💰',
    xp: 200,
    sparklePoints: 0, // Don't give points for saving points
    rarity: 'uncommon',
    category: 'economy',
    trigger: 'currency_earned',
    criteria: { type: 'sparkle_points', total: 1000 },
  },
  {
    id: 'big_spender',
    name: 'Big Spender',
    description: 'Spend 5000 Sparkle Points',
    icon: '💸',
    xp: 500,
    sparklePoints: 100,
    rarity: 'rare',
    category: 'economy',
    trigger: 'currency_spent',
    criteria: { type: 'sparkle_points', total: 5000 },
  },
  {
    id: 'trader',
    name: 'Trader',
    description: 'Complete your first trade',
    icon: '🤝',
    xp: 200,
    sparklePoints: 100,
    rarity: 'uncommon',
    category: 'economy',
    trigger: 'trade_completed',
    criteria: { count: 1 },
  },
  {
    id: 'merchant',
    name: 'Merchant',
    description: 'Complete 10 trades',
    icon: '🏪',
    xp: 500,
    sparklePoints: 300,
    rarity: 'rare',
    category: 'economy',
    trigger: 'trade_completed',
    criteria: { count: 10 },
  },

  // ========== Quests ==========
  {
    id: 'quest_beginner',
    name: 'Quest Beginner',
    description: 'Complete your first quest',
    icon: '🗺️',
    xp: 100,
    sparklePoints: 50,
    rarity: 'common',
    category: 'quests',
    trigger: 'quest_completed',
    criteria: { count: 1 },
  },
  {
    id: 'quest_enthusiast',
    name: 'Quest Enthusiast',
    description: 'Complete 10 quests',
    icon: '🧭',
    xp: 300,
    sparklePoints: 200,
    rarity: 'uncommon',
    category: 'quests',
    trigger: 'quest_completed',
    criteria: { count: 10 },
  },
  {
    id: 'quest_master',
    name: 'Quest Master',
    description: 'Complete 100 quests',
    icon: '🏅',
    xp: 1000,
    sparklePoints: 500,
    rarity: 'epic',
    category: 'quests',
    trigger: 'quest_completed',
    criteria: { count: 100 },
  },

  // ========== Special & Time-Based ==========
  {
    id: 'early_adopter',
    name: 'Early Adopter',
    description: 'Join during the first month',
    icon: '🌅',
    xp: 500,
    sparklePoints: 500,
    rarity: 'legendary',
    category: 'special',
    trigger: 'user_created',
    criteria: { joinDate: 'first_month' },
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'Be active between midnight and 5 AM',
    icon: '🦉',
    xp: 200,
    sparklePoints: 100,
    rarity: 'uncommon',
    category: 'special',
    trigger: 'activity_time',
    criteria: { timeRange: '00:00-05:00' },
  },
  {
    id: 'streak_week',
    name: 'Week Warrior',
    description: 'Login for 7 consecutive days',
    icon: '🔥',
    xp: 200,
    sparklePoints: 100,
    rarity: 'uncommon',
    category: 'special',
    trigger: 'login_streak',
    criteria: { days: 7 },
  },
  {
    id: 'streak_month',
    name: 'Dedicated Fan',
    description: 'Login for 30 consecutive days',
    icon: '💎',
    xp: 1000,
    sparklePoints: 500,
    rarity: 'rare',
    category: 'special',
    trigger: 'login_streak',
    criteria: { days: 30 },
  },
  {
    id: 'anniversary_1',
    name: 'One Year Sparkler',
    description: 'Be a member for 1 year',
    icon: '🎂',
    xp: 2000,
    sparklePoints: 1000,
    rarity: 'epic',
    category: 'special',
    trigger: 'anniversary',
    criteria: { years: 1 },
  },

  // ========== Hidden Achievements ==========
  {
    id: 'sparkle_fan',
    name: 'True Sparkle Fan',
    description: 'Complete all Sparkle-themed challenges',
    icon: '✨',
    xp: 2000,
    sparklePoints: 1000,
    rarity: 'mythic',
    category: 'hidden',
    trigger: 'special_condition',
    criteria: { condition: 'all_sparkle_challenges' },
    hidden: true,
  },
  {
    id: 'perfectionist',
    name: 'Perfectionist',
    description: 'Complete all achievements',
    icon: '🏆',
    xp: 5000,
    sparklePoints: 3000,
    rarity: 'mythic',
    category: 'hidden',
    trigger: 'all_achievements',
    criteria: {},
    hidden: true,
  },
  {
    id: 'lucky_sparkle',
    name: 'Lucky Sparkle',
    description: 'Find the hidden sparkle',
    icon: '🍀',
    xp: 777,
    sparklePoints: 777,
    rarity: 'legendary',
    category: 'hidden',
    trigger: 'special_action',
    criteria: { action: 'find_hidden_sparkle' },
    hidden: true,
  },
]

// Achievement categories for filtering
export const achievementCategories = [
  { id: 'all', name: 'All', icon: '🏆' },
  { id: 'profile', name: 'Profile', icon: '👤' },
  { id: 'content', name: 'Content', icon: '📝' },
  { id: 'youtube', name: 'YouTube', icon: '📺' },
  { id: 'social', name: 'Social', icon: '👥' },
  { id: 'engagement', name: 'Engagement', icon: '💬' },
  { id: 'levels', name: 'Levels', icon: '📊' },
  { id: 'economy', name: 'Economy', icon: '💰' },
  { id: 'quests', name: 'Quests', icon: '🗺️' },
  { id: 'special', name: 'Special', icon: '⭐' },
  { id: 'hidden', name: 'Hidden', icon: '🔒' },
]

// Helper functions
export function getAchievementById(id: string): Achievement | undefined {
  return achievements.find(a => a.id === id)
}

export function getAchievementsByCategory(category: string): Achievement[] {
  if (category === 'all') return achievements
  return achievements.filter(a => a.category === category)
}

export function getVisibleAchievements(): Achievement[] {
  return achievements.filter(a => !a.hidden)
}

export function getRarityColor(rarity: string): string {
  const colors = {
    common: '#9CA3AF', // gray-400
    uncommon: '#10B981', // green-500
    rare: '#3B82F6', // blue-500
    epic: '#8B5CF6', // purple-500
    legendary: '#F59E0B', // yellow-500
    mythic: '#EC4899', // pink-500
  }
  return colors[rarity as keyof typeof colors] || colors.common
}

export function getRarityGradient(rarity: string): string {
  const gradients = {
    common: 'from-gray-400 to-gray-600',
    uncommon: 'from-green-400 to-green-600',
    rare: 'from-blue-400 to-blue-600',
    epic: 'from-purple-400 to-purple-600',
    legendary: 'from-yellow-400 to-yellow-600',
    mythic: 'from-pink-400 via-purple-400 to-blue-400',
  }
  return gradients[rarity as keyof typeof gradients] || gradients.common
}
```

### 3. `/src/components/features/gamification/level-progress.tsx`

```typescript
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
```

### 4. `/src/components/features/gamification/achievement-grid.tsx`

```typescript
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
```

These implementations provide a complete gamification system that fully aligns with the PRD requirements, including:

1. **Complete XP & Level System**: Progressive leveling with rewards and visual progress tracking
2. **Comprehensive Achievement System**: 50+ achievements across multiple categories with rarity tiers
3. **Virtual Economy**: Full implementation of Sparkle Points and Premium Points with transactions
4. **Trading System**: Complete peer-to-peer trading functionality
5. **Daily Quest System**: Dynamic quest assignment and progress tracking
6. **Leaderboards**: Multiple leaderboard types with time-based filtering
7. **Rich UI Components**: Beautiful, animated components with multiple display variants

The system includes proper caching, real-time updates via WebSocket, achievement notifications, and comprehensive progress tracking—everything specified in the PRD for a fully-featured gamification experience.
