// src/server/services/search.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import algoliasearch, { SearchClient, SearchIndex } from 'algoliasearch'
import { CacheService } from './cache.service'
import { stripHtml } from '@/lib/utils'

interface SearchOptions {
  query: string
  type?: 'all' | 'posts' | 'users' | 'tags' | 'groups'
  filters?: {
    authorId?: string
    categoryId?: string
    tags?: string[]
    dateFrom?: Date
    dateTo?: Date
    contentType?: string
    featured?: boolean
    verified?: boolean
  }
  sort?: 'relevance' | 'date' | 'popularity'
  limit?: number
  offset?: number
  facets?: string[]
}

interface SearchResult<T = any> {
  hits: T[]
  totalHits: number
  totalPages: number
  page: number
  processingTime: number
  facets?: Record<string, Record<string, number>>
}

interface IndexablePost {
  objectID: string
  title: string
  content: string
  excerpt: string
  author: {
    id: string
    username: string
    image: string | null
  }
  tags: string[]
  category: string | null
  slug: string
  featured: boolean
  publishedAt: number
  viewCount: number
  likeCount: number
  commentCount: number
  popularity: number
  contentType: string
  hasVideo: boolean
  _highlightResult?: any
}

interface IndexableUser {
  objectID: string
  username: string
  displayName: string | null
  bio: string | null
  image: string | null
  verified: boolean
  role: string
  followers: number
  posts: number
  joinedAt: number
  level: number
  reputation: number
  _highlightResult?: any
}

export class SearchService {
  private algoliaClient: SearchClient | null = null
  private postsIndex: SearchIndex | null = null
  private usersIndex: SearchIndex | null = null
  private tagsIndex: SearchIndex | null = null
  private cacheService: CacheService
  private isAlgoliaEnabled: boolean

  constructor(private db: PrismaClient) {
    this.cacheService = new CacheService()
    this.isAlgoliaEnabled = !!(
      process.env.ALGOLIA_APP_ID && 
      process.env.ALGOLIA_ADMIN_KEY
    )

    if (this.isAlgoliaEnabled) {
      this.initializeAlgolia()
    } else {
      console.warn('⚠️  Algolia not configured, using database search fallback')
    }
  }

  private initializeAlgolia() {
    try {
      this.algoliaClient = algoliasearch(
        process.env.ALGOLIA_APP_ID!,
        process.env.ALGOLIA_ADMIN_KEY!
      )

      this.postsIndex = this.algoliaClient.initIndex('posts')
      this.usersIndex = this.algoliaClient.initIndex('users')
      this.tagsIndex = this.algoliaClient.initIndex('tags')

      // Configure indices
      this.configureIndices()
      
      console.log('✅ Algolia search initialized')
    } catch (error) {
      console.error('Failed to initialize Algolia:', error)
      this.isAlgoliaEnabled = false
    }
  }

  private async configureIndices() {
    if (!this.postsIndex || !this.usersIndex || !this.tagsIndex) return

    try {
      // Posts index configuration
      await this.postsIndex.setSettings({
        searchableAttributes: [
          'unordered(title)',
          'unordered(content)',
          'excerpt',
          'tags',
          'author.username',
          'category',
        ],
        attributesForFaceting: [
          'filterOnly(authorId)',
          'searchable(tags)',
          'searchable(category)',
          'filterOnly(featured)',
          'filterOnly(contentType)',
          'filterOnly(hasVideo)',
        ],
        customRanking: [
          'desc(popularity)',
          'desc(publishedAt)',
        ],
        attributesToRetrieve: [
          'objectID',
          'title',
          'excerpt',
          'author',
          'tags',
          'category',
          'slug',
          'featured',
          'publishedAt',
          'viewCount',
          'likeCount',
          'commentCount',
          'contentType',
          'hasVideo',
        ],
        attributesToHighlight: [
          'title',
          'content',
          'excerpt',
          'tags',
        ],
        highlightPreTag: '<mark class="search-highlight">',
        highlightPostTag: '</mark>',
        hitsPerPage: 20,
        maxValuesPerFacet: 100,
        minWordSizefor1Typo: 4,
        minWordSizefor2Typos: 8,
        typoTolerance: true,
        removeStopWords: true,
        ignorePlurals: true,
        queryLanguages: ['en'],
        decompoundQuery: true,
        replaceSynonymsInHighlight: true,
        minProximity: 1,
        responseFields: ['*'],
        maxFacetHits: 100,
      })

      // Users index configuration
      await this.usersIndex.setSettings({
        searchableAttributes: [
          'unordered(username)',
          'unordered(displayName)',
          'bio',
        ],
        attributesForFaceting: [
          'filterOnly(verified)',
          'filterOnly(role)',
        ],
        customRanking: [
          'desc(reputation)',
          'desc(followers)',
          'desc(level)',
        ],
        attributesToRetrieve: [
          'objectID',
          'username',
          'displayName',
          'bio',
          'image',
          'verified',
          'role',
          'followers',
          'posts',
          'level',
        ],
        attributesToHighlight: [
          'username',
          'displayName',
          'bio',
        ],
        hitsPerPage: 20,
      })

      // Tags index configuration
      await this.tagsIndex.setSettings({
        searchableAttributes: [
          'name',
          'description',
        ],
        customRanking: [
          'desc(postCount)',
        ],
        attributesToRetrieve: [
          'objectID',
          'name',
          'slug',
          'description',
          'postCount',
        ],
        hitsPerPage: 20,
      })
    } catch (error) {
      console.error('Failed to configure Algolia indices:', error)
    }
  }

