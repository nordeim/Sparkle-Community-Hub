// src/server/services/search.service.ts
import { PrismaClient, Prisma } from '@prisma/client'
import algoliasearch, { SearchClient, SearchIndex } from 'algoliasearch'
import { cache } from '@/lib/cache'
import { stripHtml, extractExcerpt } from '@/lib/utils'
import { TRPCError } from '@trpc/server'

interface SearchOptions {
  query: string
  type?: 'all' | 'posts' | 'users' | 'comments' | 'tags'
  filters?: {
    authorId?: string
    tags?: string[]
    dateFrom?: Date
    dateTo?: Date
    hasVideo?: boolean
  }
  limit?: number
  offset?: number
  facets?: boolean
}

interface SearchResult<T = any> {
  items: T[]
  totalCount: number
  facets?: Record<string, Record<string, number>>
  suggestions?: string[]
  processingTime: number
}

interface IndexablePost {
  objectID: string
  title: string
  content: string
  excerpt: string
  slug: string
  author: {
    id: string
    username: string
    image?: string
    verified: boolean
  }
  tags: string[]
  hasVideo: boolean
  featured: boolean
  views: number
  reactions: number
  comments: number
  publishedAt: number
  _searchableContent?: string
}

interface IndexableUser {
  objectID: string
  username: string
  bio?: string
  image?: string
  verified: boolean
  role: string
  level: number
  followers: number
  posts: number
  createdAt: number
}

interface IndexableComment {
  objectID: string
  content: string
  postId: string
  postTitle: string
  author: {
    id: string
    username: string
  }
  reactions: number
  createdAt: number
}

export class SearchService {
  private algoliaClient: SearchClient | null = null
  private postsIndex: SearchIndex | null = null
  private usersIndex: SearchIndex | null = null
  private commentsIndex: SearchIndex | null = null
  private isAlgoliaEnabled: boolean = false

  constructor(private db: PrismaClient) {
    this.initializeAlgolia()
  }

  private initializeAlgolia() {
    const appId = process.env.ALGOLIA_APP_ID
    const adminKey = process.env.ALGOLIA_ADMIN_KEY

    if (appId && adminKey) {
      try {
        this.algoliaClient = algoliasearch(appId, adminKey)
        this.postsIndex = this.algoliaClient.initIndex('posts')
        this.usersIndex = this.algoliaClient.initIndex('users')
        this.commentsIndex = this.algoliaClient.initIndex('comments')
        this.isAlgoliaEnabled = true

        // Configure indices
        this.configureIndices()
      } catch (error) {
        console.error('Failed to initialize Algolia:', error)
        this.isAlgoliaEnabled = false
      }
    } else {
      console.warn('Algolia credentials not configured, using database search')
    }
  }

  private async configureIndices() {
    if (!this.isAlgoliaEnabled) return

    try {
      // Posts index configuration
      await this.postsIndex!.setSettings({
        searchableAttributes: [
          'unordered(title)',
          'unordered(content)',
          'unordered(excerpt)',
          'unordered(tags)',
          'author.username',
        ],
        attributesForFaceting: [
          'searchable(tags)',
          'searchable(author.username)',
          'filterOnly(author.id)',
          'filterOnly(featured)',
          'filterOnly(hasVideo)',
        ],
        customRanking: [
          'desc(featured)',
          'desc(reactions)',
          'desc(views)',
          'desc(publishedAt)',
        ],
        attributesToRetrieve: [
          'title',
          'excerpt',
          'slug',
          'author',
          'tags',
          'hasVideo',
          'featured',
          'views',
          'reactions',
          'comments',
          'publishedAt',
        ],
        attributesToHighlight: [
          'title',
          'content',
          'excerpt',
        ],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
        hitsPerPage: 20,
        maxValuesPerFacet: 100,
        typoTolerance: true,
        removeStopWords: ['en'],
        queryLanguages: ['en'],
      })

      // Users index configuration
      await this.usersIndex!.setSettings({
        searchableAttributes: [
          'unordered(username)',
          'unordered(bio)',
        ],
        attributesForFaceting: [
          'filterOnly(verified)',
          'filterOnly(role)',
        ],
        customRanking: [
          'desc(verified)',
          'desc(followers)',
          'desc(level)',
          'desc(posts)',
        ],
        attributesToRetrieve: [
          'username',
          'bio',
          'image',
          'verified',
          'role',
          'level',
          'followers',
          'posts',
        ],
        attributesToHighlight: [
          'username',
          'bio',
        ],
      })

      // Comments index configuration
      await this.commentsIndex!.setSettings({
        searchableAttributes: [
          'unordered(content)',
          'author.username',
        ],
        attributesForFaceting: [
          'filterOnly(postId)',
          'filterOnly(author.id)',
        ],
        customRanking: [
          'desc(reactions)',
          'desc(createdAt)',
        ],
        attributesToRetrieve: [
          'content',
          'postId',
          'postTitle',
          'author',
          'reactions',
          'createdAt',
        ],
        attributesToHighlight: [
          'content',
        ],
      })
    } catch (error) {
      console.error('Failed to configure Algolia indices:', error)
    }
  }

