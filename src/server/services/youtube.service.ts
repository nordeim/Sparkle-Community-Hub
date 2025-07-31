// src/server/services/youtube.service.ts
import { google, youtube_v3 } from 'googleapis'
import { cache } from '@/lib/cache'
import { db } from '@/lib/db'
import { TRPCError } from '@trpc/server'

interface VideoDetails {
  id: string
  title: string
  description: string
  thumbnail: {
    default: string
    medium: string
    high: string
    maxres?: string
  }
  channelId: string
  channelTitle: string
  duration: number // in seconds
  viewCount: number
  likeCount: number
  commentCount: number
  publishedAt: Date
  tags: string[]
  categoryId: string
  liveBroadcastContent: 'none' | 'live' | 'upcoming'
  statistics: {
    viewCount: string
    likeCount: string
    dislikeCount?: string
    favoriteCount: string
    commentCount: string
  }
  contentDetails: {
    duration: string
    dimension: string
    definition: string
    caption: string
  }
}

interface ChannelDetails {
  id: string
  title: string
  description: string
  customUrl?: string
  thumbnail: {
    default: string
    medium: string
    high: string
  }
  subscriberCount: number
  videoCount: number
  viewCount: number
  country?: string
  publishedAt: Date
  statistics: {
    viewCount: string
    subscriberCount: string
    hiddenSubscriberCount: boolean
    videoCount: string
  }
  brandingSettings?: {
    channel: {
      title: string
      description: string
      keywords?: string
    }
    image?: {
      bannerExternalUrl: string
    }
  }
}

interface PlaylistDetails {
  id: string
  title: string
  description: string
  thumbnail: {
    default: string
    medium: string
    high: string
    maxres?: string
  }
  channelId: string
  channelTitle: string
  itemCount: number
  publishedAt: Date
  privacyStatus: 'private' | 'public' | 'unlisted'
}

interface SearchResult {
  items: Array<{
    id: string
    type: 'video' | 'channel' | 'playlist'
    title: string
    description: string
    thumbnail: string
    channelTitle: string
    publishedAt: Date
  }>
  nextPageToken?: string
  totalResults: number
}

export class YouTubeService {
  private youtube: youtube_v3.Youtube
  private apiKey: string
  
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY!
    
    if (!this.apiKey) {
      console.warn('YouTube API key not configured')
    }
    