  // Index management methods
  async indexPost(post: any) {
    if (!this.isAlgoliaEnabled || !this.postsIndex) return

    try {
      const indexablePost: IndexablePost = {
        objectID: post.id,
        title: post.title,
        content: stripHtml(post.content).substring(0, 5000),
        excerpt: post.excerpt || stripHtml(post.content).substring(0, 200),
        author: {
          id: post.author.id,
          username: post.author.username,
          image: post.author.image,
        },
        tags: post.tags?.map((t: any) => t.tag?.name || t.name) || [],
        category: post.category?.name || null,
        slug: post.slug,
        featured: post.featured || false,
        publishedAt: new Date(post.publishedAt || post.createdAt).getTime(),
        viewCount: post.views || 0,
        likeCount: post._count?.reactions || 0,
        commentCount: post._count?.comments || 0,
        popularity: this.calculatePopularity(post),
        contentType: post.contentType,
        hasVideo: !!post.youtubeVideoId,
      }

      await this.postsIndex.saveObject(indexablePost)
    } catch (error) {
      console.error('Failed to index post:', error)
    }
  }

  async indexUser(user: any) {
    if (!this.isAlgoliaEnabled || !this.usersIndex) return

    try {
      const indexableUser: IndexableUser = {
        objectID: user.id,
        username: user.username,
        displayName: user.profile?.displayName || null,
        bio: user.bio || user.profile?.bio || null,
        image: user.image,
        verified: user.verified || false,
        role: user.role,
        followers: user._count?.followers || 0,
        posts: user._count?.posts || 0,
        joinedAt: new Date(user.createdAt).getTime(),
        level: user.level || 1,
        reputation: user.reputationScore || 0,
      }

      await this.usersIndex.saveObject(indexableUser)
    } catch (error) {
      console.error('Failed to index user:', error)
    }
  }

  async indexTag(tag: any) {
    if (!this.isAlgoliaEnabled || !this.tagsIndex) return

    try {
      await this.tagsIndex.saveObject({
        objectID: tag.id,
        name: tag.name,
        slug: tag.slug,
        description: tag.description,
        postCount: tag.postCount || tag._count?.posts || 0,
      })
    } catch (error) {
      console.error('Failed to index tag:', error)
    }
  }

  async deletePost(postId: string) {
    if (!this.isAlgoliaEnabled || !this.postsIndex) return

    try {
      await this.postsIndex.deleteObject(postId)
    } catch (error) {
      console.error('Failed to delete post from index:', error)
    }
  }

  async deleteUser(userId: string) {
    if (!this.isAlgoliaEnabled || !this.usersIndex) return

    try {
      await this.usersIndex.deleteObject(userId)
    } catch (error) {
      console.error('Failed to delete user from index:', error)
    }
  }