  // Main search method
  async search(options: SearchOptions): Promise<SearchResult> {
    const startTime = Date.now()

    // Try Algolia first if enabled
    if (this.isAlgoliaEnabled) {
      try {
        const result = await this.searchWithAlgolia(options)
        return {
          ...result,
          processingTime: Date.now() - startTime,
        }
      } catch (error) {
        console.error('Algolia search failed, falling back to database:', error)
      }
    }

    // Fallback to database search
    const result = await this.searchWithDatabase(options)
    return {
      ...result,
      processingTime: Date.now() - startTime,
    }
  }

  // Algolia search implementation
  private async searchWithAlgolia(options: SearchOptions): Promise<SearchResult> {
    const { query, type = 'all', filters, limit = 20, offset = 0, facets = false } = options

    const searchParams: any = {
      query,
      hitsPerPage: limit,
      page: Math.floor(offset / limit),
    }

    // Build filters
    const filterArray: string[] = []
    
    if (filters?.authorId) {
      filterArray.push(`author.id:${filters.authorId}`)
    }
    
    if (filters?.tags && filters.tags.length > 0) {
      filterArray.push(`(${filters.tags.map(tag => `tags:${tag}`).join(' OR ')})`)
    }
    
    if (filters?.hasVideo !== undefined) {
      filterArray.push(`hasVideo:${filters.hasVideo}`)
    }
    
    if (filters?.dateFrom || filters?.dateTo) {
      const from = filters.dateFrom?.getTime() || 0
      const to = filters.dateTo?.getTime() || Date.now()
      filterArray.push(`publishedAt:${from} TO ${to}`)
    }

    if (filterArray.length > 0) {
      searchParams.filters = filterArray.join(' AND ')
    }

    // Add facets if requested
    if (facets) {
      searchParams.facets = ['tags', 'author.username', 'hasVideo']
    }

    // Execute search based on type
    let results: any[] = []
    let totalCount = 0
    let facetResults = {}

    switch (type) {
      case 'posts':
        const postResults = await this.postsIndex!.search(query, searchParams)
        results = postResults.hits
        totalCount = postResults.nbHits
        facetResults = postResults.facets || {}
        break

      case 'users':
        const userResults = await this.usersIndex!.search(query, searchParams)
        results = userResults.hits
        totalCount = userResults.nbHits
        facetResults = userResults.facets || {}
        break

      case 'comments':
        const commentResults = await this.commentsIndex!.search(query, searchParams)
        results = commentResults.hits
        totalCount = commentResults.nbHits
        break

      case 'all':
        // Search all indices in parallel
        const [posts, users, comments] = await Promise.all([
          this.postsIndex!.search(query, { ...searchParams, hitsPerPage: 10 }),
          this.usersIndex!.search(query, { ...searchParams, hitsPerPage: 5 }),
          this.commentsIndex!.search(query, { ...searchParams, hitsPerPage: 5 }),
        ])

        results = [
          ...posts.hits.map(hit => ({ ...hit, _type: 'post' })),
          ...users.hits.map(hit => ({ ...hit, _type: 'user' })),
          ...comments.hits.map(hit => ({ ...hit, _type: 'comment' })),
        ]
        totalCount = posts.nbHits + users.nbHits + comments.nbHits
        break
    }

    // Get search suggestions
    const suggestions = await this.getSearchSuggestions(query, type)

    return {
      items: results,
      totalCount,
      facets: facets ? facetResults : undefined,
      suggestions,
      processingTime: 0, // Will be set by caller
    }
  }