    this.youtube = google.youtube({
      version: 'v3',
      auth: this.apiKey,
    })
  }

  async getVideoDetails(videoId: string): Promise<VideoDetails> {
    // Check cache first
    const cacheKey = `youtube:video:${videoId}`
    const cached = await cache.get<VideoDetails>(cacheKey)
    if (cached) return cached

    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails', 'status'],
        id: [videoId],
      })

      const video = response.data.items?.[0]
      if (!video) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Video not found',
        })
      }

      // Check if video is embeddable
      if (video.status?.embeddable === false) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This video cannot be embedded',
        })
      }

      const details: VideoDetails = {
        id: video.id!,
        title: video.snippet?.title || '',
        description: video.snippet?.description || '',
        thumbnail: {
          default: video.snippet?.thumbnails?.default?.url || '',
          medium: video.snippet?.thumbnails?.medium?.url || '',
          high: video.snippet?.thumbnails?.high?.url || '',
          maxres: video.snippet?.thumbnails?.maxres?.url,
        },
        channelId: video.snippet?.channelId || '',
        channelTitle: video.snippet?.channelTitle || '',
        duration: this.parseDuration(video.contentDetails?.duration),
        viewCount: parseInt(video.statistics?.viewCount || '0'),
        likeCount: parseInt(video.statistics?.likeCount || '0'),
        commentCount: parseInt(video.statistics?.commentCount || '0'),
        publishedAt: new Date(video.snippet?.publishedAt || ''),
        tags: video.snippet?.tags || [],
        categoryId: video.snippet?.categoryId || '',
        liveBroadcastContent: video.snippet?.liveBroadcastContent as any || 'none',
        statistics: video.statistics as any,
        contentDetails: video.contentDetails as any,
      }

      // Cache for 1 hour for regular videos, 5 minutes for live
      const cacheDuration = details.liveBroadcastContent === 'live' ? 300 : 3600
      await cache.set(cacheKey, details, cacheDuration)

      // Track video usage
      await this.trackVideoUsage(videoId, details)

      return details
    } catch (error: any) {
      if (error.response?.status === 403) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'YouTube API quota exceeded',
        })
      }
      
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch video details',
      })
    }
  }

  async getChannelDetails(channelId: string): Promise<ChannelDetails> {
    // Check cache first
    const cacheKey = `youtube:channel:${channelId}`
    const cached = await cache.get<ChannelDetails>(cacheKey)
    if (cached) return cached

    try {
      const response = await this.youtube.channels.list({
        part: ['snippet', 'statistics', 'brandingSettings'],
        id: [channelId],
      })

      const channel = response.data.items?.[0]
      if (!channel) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Channel not found',
        })
      }

      const details: ChannelDetails = {
        id: channel.id!,
        title: channel.snippet?.title || '',
        description: channel.snippet?.description || '',
        customUrl: channel.snippet?.customUrl,
        thumbnail: {
          default: channel.snippet?.thumbnails?.default?.url || '',
          medium: channel.snippet?.thumbnails?.medium?.url || '',
          high: channel.snippet?.thumbnails?.high?.url || '',
        },
        subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
        videoCount: parseInt(channel.statistics?.videoCount || '0'),
        viewCount: parseInt(channel.statistics?.viewCount || '0'),
        country: channel.snippet?.country,
        publishedAt: new Date(channel.snippet?.publishedAt || ''),
        statistics: channel.statistics as any,
        brandingSettings: channel.brandingSettings as any,
      }

      // Cache for 24 hours
      await cache.set(cacheKey, details, 86400)

      return details
    } catch (error: any) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch channel details',
      })
    }
  }

  async getPlaylistDetails(playlistId: string): Promise<PlaylistDetails> {
    // Check cache first
    const cacheKey = `youtube:playlist:${playlistId}`
    const cached = await cache.get<PlaylistDetails>(cacheKey)
    if (cached) return cached

    try {
      const response = await this.youtube.playlists.list({
        part: ['snippet', 'contentDetails', 'status'],
        id: [playlistId],
      })

      const playlist = response.data.items?.[0]
      if (!playlist) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Playlist not found',
        })
      }

      const details: PlaylistDetails = {
        id: playlist.id!,
        title: playlist.snippet?.title || '',
        description: playlist.snippet?.description || '',
        thumbnail: {
          default: playlist.snippet?.thumbnails?.default?.url || '',
          medium: playlist.snippet?.thumbnails?.medium?.url || '',
          high: playlist.snippet?.thumbnails?.high?.url || '',
          maxres: playlist.snippet?.thumbnails?.maxres?.url,
        },
        channelId: playlist.snippet?.channelId || '',
        channelTitle: playlist.snippet?.channelTitle || '',
        itemCount: playlist.contentDetails?.itemCount || 0,
        publishedAt: new Date(playlist.snippet?.publishedAt || ''),
        privacyStatus: playlist.status?.privacyStatus as any || 'private',
      }

      // Cache for 1 hour
      await cache.set(cacheKey, details, 3600)

      return details
    } catch (error: any) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch playlist details',
      })
    }
  }

  async getPlaylistVideos(
    playlistId: string,
    maxResults: number = 50,
    pageToken?: string
  ): Promise<{ videos: VideoDetails[]; nextPageToken?: string }> {
    try {
      const response = await this.youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults,
        pageToken,
      })

      const videoIds = response.data.items
        ?.map(item => item.contentDetails?.videoId)
        .filter(Boolean) as string[]

      if (!videoIds || videoIds.length === 0) {
        return { videos: [] }
      }

      // Get video details for all videos
      const videos = await Promise.all(
        videoIds.map(id => this.getVideoDetails(id).catch(() => null))
      )

      return {
        videos: videos.filter(Boolean) as VideoDetails[],
        nextPageToken: response.data.nextPageToken || undefined,
      }
    } catch (error: any) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch playlist videos',
      })
    }
  }

  async searchVideos(
    query: string,
    options: {
      maxResults?: number
      order?: 'relevance' | 'date' | 'rating' | 'viewCount'
      channelId?: string
      type?: ('video' | 'channel' | 'playlist')[]
      pageToken?: string
      safeSearch?: 'none' | 'moderate' | 'strict'
      videoDuration?: 'short' | 'medium' | 'long'
      publishedAfter?: Date
      publishedBefore?: Date
    } = {}
  ): Promise<SearchResult> {
    try {
      const searchParams: any = {
        part: ['snippet'],
        q: query,
        maxResults: options.maxResults || 25,
        order: options.order || 'relevance',
        safeSearch: options.safeSearch || 'moderate',
        type: options.type?.join(',') || 'video',
      }

      if (options.channelId) {
        searchParams.channelId = options.channelId
      }

      if (options.pageToken) {
        searchParams.pageToken = options.pageToken
      }

      if (options.videoDuration) {
        searchParams.videoDuration = options.videoDuration
      }

      if (options.publishedAfter) {
        searchParams.publishedAfter = options.publishedAfter.toISOString()
      }

      if (options.publishedBefore) {
        searchParams.publishedBefore = options.publishedBefore.toISOString()
      }

      const response = await this.youtube.search.list(searchParams)

      const items = response.data.items?.map(item => ({
        id: item.id?.videoId || item.id?.channelId || item.id?.playlistId || '',
        type: item.id?.kind?.replace('youtube#', '') as any || 'video',
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        thumbnail: item.snippet?.thumbnails?.high?.url || 
                   item.snippet?.thumbnails?.medium?.url || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: new Date(item.snippet?.publishedAt || ''),
      })) || []

      return {
        items,
        nextPageToken: response.data.nextPageToken || undefined,
        totalResults: response.data.pageInfo?.totalResults || 0,
      }
    } catch (error: any) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to search YouTube',
      })
    }
  }

  async getRelatedVideos(
    videoId: string,
    maxResults: number = 10
  ): Promise<VideoDetails[]> {
    try {
      // Note: relatedToVideoId is deprecated in v3 API
      // Instead, we'll search for videos from the same channel
      const video = await this.getVideoDetails(videoId)
      
      const searchResult = await this.searchVideos('', {
        channelId: video.channelId,
        maxResults,
        order: 'relevance',
        type: ['video'],
      })

      // Filter out the current video
      const relatedVideoIds = searchResult.items
        .filter(item => item.id !== videoId)
        .map(item => item.id)
        .slice(0, maxResults)

      const videos = await Promise.all(
        relatedVideoIds.map(id => this.getVideoDetails(id).catch(() => null))
      )

      return videos.filter(Boolean) as VideoDetails[]
    } catch (error: any) {
      console.error('YouTube API error:', error)
      return []
    }
  }

  async getTrendingVideos(
    options: {
      regionCode?: string
      categoryId?: string
      maxResults?: number
    } = {}
  ): Promise<VideoDetails[]> {
    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        chart: 'mostPopular',
        regionCode: options.regionCode || 'US',
        videoCategoryId: options.categoryId,
        maxResults: options.maxResults || 25,
      })

      const videoIds = response.data.items?.map(item => item.id).filter(Boolean) as string[]
      
      const videos = await Promise.all(
        videoIds.map(id => this.getVideoDetails(id).catch(() => null))
      )

      return videos.filter(Boolean) as VideoDetails[]
    } catch (error: any) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch trending videos',
      })
    }
  }

  async getVideoCategories(regionCode: string = 'US') {
    const cacheKey = `youtube:categories:${regionCode}`
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    try {
      const response = await this.youtube.videoCategories.list({
        part: ['snippet'],
        regionCode,
      })

      const categories = response.data.items?.map(item => ({
        id: item.id,
        title: item.snippet?.title,
        assignable: item.snippet?.assignable,
      })) || []

      // Cache for 7 days
      await cache.set(cacheKey, categories, 604800)

      return categories
    } catch (error: any) {
      console.error('YouTube API error:', error)
      return []
    }
  }

  // Utility methods
  private parseDuration(duration?: string): number {
    if (!duration) return 0

    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    if (!match) return 0

    const hours = parseInt(match[1] || '0')
    const minutes = parseInt(match[2] || '0')
    const seconds = parseInt(match[3] || '0')

    return hours * 3600 + minutes * 60 + seconds
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/v\/([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }

    // Check if it's already a video ID (11 characters)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      return url
    }

    return null
  }

  extractChannelId(url: string): string | null {
    const patterns = [
      /youtube\.com\/channel\/([^\/\n?#]+)/,
      /youtube\.com\/c\/([^\/\n?#]+)/,
      /youtube\.com\/@([^\/\n?#]+)/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }

    return null
  }

  extractPlaylistId(url: string): string | null {
    const pattern = /[?&]list=([^&\n#]+)/
    const match = url.match(pattern)
    return match ? match[1] : null
  }

  // Track video usage for analytics
  private async trackVideoUsage(videoId: string, details: VideoDetails) {
    try {
      await db.analyticsEvent.create({
        data: {
          eventName: 'youtube_video_embedded',
          properties: {
            videoId,
            title: details.title,
            channelId: details.channelId,
            channelTitle: details.channelTitle,
            duration: details.duration,
            viewCount: details.viewCount,
          },
        },
      })
    } catch (error) {
      console.error('Failed to track video usage:', error)
    }
  }

  // Check API quota usage
  async checkQuotaUsage(): Promise<{
    used: number
    limit: number
    remaining: number
    resetTime: Date
  }> {
    // This is a simplified version
    // In production, you'd track actual API calls
    const today = new Date().toDateString()
    const key = `youtube:quota:${today}`
    const used = (await cache.get<number>(key)) || 0
    const limit = 10000 // Default YouTube API quota
    
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetTime: new Date(new Date().setHours(24, 0, 0, 0)),
    }
  }

  // Increment quota usage
  private async incrementQuotaUsage(cost: number = 1) {
    const today = new Date().toDateString()
    const key = `youtube:quota:${today}`
    const current = (await cache.get<number>(key)) || 0
    await cache.set(key, current + cost, 86400) // 24 hours
  }
}

// Export singleton instance
export const youtubeService = new YouTubeService()