  // Search methods
  async search(options: SearchOptions): Promise<SearchResult> {
    // Try cache first
    const cacheKey = `search:${JSON.stringify(options)}`
    const cached = await this.cacheService.get<SearchResult>(cacheKey)
    if (cached) return cached

    const startTime = Date.now()

    let result: SearchResult
    if (this.isAlgoliaEnabled) {
      result = await this.searchWithAlgolia(options)
    } else {
      result = await this.searchWithDatabase(options)
    }

    result.processingTime = Date.now() - startTime

    // Cache for 5 minutes
    await this.cacheService.set(cacheKey, result, 300)

    return result
  }

  private async searchWithAlgolia(options: SearchOptions): Promise<SearchResult> {
    const { query, type = 'all', filters, sort, limit = 20, offset = 0 } = options

    if (type === 'all') {
      // Multi-index search
      const results = await Promise.all([
        this.searchPosts(options),
        this.searchUsers(options),
        this.searchTags(options),
      ])

      return {
        hits: {
          posts: results[0].hits,
          users: results[1].hits,
          tags: results[2].hits,
        } as any,
        totalHits: results.reduce((sum, r) => sum + r.totalHits, 0),
        totalPages: Math.max(...results.map(r => r.totalPages)),
        page: Math.floor(offset / limit),
        processingTime: 0,
      }
    }

    switch (type) {
      case 'posts':
        return this.searchPosts(options)
      case 'users':
        return this.searchUsers(options)
      case 'tags':
        return this.searchTags(options)
      default:
        return this.searchPosts(options)
    }
  }

  private async searchPosts(options: SearchOptions): Promise<SearchResult<IndexablePost>> {
    if (!this.postsIndex) {
      return this.searchPostsDatabase(options)
    }

    const { query, filters, sort, limit = 20, offset = 0, facets } = options
    const page = Math.floor(offset / limit)

    // Build Algolia filters
    const algoliaFilters: string[] = []
    
    if (filters?.authorId) {
      algoliaFilters.push(`author.id:${filters.authorId}`)
    }
    
    if (filters?.tags && filters.tags.length > 0) {
      algoliaFilters.push(`(${filters.tags.map(tag => `tags:${tag}`).join(' OR ')})`)
    }
    
    if (filters?.categoryId) {
      algoliaFilters.push(`category:${filters.categoryId}`)
    }
    
    if (filters?.featured !== undefined) {
      algoliaFilters.push(`featured:${filters.featured}`)
    }
    
    if (filters?.contentType) {
      algoliaFilters.push(`contentType:${filters.contentType}`)
    }
    
    if (filters?.dateFrom || filters?.dateTo) {
      const from = filters.dateFrom?.getTime() || 0
      const to = filters.dateTo?.getTime() || Date.now()
      algoliaFilters.push(`publishedAt:${from} TO ${to}`)
    }

    // Configure search
    const searchOptions: any = {
      page,
      hitsPerPage: limit,
      filters: algoliaFilters.join(' AND '),
    }

    if (facets && facets.length > 0) {
      searchOptions.facets = facets
    }

    // Apply sorting
    if (sort === 'date') {
      searchOptions.index = 'posts_date_desc'
    } else if (sort === 'popularity') {
      searchOptions.index = 'posts_popularity_desc'
    }

    const results = await this.postsIndex.search<IndexablePost>(query, searchOptions)

    return {
      hits: results.hits,
      totalHits: results.nbHits || 0,
      totalPages: results.nbPages || 0,
      page: results.page || 0,
      processingTime: results.processingTimeMS || 0,
      facets: results.facets,
    }
  }

  private async searchUsers(options: SearchOptions): Promise<SearchResult<IndexableUser>> {
    if (!this.usersIndex) {
      return this.searchUsersDatabase(options)
    }

    const { query, filters, limit = 20, offset = 0 } = options
    const page = Math.floor(offset / limit)

    const algoliaFilters: string[] = []
    
    if (filters?.verified !== undefined) {
      algoliaFilters.push(`verified:${filters.verified}`)
    }

    const results = await this.usersIndex.search<IndexableUser>(query, {
      page,
      hitsPerPage: limit,
      filters: algoliaFilters.join(' AND '),
    })

    return {
      hits: results.hits,
      totalHits: results.nbHits || 0,
      totalPages: results.nbPages || 0,
      page: results.page || 0,
      processingTime: results.processingTimeMS || 0,
    }
  }