  // Database search fallback
  private async searchWithDatabase(options: SearchOptions): Promise<SearchResult> {
    const { query, type = 'all', filters, limit = 20, offset = 0 } = options

    // Sanitize query for PostgreSQL full-text search
    const searchQuery = query.trim().split(/\s+/).join(' & ')

    let results: any[] = []
    let totalCount = 0

    switch (type) {
      case 'posts':
        const posts = await this.searchPosts(searchQuery, filters, limit, offset)
        results = posts.items
        totalCount = posts.total
        break

      case 'users':
        const users = await this.searchUsers(searchQuery, limit, offset)
        results = users.items
        totalCount = users.total
        break

      case 'comments':
        const comments = await this.searchComments(searchQuery, filters, limit, offset)
        results = comments.items
        totalCount = comments.total
        break

      case 'all':
        // Search all types with reduced limits
        const [postResults, userResults, commentResults] = await Promise.all([
          this.searchPosts(searchQuery, filters, 10, 0),
          this.searchUsers(searchQuery, 5, 0),
          this.searchComments(searchQuery, filters, 5, 0),
        ])

        results = [
          ...postResults.items.map(item => ({ ...item, _type: 'post' })),
          ...userResults.items.map(item => ({ ...item, _type: 'user' })),
          ...commentResults.items.map(item => ({ ...item, _type: 'comment' })),
        ]
        totalCount = postResults.total + userResults.total + commentResults.total
        break
    }

    return {
      items: results,
      totalCount,
      processingTime: 0, // Will be set by caller
    }
  }

  // Search posts in database
  private async searchPosts(
    query: string,
    filters: SearchOptions['filters'],
    limit: number,
    offset: number
  ) {
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

    if (filters?.tags && filters.tags.length > 0) {
      where.tags = {
        some: {
          tag: {
            name: { in: filters.tags },
          },
        },
      }
    }

    if (filters?.hasVideo !== undefined) {
      where.youtubeVideoId = filters.hasVideo ? { not: null } : null
    }

    if (filters?.dateFrom || filters?.dateTo) {
      where.publishedAt = {
        gte: filters.dateFrom,
        lte: filters.dateTo,
      }
    }

    const [items, total] = await Promise.all([
      this.db.post.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              image: true,
              verified: true,
            },
          },
          tags: {
            include: {
              tag: true,
            },
          },
          _count: {
            select: {
              reactions: true,
              comments: true,
            },
          },
        },
        orderBy: [
          { featured: 'desc' },
          { views: 'desc' },
          { publishedAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      this.db.post.count({ where }),
    ])

