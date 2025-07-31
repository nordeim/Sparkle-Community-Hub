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
