// src/server/api/routers/youtube.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/api/trpc'
import { youtubeService } from '@/server/services/youtube.service'
import { PAGINATION } from '@/config/constants'

export const youtubeRouter = createTRPCRouter({
  // Get video details
  getVideo: publicProcedure
    .input(z.object({
      videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'Invalid video ID'),
    }))
    .query(async ({ input }) => {
      return youtubeService.getVideoDetails(input.videoId)
    }),

  // Get channel details
  getChannel: publicProcedure
    .input(z.object({
      channelId: z.string(),
    }))
    .query(async ({ input }) => {
      return youtubeService.getChannelDetails(input.channelId)
    }),

  // Get playlist details
  getPlaylist: publicProcedure
    .input(z.object({
      playlistId: z.string(),
    }))
    .query(async ({ input }) => {
      return youtubeService.getPlaylistDetails(input.playlistId)
    }),

  // Get playlist videos
  getPlaylistVideos: publicProcedure
    .input(z.object({
      playlistId: z.string(),
      maxResults: z.number().min(1).max(50).default(20),
      pageToken: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return youtubeService.getPlaylistVideos(
        input.playlistId,
        input.maxResults,
        input.pageToken
      )
    }),

  // Search videos
  searchVideos: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      maxResults: z.number().min(1).max(50).default(25),
      order: z.enum(['relevance', 'date', 'rating', 'viewCount']).default('relevance'),
      channelId: z.string().optional(),
      type: z.array(z.enum(['video', 'channel', 'playlist'])).optional(),
      pageToken: z.string().optional(),
      safeSearch: z.enum(['none', 'moderate', 'strict']).default('moderate'),
      videoDuration: z.enum(['short', 'medium', 'long']).optional(),
    }))
    .query(async ({ input }) => {
      return youtubeService.searchVideos(input.query, input)
    }),

  // Get related videos
  getRelatedVideos: publicProcedure
    .input(z.object({
      videoId: z.string(),
      maxResults: z.number().min(1).max(25).default(10),
    }))
    .query(async ({ input }) => {
      return youtubeService.getRelatedVideos(input.videoId, input.maxResults)
    }),

  // Get trending videos
  getTrendingVideos: publicProcedure
    .input(z.object({
      regionCode: z.string().length(2).default('US'),
      categoryId: z.string().optional(),
      maxResults: z.number().min(1).max(50).default(25),
    }))
    .query(async ({ input }) => {
      return youtubeService.getTrendingVideos(input)
    }),

  // Get video categories
  getCategories: publicProcedure
    .input(z.object({
      regionCode: z.string().length(2).default('US'),
    }))
    .query(async ({ input }) => {
      return youtubeService.getVideoCategories(input.regionCode)
    }),

  // Parse YouTube URL
  parseUrl: publicProcedure
    .input(z.object({
      url: z.string().url(),
    }))
    .query(async ({ input }) => {
      const videoId = youtubeService.extractVideoId(input.url)
      const channelId = youtubeService.extractChannelId(input.url)
      const playlistId = youtubeService.extractPlaylistId(input.url)

      return {
        videoId,
        channelId,
        playlistId,
        type: videoId ? 'video' : channelId ? 'channel' : playlistId ? 'playlist' : null,
      }
    }),

  // Check API quota
  checkQuota: protectedProcedure
    .query(async () => {
      return youtubeService.checkQuotaUsage()
    }),
})