    return {
      items: items.map(post => ({
        ...post,
        tags: post.tags.map(t => t.tag.name),
        reactions: post._count.reactions,
        comments: post._count.comments,
      })),
      total,
    }
  }

  // Search users in database
  private async searchUsers(query: string, limit: number, offset: number) {
    const where: Prisma.UserWhereInput = {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { bio: { contains: query, mode: 'insensitive' } },
      ],
    }

    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          bio: true,
          image: true,
          verified: true,
          role: true,
          level: true,
          _count: {
            select: {
              followers: true,
              posts: { where: { published: true } },
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
      items: items.map(user => ({
        ...user,
        followers: user._count.followers,
        posts: user._count.posts,
      })),
      total,
    }
  }

  // Search comments in database
  private async searchComments(
    query: string,
    filters: SearchOptions['filters'],
    limit: number,
    offset: number
  ) {
    const where: Prisma.CommentWhereInput = {
      content: { contains: query, mode: 'insensitive' },
      deleted: false,
    }

    if (filters?.authorId) {
      where.authorId = filters.authorId
    }

    const [items, total] = await Promise.all([
      this.db.comment.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              username: true,
            },
          },
          post: {
            select: {
              id: true,
              title: true,
            },
          },
          _count: {
            select: {
              reactions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.comment.count({ where }),
    ])

    return {
      items: items.map(comment => ({
        ...comment,
        postTitle: comment.post.title,
        reactions: comment._count.reactions,
      })),
      total,
    }
  }

  // Indexing methods for Algolia
  async indexPost(post: any) {
    if (!this.isAlgoliaEnabled) return

    try {
      const indexablePost: IndexablePost = {
        objectID: post.id,
        title: post.title,
        content: stripHtml(post.content),
        excerpt: post.excerpt || extractExcerpt(post.content),
        slug: post.slug,
        author: {
          id: post.author.id,
          username: post.author.username,
          image: post.author.image,
          verified: post.author.verified,
        },
        tags: post.tags?.map((t: any) => t.tag.name) || [],
        hasVideo: !!post.youtubeVideoId,
        featured: post.featured,
        views: post.views,
        reactions: post._count?.reactions || 0,
        comments: post._count?.comments || 0,
        publishedAt: new Date(post.publishedAt).getTime(),
      }

      // Create searchable content field
      indexablePost._searchableContent = [
        indexablePost.title,
        indexablePost.content,
        indexablePost.excerpt,
        indexablePost.tags.join(' '),
        indexablePost.author.username,
      ].join(' ').toLowerCase()

      await this.postsIndex!.saveObject(indexablePost)
    } catch (error) {
      console.error('Failed to index post:', error)
    }
  }

  async indexUser(user: any) {
    if (!this.isAlgoliaEnabled) return

    try {
      const indexableUser: IndexableUser = {
        objectID: user.id,
        username: user.username,
        bio: user.bio,
        image: user.image,
        verified: user.verified,
        role: user.role,
        level: user.level,
        followers: user._count?.followers || 0,
        posts: user._count?.posts || 0,
        createdAt: new Date(user.createdAt).getTime(),
      }

      await this.usersIndex!.saveObject(indexableUser)
    } catch (error) {
      console.error('Failed to index user:', error)
    }
  }

  async indexComment(comment: any) {
    if (!this.isAlgoliaEnabled) return

    try {
      const indexableComment: IndexableComment = {
        objectID: comment.id,
        content: stripHtml(comment.content),
        postId: comment.postId,
        postTitle: comment.post.title,
        author: {
          id: comment.author.id,
          username: comment.author.username,
        },
        reactions: comment._count?.reactions || 0,
        createdAt: new Date(comment.createdAt).getTime(),
      }

      await this.commentsIndex!.saveObject(indexableComment)
    } catch (error) {
      console.error('Failed to index comment:', error)
    }
  }

  // Remove from index
  async removeFromIndex(type: 'post' | 'user' | 'comment', id: string) {
    if (!this.isAlgoliaEnabled) return

    try {
      switch (type) {
        case 'post':
          await this.postsIndex!.deleteObject(id)
          break
        case 'user':
          await this.usersIndex!.deleteObject(id)
          break
        case 'comment':
          await this.commentsIndex!.deleteObject(id)
          break
      }
    } catch (error) {
      console.error('Failed to remove from index:', error)
    }
  }

  // Search suggestions
  private async getSearchSuggestions(query: string, type: string): Promise<string[]> {
    // Check cache first
    const cacheKey = `search:suggestions:${type}:${query}`
    const cached = await cache.get<string[]>(cacheKey)
    if (cached) return cached

    const suggestions: string[] = []

    try {
      // Get popular tags matching the query
      if (type === 'all' || type === 'posts') {
        const tags = await this.db.tag.findMany({
          where: {
            name: { contains: query, mode: 'insensitive' },
          },
          orderBy: { postCount: 'desc' },
          take: 5,
          select: { name: true },
        })
        suggestions.push(...tags.map(t => t.name))
      }

      // Get popular users matching the query
      if (type === 'all' || type === 'users') {
        const users = await this.db.user.findMany({
          where: {
            username: { contains: query, mode: 'insensitive' },
          },
          orderBy: {
            followers: { _count: 'desc' },
          },
          take: 3,
          select: { username: true },
        })
        suggestions.push(...users.map(u => u.username))
      }

      // Cache for 1 hour
      await cache.set(cacheKey, suggestions, 3600)
    } catch (error) {
      console.error('Failed to get search suggestions:', error)
    }

    return suggestions
  }

  // Popular searches
  async getPopularSearches(limit: number = 10): Promise<string[]> {
    const cacheKey = 'search:popular'
    const cached = await cache.get<string[]>(cacheKey)
    if (cached) return cached

    try {
      // Get popular tags
      const tags = await this.db.tag.findMany({
        orderBy: { postCount: 'desc' },
        take: limit,
        select: { name: true },
      })

      const searches = tags.map(t => t.name)
      
      // Cache for 1 hour
      await cache.set(cacheKey, searches, 3600)
      
      return searches
    } catch (error) {
      console.error('Failed to get popular searches:', error)
      return []
    }
  }

  // Track search for analytics
  async trackSearch(query: string, resultCount: number, userId?: string) {
    try {
      await this.db.analyticsEvent.create({
        data: {
          eventName: 'search_performed',
          userId,
          properties: {
            query,
            resultCount,
            hasResults: resultCount > 0,
          },
        },
      })
    } catch (error) {
      console.error('Failed to track search:', error)
    }
  }

  // Queue item for indexing
  async queueForIndexing(
    entityType: 'post' | 'user' | 'comment',
    entityId: string,
    action: 'create' | 'update' | 'delete'
  ) {
    try {
      await this.db.searchIndexQueue.create({
        data: {
          entityType,
          entityId,
          action,
        },
      })
    } catch (error) {
      console.error('Failed to queue for indexing:', error)
    }
  }

  // Process indexing queue
  async processIndexingQueue(batchSize: number = 100) {
    const items = await this.db.searchIndexQueue.findMany({
      where: { processed: false },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    })

    for (const item of items) {
      try {
        switch (item.action) {
          case 'create':
          case 'update':
            await this.indexEntity(item.entityType as any, item.entityId)
            break
          case 'delete':
            await this.removeFromIndex(item.entityType as any, item.entityId)
            break
        }

        await this.db.searchIndexQueue.update({
          where: { id: item.id },
          data: {
            processed: true,
            processedAt: new Date(),
          },
        })
      } catch (error) {
        await this.db.searchIndexQueue.update({
          where: { id: item.id },
          data: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })
      }
    }
  }

  // Index entity by fetching fresh data
  private async indexEntity(type: 'post' | 'user' | 'comment', id: string) {
    switch (type) {
      case 'post':
        const post = await this.db.post.findUnique({
          where: { id },
          include: {
            author: true,
            tags: { include: { tag: true } },
            _count: { select: { reactions: true, comments: true } },
          },
        })
        if (post && post.published) {
          await this.indexPost(post)
        }
        break

      case 'user':
        const user = await this.db.user.findUnique({
          where: { id },
          include: {
            _count: { select: { followers: true, posts: true } },
          },
        })
        if (user) {
          await this.indexUser(user)
        }
        break

      case 'comment':
        const comment = await this.db.comment.findUnique({
          where: { id },
          include: {
            author: true,
            post: true,
            _count: { select: { reactions: true } },
          },
        })
        if (comment && !comment.deleted) {
          await this.indexComment(comment)
        }
        break
    }
  }
}

// Export singleton instance
export const searchService = new SearchService(db)