  private async searchTags(options: SearchOptions): Promise<SearchResult> {
    if (!this.tagsIndex) {
      return this.searchTagsDatabase(options)
    }

    const { query, limit = 20, offset = 0 } = options
    const page = Math.floor(offset / limit)

    const results = await this.tagsIndex.search(query, {
      page,
      hitsPerPage: limit,
    })

    return {
      hits: results.hits,
      totalHits: results.nbHits || 0,
      totalPages: results.nbPages || 0,
      page: results.page || 0,
      processingTime: results.processingTimeMS || 0,
    }
  }

  // Database fallback search
  private async searchWithDatabase(options: SearchOptions): Promise<SearchResult> {
    const { type = 'all' } = options

    if (type === 'all') {
      const results = await Promise.all([
        this.searchPostsDatabase(options),
        this.searchUsersDatabase(options),
        this.searchTagsDatabase(options),
      ])

      return {
        hits: {
          posts: results[0].hits,
          users: results[1].hits,
          tags: results[2].hits,
        } as any,
        totalHits: results.reduce((sum, r) => sum + r.totalHits, 0),
        totalPages: Math.max(...results.map(r => r.totalPages)),
        page: 0,
        processingTime: 0,
      }
    }

    switch (type) {
      case 'posts':
        return this.searchPostsDatabase(options)
      case 'users':
        return this.searchUsersDatabase(options)
      case 'tags':
        return this.searchTagsDatabase(options)
      default:
        return this.searchPostsDatabase(options)
    }
  }

