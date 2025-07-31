// src/server/api/routers/search.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc'
import { searchService } from '@/server/services/search.service'

export const searchRouter = createTRPCRouter({
  // Main search endpoint
  search: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      type: z.enum(['all', 'posts', 'users', 'comments', 'tags']).default('all'),
      filters: z.object({
        authorId: z.string().optional(),
        tags: z.array(z.string()).optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        hasVideo: z.boolean().optional(),
      }).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      facets: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const result = await searchService.search(input)
      
      // Track search
      await searchService.trackSearch(
        input.query,
        result.totalCount,
        ctx.session?.user?.id
      )

      return result
    }),

  // Get search suggestions
  suggestions: publicProcedure
    .input(z.object({
      query: z.string().min(1).max(50),
      type: z.enum(['all', 'posts', 'users', 'tags']).default('all'),
    }))
    .query(async ({ input }) => {
      const result = await searchService.search({
        query: input.query,
        type: input.type,
        limit: 5,
      })

      return {
        suggestions: result.suggestions || [],
        topResults: result.items.slice(0, 3),
      }
    }),

  // Get popular searches
  popular: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(20).default(10),
    }))
    .query(async ({ input }) => {
      return searchService.getPopularSearches(input.limit)
    }),
})
