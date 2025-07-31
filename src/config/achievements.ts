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