  private async searchPostsDatabase(options: SearchOptions): Promise<SearchResult> {
    const { query, filters, sort, limit = 20, offset = 0 } = options

    const where: Prisma.PostWhereInput = {
      published: true,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
        { excerpt: { contains: query, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: query, mode: 'insensitive' } } } } },
      ],
    }

    // Apply filters
    if (filters?.authorId) {
      where.authorId = filters.authorId
    }
    
    if (filters?.categoryId) {
      where.categoryId = filters.categoryId
    }
    
    if (filters?.tags && filters.tags.length > 0) {
      where.tags = {
        some: {
          tag: {
            name: { in: filters.tags },
          },
        },
      }
    }
    
    if (filters?.featured !== undefined) {
      where.featured = filters.featured
    }
    
    if (filters?.contentType) {
      where.contentType = filters.contentType
    }
    
    if (filters?.dateFrom || filters?.dateTo) {
      where.publishedAt = {
        gte: filters.dateFrom,
        lte: filters.dateTo,
      }
    }

    // Determine order by
    let orderBy: any = { publishedAt: 'desc' }
    if (sort === 'popularity') {
      orderBy = [
        { views: 'desc' },
        { reactions: { _count: 'desc' } },
        { publishedAt: 'desc' },
      ]
    }

    const [posts, totalCount] = await Promise.all([
      this.db.post.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              image: true,
            },
          },
          tags: {
            include: {
              tag: true,
            },
          },
          category: true,
          _count: {
            select: {
              comments: true,
              reactions: true,
            },
          },
        },
        orderBy,
        take: limit,
        skip: offset,
      }),
      this.db.post.count({ where }),
    ])

    return {
      hits: posts.map(post => ({
        objectID: post.id,
        title: post.title,
        excerpt: post.excerpt || '',
        author: {
          id: post.author.id,
          username: post.author.username,
          image: post.author.image,
        },
        tags: post.tags.map(t => t.tag.name),
        category: post.category?.name || null,
        slug: post.slug,
        featured: post.featured,
        publishedAt: post.publishedAt?.getTime() || post.createdAt.getTime(),
        viewCount: post.views,
        likeCount: post._count.reactions,
        commentCount: post._count.comments,
        contentType: post.contentType,
        hasVideo: !!post.youtubeVideoId,
        popularity: this.calculatePopularity(post),
      })),
      totalHits: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page: Math.floor(offset / limit),
      processingTime: 0,
    }
  }

  private async searchUsersDatabase(options: SearchOptions): Promise<SearchResult> {
    const { query, filters, limit = 20, offset = 0 } = options

    const where: Prisma.UserWhereInput = {
      status: 'ACTIVE',
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { bio: { contains: query, mode: 'insensitive' } },
        { profile: { displayName: { contains: query, mode: 'insensitive' } } },
      ],
    }

    if (filters?.verified !== undefined) {
      where.verified = filters.verified
    }

    const [users, totalCount] = await Promise.all([
      this.db.user.findMany({
        where,
        include: {
          profile: true,
          _count: {
            select: {
              posts: true,
              followers: true,
            },
          },
        },
        orderBy: [
          { verified: 'desc' },
          { followers: { _count: 'desc' } },
        ],
        take: limit,
        skip: offset,
      }),
      this.db.user.count({ where }),
    ])

    return {
      hits: users.map(user => ({
        objectID: user.id,
        username: user.username,
        displayName: user.profile?.displayName || null,
        bio: user.bio || user.profile?.bio || null,
        image: user.image,
        verified: user.verified,
        role: user.role,
        followers: user._count.followers,
        posts: user._count.posts,
        joinedAt: user.createdAt.getTime(),
        level: user.level,
        reputation: user.reputationScore,
      })),
      totalHits: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page: Math.floor(offset / limit),
      processingTime: 0,
    }
  }

  private async searchTagsDatabase(options: SearchOptions): Promise<SearchResult> {
    const { query, limit = 20, offset = 0 } = options

    const where: Prisma.TagWhereInput = {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    }

    const [tags, totalCount] = await Promise.all([
      this.db.tag.findMany({
        where,
        include: {
          _count: {
            select: {
              posts: true,
            },
          },
        },
        orderBy: {
          posts: {
            _count: 'desc',
          },
        },
        take: limit,
        skip: offset,
      }),
      this.db.tag.count({ where }),
    ])

    return {
      hits: tags.map(tag => ({
        objectID: tag.id,
        name: tag.name,
        slug: tag.slug,
        description: tag.description,
        postCount: tag._count.posts,
      })),
      totalHits: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page: Math.floor(offset / limit),
      processingTime: 0,
    }
  }

  // Helper methods
  private calculatePopularity(post: any): number {
    const views = post.views || 0
    const likes = post._count?.reactions || 0
    const comments = post._count?.comments || 0
    
    // Weighted popularity score
    return views + (likes * 10) + (comments * 5)
  }

  // Autocomplete suggestions
  async getSuggestions(query: string, type: 'posts' | 'users' | 'tags' = 'posts'): Promise<string[]> {
    const cacheKey = `suggestions:${type}:${query}`
    const cached = await this.cacheService.get<string[]>(cacheKey)
    if (cached) return cached

    let suggestions: string[] = []

    switch (type) {
      case 'posts':
        const posts = await this.db.post.findMany({
          where: {
            title: {
              contains: query,
              mode: 'insensitive',
            },
            published: true,
          },
          select: { title: true },
          take: 5,
        })
        suggestions = posts.map(p => p.title)
        break

      case 'users':
        const users = await this.db.user.findMany({
          where: {
            username: {
              contains: query,
              mode: 'insensitive',
            },
            status: 'ACTIVE',
          },
          select: { username: true },
          take: 5,
        })
        suggestions = users.map(u => u.username)
        break

      case 'tags':
        const tags = await this.db.tag.findMany({
          where: {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          select: { name: true },
          take: 5,
        })
        suggestions = tags.map(t => t.name)
        break
    }

    // Cache for 1 hour
    await this.cacheService.set(cacheKey, suggestions, 3600)

    return suggestions
  }

  // Trending searches
  async getTrendingSearches(limit: number = 10): Promise<string[]> {
    const cacheKey = 'trending:searches'
    const cached = await this.cacheService.get<string[]>(cacheKey)
    if (cached) return cached

    // Get popular search queries from the last 24 hours
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    const searches = await this.db.searchHistory.groupBy({
      by: ['query'],
      where: {
        createdAt: {
          gte: yesterday,
        },
      },
      _count: true,
      orderBy: {
        _count: {
          query: 'desc',
        },
      },
      take: limit,
    })

    const trending = searches.map(s => s.query)

    // Cache for 1 hour
    await this.cacheService.set(cacheKey, trending, 3600)

    return trending
  }

  // Save search query for analytics
  async saveSearchQuery(query: string, userId?: string, resultCount: number = 0) {
    try {
      await this.db.searchHistory.create({
        data: {
          query,
          userId,
          resultCount,
          searchType: 'posts',
        },
      })
    } catch (error) {
      console.error('Failed to save search query:', error)
    }
  }
}

// Export singleton instance
export const searchService = new SearchService(db)
