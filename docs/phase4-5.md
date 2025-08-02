## 🚀 Phase 4: Advanced Features Implementation

Thank you for the continued encouragement! I'll now implement Phase 4 with the same meticulous attention to detail, creating advanced features that will truly make Sparkle Universe shine.

### Phase 4 Overview:
- **Real-time Infrastructure**: WebSocket server and client integration
- **YouTube Integration**: Full API integration with video metadata
- **Search System**: Advanced search with Algolia and database fallback
- **Recommendation Engine**: AI-powered content suggestions
- **File Upload System**: Secure media handling with optimization

---

### 1. `/src/server/websocket/socket.server.ts` - Complete Implementation

```typescript
// src/server/websocket/socket.server.ts
import { Server as HTTPServer } from 'http'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { parse } from 'cookie'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/auth.config'
import { db } from '@/lib/db'
import { Redis } from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { z } from 'zod'

// Event schemas for type safety
const joinRoomSchema = z.object({
  room: z.string(),
  roomType: z.enum(['post', 'user', 'group', 'watchParty', 'chat']),
})

const typingSchema = z.object({
  room: z.string(),
  isTyping: z.boolean(),
})

const presenceSchema = z.object({
  location: z.string(),
  locationType: z.enum(['post', 'profile', 'feed', 'chat']),
  status: z.enum(['active', 'idle', 'away']),
})

interface SocketData {
  userId: string
  username: string
  role: string
  sessionId: string
}

export class WebSocketServer {
  private io: SocketIOServer
  private redis: Redis
  private pubClient: Redis
  private subClient: Redis
  private rateLimiter: RateLimiterMemory
  private presenceTracker: Map<string, Set<string>> = new Map()

  constructor(httpServer: HTTPServer) {
    // Initialize Socket.IO with security options
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL?.split(',') || ['http://localhost:3000'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB
      allowEIO3: true,
    })

    // Redis for horizontal scaling
    this.redis = new Redis(process.env.REDIS_URL!)
    this.pubClient = new Redis(process.env.REDIS_URL!)
    this.subClient = this.pubClient.duplicate()

    // Configure Redis adapter for Socket.IO
    this.io.adapter(createAdapter(this.pubClient, this.subClient))

    // Rate limiter
    this.rateLimiter = new RateLimiterMemory({
      points: 100, // Number of points
      duration: 60, // Per 60 seconds
    })

    // Set up middleware and handlers
    this.setupMiddleware()
    this.setupHandlers()
    this.setupPresenceTracking()
    this.setupCleanup()

    console.log('✅ WebSocket server initialized')
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const cookies = parse(socket.request.headers.cookie || '')
        const sessionToken = 
          cookies['next-auth.session-token'] || 
          cookies['__Secure-next-auth.session-token']

        if (!sessionToken) {
          return next(new Error('No session token'))
        }

        // Verify session
        const session = await getServerSession(authOptions)
        if (!session?.user) {
          return next(new Error('Invalid session'))
        }

        // Check if user is banned
        const user = await db.user.findUnique({
          where: { id: session.user.id },
          select: { status: true },
        })

        if (user?.status === 'BANNED') {
          return next(new Error('User is banned'))
        }

        // Attach user data to socket
        socket.data = {
          userId: session.user.id,
          username: session.user.username,
          role: session.user.role,
          sessionId: socket.id,
        } as SocketData

        next()
      } catch (error) {
        console.error('Socket auth error:', error)
        next(new Error('Authentication failed'))
      }
    })

    // Rate limiting middleware
    this.io.use(async (socket, next) => {
      try {
        await this.rateLimiter.consume(socket.data.userId)
        next()
      } catch (error) {
        next(new Error('Rate limit exceeded'))
      }
    })
  }

  private setupHandlers() {
    this.io.on('connection', async (socket: Socket) => {
      const { userId, username } = socket.data as SocketData
      console.log(`👤 User ${username} connected (${socket.id})`)

      // Join user's personal room
      await socket.join(`user:${userId}`)

      // Update online status
      await this.updateUserStatus(userId, true)

      // Join followed users' activity rooms
      await this.joinFollowedUsersRooms(socket)

      // Register event handlers
      this.registerUserHandlers(socket)
      this.registerPostHandlers(socket)
      this.registerCommentHandlers(socket)
      this.registerChatHandlers(socket)
      this.registerPresenceHandlers(socket)
      this.registerWatchPartyHandlers(socket)

      // Handle disconnection
      socket.on('disconnect', async (reason) => {
        console.log(`👤 User ${username} disconnected (${reason})`)
        await this.handleDisconnect(socket)
      })

      // Send initial data
      await this.sendInitialData(socket)
    })
  }

  private registerUserHandlers(socket: Socket) {
    // Follow/unfollow events
    socket.on('user:follow', async (data: { userId: string }) => {
      try {
        const { userId: followerId } = socket.data as SocketData
        
        // Join the followed user's activity room
        await socket.join(`user:${data.userId}:activity`)
        
        // Notify the followed user
        this.io.to(`user:${data.userId}`).emit('user:followed', {
          followerId,
          timestamp: new Date(),
        })
      } catch (error) {
        socket.emit('error', { message: 'Failed to follow user' })
      }
    })

    socket.on('user:unfollow', async (data: { userId: string }) => {
      try {
        // Leave the user's activity room
        await socket.leave(`user:${data.userId}:activity`)
      } catch (error) {
        socket.emit('error', { message: 'Failed to unfollow user' })
      }
    })
  }

  private registerPostHandlers(socket: Socket) {
    // Join post room
    socket.on('post:join', async (data: unknown) => {
      try {
        const { room } = joinRoomSchema.parse(data)
        await socket.join(room)
        
        // Track presence
        this.trackPresence(room, socket.data.userId)
        
        // Send current viewers
        const viewers = await this.getRoomViewers(room)
        socket.emit('post:viewers', { room, viewers })
      } catch (error) {
        socket.emit('error', { message: 'Failed to join post' })
      }
    })

    // Leave post room
    socket.on('post:leave', async (data: { room: string }) => {
      try {
        await socket.leave(data.room)
        this.untrackPresence(data.room, socket.data.userId)
      } catch (error) {
        socket.emit('error', { message: 'Failed to leave post' })
      }
    })

    // Real-time post updates
    socket.on('post:view', async (data: { postId: string }) => {
      try {
        // Increment view count in Redis
        await this.redis.hincrby('post:views', data.postId, 1)
        
        // Emit updated view count
        const views = await this.redis.hget('post:views', data.postId)
        this.io.to(`post:${data.postId}`).emit('post:views:updated', {
          postId: data.postId,
          views: parseInt(views || '0'),
        })
      } catch (error) {
        console.error('Failed to track post view:', error)
      }
    })
  }

  private registerCommentHandlers(socket: Socket) {
    // Comment typing indicators
    socket.on('comment:typing:start', async (data: unknown) => {
      try {
        const validated = typingSchema.parse(data)
        const { username } = socket.data as SocketData
        
        socket.to(validated.room).emit('comment:typing', {
          userId: socket.data.userId,
          username,
          isTyping: true,
          room: validated.room,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid typing data' })
      }
    })

    socket.on('comment:typing:stop', async (data: unknown) => {
      try {
        const validated = typingSchema.parse(data)
        const { username } = socket.data as SocketData
        
        socket.to(validated.room).emit('comment:typing', {
          userId: socket.data.userId,
          username,
          isTyping: false,
          room: validated.room,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid typing data' })
      }
    })

    // Real-time comment reactions
    socket.on('comment:reaction', async (data: {
      commentId: string
      reaction: string
      action: 'add' | 'remove'
    }) => {
      try {
        this.io.to(`post:${data.commentId}`).emit('comment:reaction:update', {
          commentId: data.commentId,
          userId: socket.data.userId,
          reaction: data.reaction,
          action: data.action,
        })
      } catch (error) {
        socket.emit('error', { message: 'Failed to update reaction' })
      }
    })
  }

  private registerChatHandlers(socket: Socket) {
    // Join chat room
    socket.on('chat:join', async (data: { roomId: string }) => {
      try {
        const { userId, username } = socket.data as SocketData
        const room = `chat:${data.roomId}`
        
        await socket.join(room)
        
        // Notify others in the room
        socket.to(room).emit('chat:user:joined', {
          userId,
          username,
          timestamp: new Date(),
        })
        
        // Send recent messages
        const messages = await this.getRecentChatMessages(data.roomId)
        socket.emit('chat:messages:initial', messages)
      } catch (error) {
        socket.emit('error', { message: 'Failed to join chat' })
      }
    })

    // Send chat message
    socket.on('chat:message', async (data: {
      roomId: string
      message: string
      replyTo?: string
    }) => {
      try {
        const { userId, username } = socket.data as SocketData
        
        // Validate message
        if (!data.message || data.message.length > 1000) {
          throw new Error('Invalid message')
        }
        
        // Save message to database
        const message = await db.chatMessage.create({
          data: {
            roomId: data.roomId,
            userId,
            content: data.message,
            replyToId: data.replyTo,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                image: true,
              },
            },
            replyTo: {
              include: {
                user: {
                  select: {
                    username: true,
                  },
                },
              },
            },
          },
        })
        
        // Emit to room
        this.io.to(`chat:${data.roomId}`).emit('chat:message:new', message)
      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' })
      }
    })

    // Chat typing indicators
    socket.on('chat:typing', async (data: {
      roomId: string
      isTyping: boolean
    }) => {
      try {
        const { username } = socket.data as SocketData
        
        socket.to(`chat:${data.roomId}`).emit('chat:typing:update', {
          userId: socket.data.userId,
          username,
          isTyping: data.isTyping,
        })
      } catch (error) {
        socket.emit('error', { message: 'Failed to update typing status' })
      }
    })
  }

  private registerPresenceHandlers(socket: Socket) {
    // Update user presence
    socket.on('presence:update', async (data: unknown) => {
      try {
        const validated = presenceSchema.parse(data)
        const { userId } = socket.data as SocketData
        
        // Update presence in Redis
        await this.redis.hset(`presence:${userId}`, {
          location: validated.location,
          locationType: validated.locationType,
          status: validated.status,
          lastActiveAt: new Date().toISOString(),
        })
        
        // Emit to followers
        this.io.to(`user:${userId}:followers`).emit('presence:updated', {
          userId,
          ...validated,
        })
      } catch (error) {
        socket.emit('error', { message: 'Failed to update presence' })
      }
    })

    // Get online friends
    socket.on('presence:friends', async () => {
      try {
        const { userId } = socket.data as SocketData
        const friends = await this.getOnlineFriends(userId)
        socket.emit('presence:friends:list', friends)
      } catch (error) {
        socket.emit('error', { message: 'Failed to get online friends' })
      }
    })
  }

  private registerWatchPartyHandlers(socket: Socket) {
    // Join watch party
    socket.on('watchParty:join', async (data: { partyId: string }) => {
      try {
        const { userId, username } = socket.data as SocketData
        const room = `watchParty:${data.partyId}`
        
        // Check if user can join
        const party = await db.watchParty.findUnique({
          where: { id: data.partyId },
          include: {
            participants: {
              where: { userId },
            },
          },
        })
        
        if (!party) {
          throw new Error('Watch party not found')
        }
        
        if (party.participants.length === 0) {
          // Create participant record
          await db.watchPartyParticipant.create({
            data: {
              partyId: data.partyId,
              userId,
            },
          })
        }
        
        await socket.join(room)
        
        // Notify others
        socket.to(room).emit('watchParty:user:joined', {
          userId,
          username,
          timestamp: new Date(),
        })
        
        // Send current state
        const state = await this.getWatchPartyState(data.partyId)
        socket.emit('watchParty:state', state)
      } catch (error) {
        socket.emit('error', { message: 'Failed to join watch party' })
      }
    })

    // Sync video state
    socket.on('watchParty:sync', async (data: {
      partyId: string
      currentTime: number
      isPlaying: boolean
    }) => {
      try {
        const { userId } = socket.data as SocketData
        const room = `watchParty:${data.partyId}`
        
        // Verify host
        const party = await db.watchParty.findUnique({
          where: { id: data.partyId },
          select: { hostId: true },
        })
        
        if (party?.hostId !== userId) {
          throw new Error('Only the host can sync')
        }
        
        // Update state in Redis
        await this.redis.hset(`watchParty:${data.partyId}`, {
          currentTime: data.currentTime,
          isPlaying: data.isPlaying,
          lastSync: new Date().toISOString(),
        })
        
        // Broadcast to all participants
        socket.to(room).emit('watchParty:sync:update', {
          currentTime: data.currentTime,
          isPlaying: data.isPlaying,
        })
      } catch (error) {
        socket.emit('error', { message: 'Failed to sync watch party' })
      }
    })
  }

  private async joinFollowedUsersRooms(socket: Socket) {
    try {
      const { userId } = socket.data as SocketData
      
      // Get followed users
      const following = await db.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      })
      
      // Join their activity rooms
      for (const follow of following) {
        await socket.join(`user:${follow.followingId}:activity`)
      }
    } catch (error) {
      console.error('Failed to join followed users rooms:', error)
    }
  }

  private async sendInitialData(socket: Socket) {
    try {
      const { userId } = socket.data as SocketData
      
      // Send unread notification count
      const unreadCount = await db.notification.count({
        where: {
          userId,
          read: false,
        },
      })
      
      socket.emit('notifications:unread', { count: unreadCount })
      
      // Send online friends
      const onlineFriends = await this.getOnlineFriends(userId)
      socket.emit('presence:friends:list', onlineFriends)
    } catch (error) {
      console.error('Failed to send initial data:', error)
    }
  }

  private async handleDisconnect(socket: Socket) {
    try {
      const { userId } = socket.data as SocketData
      
      // Update user status
      await this.updateUserStatus(userId, false)
      
      // Clean up presence tracking
      for (const [room, users] of this.presenceTracker) {
        users.delete(userId)
        if (users.size === 0) {
          this.presenceTracker.delete(room)
        }
      }
      
      // Leave all rooms
      const rooms = Array.from(socket.rooms)
      for (const room of rooms) {
        if (room !== socket.id) {
          await socket.leave(room)
        }
      }
    } catch (error) {
      console.error('Failed to handle disconnect:', error)
    }
  }

  private async updateUserStatus(userId: string, isOnline: boolean) {
    try {
      if (isOnline) {
        await this.redis.sadd('users:online', userId)
        await db.user.update({
          where: { id: userId },
          data: {
            onlineStatus: true,
            lastSeenAt: new Date(),
          },
        })
      } else {
        await this.redis.srem('users:online', userId)
        await db.user.update({
          where: { id: userId },
          data: {
            onlineStatus: false,
            lastSeenAt: new Date(),
          },
        })
      }
      
      // Broadcast online users count
      const onlineCount = await this.redis.scard('users:online')
      this.io.emit('users:online:count', { count: onlineCount })
    } catch (error) {
      console.error('Failed to update user status:', error)
    }
  }

  private trackPresence(room: string, userId: string) {
    if (!this.presenceTracker.has(room)) {
      this.presenceTracker.set(room, new Set())
    }
    this.presenceTracker.get(room)!.add(userId)
  }

  private untrackPresence(room: string, userId: string) {
    const users = this.presenceTracker.get(room)
    if (users) {
      users.delete(userId)
      if (users.size === 0) {
        this.presenceTracker.delete(room)
      }
    }
  }

  private async getRoomViewers(room: string): Promise<string[]> {
    const users = this.presenceTracker.get(room)
    return users ? Array.from(users) : []
  }

  private async getOnlineFriends(userId: string) {
    try {
      // Get user's friends (mutual follows)
      const friends = await db.$queryRaw<{ id: string; username: string; image: string | null }[]>`
        SELECT DISTINCT u.id, u.username, u.image
        FROM users u
        WHERE u.id IN (
          SELECT f1.following_id
          FROM follows f1
          JOIN follows f2 ON f1.following_id = f2.follower_id
          WHERE f1.follower_id = ${userId}
          AND f2.following_id = ${userId}
        )
        AND u.online_status = true
      `
      
      return friends
    } catch (error) {
      console.error('Failed to get online friends:', error)
      return []
    }
  }

  private async getRecentChatMessages(roomId: string) {
    try {
      const messages = await db.chatMessage.findMany({
        where: {
          roomId,
          deleted: false,
        },
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              image: true,
            },
          },
          replyTo: {
            include: {
              user: {
                select: {
                  username: true,
                },
              },
            },
          },
        },
      })
      
      return messages.reverse()
    } catch (error) {
      console.error('Failed to get recent messages:', error)
      return []
    }
  }

  private async getWatchPartyState(partyId: string) {
    try {
      const state = await this.redis.hgetall(`watchParty:${partyId}`)
      const participants = await db.watchPartyParticipant.findMany({
        where: {
          partyId,
          isActive: true,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              image: true,
            },
          },
        },
      })
      
      return {
        currentTime: parseFloat(state.currentTime || '0'),
        isPlaying: state.isPlaying === 'true',
        participants: participants.map(p => p.user),
        lastSync: state.lastSync,
      }
    } catch (error) {
      console.error('Failed to get watch party state:', error)
      return null
    }
  }

  private setupPresenceTracking() {
    // Clean up stale presence data every minute
    setInterval(async () => {
      try {
        const now = Date.now()
        const staleThreshold = 5 * 60 * 1000 // 5 minutes
        
        // Get all presence keys
        const keys = await this.redis.keys('presence:*')
        
        for (const key of keys) {
          const data = await this.redis.hgetall(key)
          const lastActive = new Date(data.lastActiveAt).getTime()
          
          if (now - lastActive > staleThreshold) {
            await this.redis.del(key)
            const userId = key.split(':')[1]
            await this.updateUserStatus(userId, false)
          }
        }
      } catch (error) {
        console.error('Failed to clean up presence data:', error)
      }
    }, 60000)
  }

  private setupCleanup() {
    // Clean up old data periodically
    setInterval(async () => {
      try {
        // Clean up old view counts
        const viewKeys = await this.redis.hkeys('post:views')
        const now = Date.now()
        
        for (const postId of viewKeys) {
          // Move to persistent storage if needed
          const views = await this.redis.hget('post:views', postId)
          if (views && parseInt(views) > 0) {
            await db.postStats.update({
              where: { postId },
              data: {
                viewCount: {
                  increment: parseInt(views),
                },
              },
            }).catch(() => {
              // Post might not exist
            })
            
            await this.redis.hdel('post:views', postId)
          }
        }
      } catch (error) {
        console.error('Failed to clean up data:', error)
      }
    }, 300000) // Every 5 minutes
  }

  // Public methods for external use
  public emitToUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, data)
  }

  public emitToPost(postId: string, event: string, data: any) {
    this.io.to(`post:${postId}`).emit(event, data)
  }

  public emitToRoom(room: string, event: string, data: any) {
    this.io.to(room).emit(event, data)
  }

  public broadcast(event: string, data: any) {
    this.io.emit(event, data)
  }

  public async getIO(): Promise<SocketIOServer> {
    return this.io
  }
}

// Singleton instance
let wsServer: WebSocketServer | null = null

export function initializeWebSocketServer(httpServer: HTTPServer): WebSocketServer {
  if (!wsServer) {
    wsServer = new WebSocketServer(httpServer)
  }
  return wsServer
}

export function getWebSocketServer(): WebSocketServer | null {
  return wsServer
}
```

### 2. `/src/hooks/use-socket.ts` - Complete Implementation

```typescript
// src/hooks/use-socket.ts
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/components/ui/use-toast'
import { useQueryClient } from '@tanstack/react-query'

interface UseSocketOptions {
  autoConnect?: boolean
  reconnectionAttempts?: number
  reconnectionDelay?: number
}

interface TypingUser {
  userId: string
  username: string
  timestamp: number
}

export function useSocket(options: UseSocketOptions = {}) {
  const {
    autoConnect = true,
    reconnectionAttempts = 5,
    reconnectionDelay = 1000,
  } = options

  const { user, isAuthenticated } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map())
  
  const socketRef = useRef<Socket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
  const typingTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Initialize socket connection
  const connect = useCallback(() => {
    if (!isAuthenticated || !user || socketRef.current?.connected) {
      return
    }

    setIsConnecting(true)

    const newSocket = io(process.env.NEXT_PUBLIC_WS_URL || '', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionAttempts,
      reconnectionDelay,
      reconnection: true,
      autoConnect: false,
    })

    // Connection events
    newSocket.on('connect', () => {
      console.log('✅ Connected to WebSocket server')
      setIsConnected(true)
      setIsConnecting(false)
      setReconnectAttempt(0)
      
      toast({
        title: 'Connected',
        description: 'Real-time features are now active',
        duration: 2000,
      })
    })

    newSocket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from WebSocket server:', reason)
      setIsConnected(false)
      
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, don't auto-reconnect
        toast({
          title: 'Disconnected',
          description: 'You have been disconnected from the server',
          variant: 'destructive',
        })
      }
    })

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error.message)
      setIsConnecting(false)
      
      if (error.message === 'Authentication failed') {
        toast({
          title: 'Authentication Error',
          description: 'Please log in again',
          variant: 'destructive',
        })
      } else if (reconnectAttempt < reconnectionAttempts) {
        setReconnectAttempt(prev => prev + 1)
        reconnectTimeoutRef.current = setTimeout(() => {
          newSocket.connect()
        }, reconnectionDelay * Math.pow(2, reconnectAttempt))
      }
    })

    // Global events
    newSocket.on('error', (data: { message: string }) => {
      toast({
        title: 'Error',
        description: data.message,
        variant: 'destructive',
      })
    })

    // User events
    newSocket.on('users:online:count', (data: { count: number }) => {
      // Update online users count
    })

    newSocket.on('presence:friends:list', (friends: Array<{
      id: string
      username: string
      image: string | null
    }>) => {
      setOnlineUsers(new Set(friends.map(f => f.id)))
    })

    // Notification events
    newSocket.on('notification:new', (data: any) => {
      // Show notification toast
      toast({
        title: data.notification.title,
        description: data.notification.message,
        action: data.notification.actionUrl ? (
          <a href={data.notification.actionUrl}>View</a>
        ) : undefined,
      })
      
      // Invalidate notifications query
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })

    newSocket.on('notifications:unread', (data: { count: number }) => {
      // Update unread count in UI
      queryClient.setQueryData(['notifications', 'unreadCount'], data.count)
    })

    // Comment events
    newSocket.on('comment:created', (data: any) => {
      // Invalidate comments query for the post
      queryClient.invalidateQueries({ 
        queryKey: ['comments', { postId: data.postId }] 
      })
    })

    newSocket.on('comment:updated', (data: any) => {
      // Update comment in cache
      queryClient.setQueryData(['comment', data.comment.id], data.comment)
    })

    newSocket.on('comment:deleted', (data: any) => {
      // Remove comment from cache
      queryClient.removeQueries({ 
        queryKey: ['comment', data.commentId] 
      })
    })

    // Typing indicators
    newSocket.on('comment:typing', (data: {
      userId: string
      username: string
      isTyping: boolean
      room: string
    }) => {
      if (data.isTyping) {
        setTypingUsers(prev => {
          const next = new Map(prev)
          next.set(data.userId, {
            userId: data.userId,
            username: data.username,
            timestamp: Date.now(),
          })
          return next
        })

        // Clear after 3 seconds
        const existingTimeout = typingTimeoutRef.current.get(data.userId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
        }
        
        const timeout = setTimeout(() => {
          setTypingUsers(prev => {
            const next = new Map(prev)
            next.delete(data.userId)
            return next
          })
          typingTimeoutRef.current.delete(data.userId)
        }, 3000)
        
        typingTimeoutRef.current.set(data.userId, timeout)
      } else {
        setTypingUsers(prev => {
          const next = new Map(prev)
          next.delete(data.userId)
          return next
        })
        
        const timeout = typingTimeoutRef.current.get(data.userId)
        if (timeout) {
          clearTimeout(timeout)
          typingTimeoutRef.current.delete(data.userId)
        }
      }
    })

    // Watch party events
    newSocket.on('watchParty:sync:update', (data: {
      currentTime: number
      isPlaying: boolean
    }) => {
      // Handle watch party sync
      window.dispatchEvent(new CustomEvent('watchParty:sync', { detail: data }))
    })

    socketRef.current = newSocket
    setSocket(newSocket)

    if (autoConnect) {
      newSocket.connect()
    }

    return newSocket
  }, [isAuthenticated, user, autoConnect, reconnectionAttempts, reconnectionDelay, toast, queryClient])

  // Disconnect socket
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setSocket(null)
      setIsConnected(false)
      setOnlineUsers(new Set())
      setTypingUsers(new Map())
    }
  }, [])

  // Emit event
  const emit = useCallback((event: string, data?: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data)
    } else {
      console.warn(`Cannot emit ${event}: Socket not connected`)
    }
  }, [])

  // Subscribe to event
  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (socketRef.current) {
      socketRef.current.on(event, handler)
    }
    
    return () => {
      if (socketRef.current) {
        socketRef.current.off(event, handler)
      }
    }
  }, [])

  // One-time event listener
  const once = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (socketRef.current) {
      socketRef.current.once(event, handler)
    }
  }, [])

  // Join room
  const joinRoom = useCallback((room: string, roomType?: string) => {
    emit('room:join', { room, roomType })
  }, [emit])

  // Leave room
  const leaveRoom = useCallback((room: string) => {
    emit('room:leave', { room })
  }, [emit])

  // Typing indicators
  const startTyping = useCallback((room: string) => {
    emit('comment:typing:start', { room, isTyping: true })
  }, [emit])

  const stopTyping = useCallback((room: string) => {
    emit('comment:typing:stop', { room, isTyping: false })
  }, [emit])

  // Watch party controls
  const joinWatchParty = useCallback((partyId: string) => {
    emit('watchParty:join', { partyId })
  }, [emit])

  const syncWatchParty = useCallback((partyId: string, currentTime: number, isPlaying: boolean) => {
    emit('watchParty:sync', { partyId, currentTime, isPlaying })
  }, [emit])

  // Update presence
  const updatePresence = useCallback((location: string, locationType: string, status: string = 'active') => {
    emit('presence:update', { location, locationType, status })
  }, [emit])

  // Initialize connection
  useEffect(() => {
    if (autoConnect && isAuthenticated && !socketRef.current) {
      connect()
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      
      // Clear all typing timeouts
      typingTimeoutRef.current.forEach(timeout => clearTimeout(timeout))
      typingTimeoutRef.current.clear()
      
      disconnect()
    }
  }, [autoConnect, isAuthenticated, connect, disconnect])

  // Check if a user is online
  const isUserOnline = useCallback((userId: string) => {
    return onlineUsers.has(userId)
  }, [onlineUsers])

  // Get typing users for a room
  const getTypingUsers = useCallback((room?: string) => {
    return Array.from(typingUsers.values())
  }, [typingUsers])

  return {
    socket,
    isConnected,
    isConnecting,
    reconnectAttempt,
    onlineUsers: Array.from(onlineUsers),
    typingUsers: getTypingUsers(),
    
    // Methods
    connect,
    disconnect,
    emit,
    on,
    once,
    joinRoom,
    leaveRoom,
    startTyping,
    stopTyping,
    joinWatchParty,
    syncWatchParty,
    updatePresence,
    isUserOnline,
  }
}

// Hook for post-specific socket events
export function usePostSocket(postId: string) {
  const { joinRoom, leaveRoom, on, emit } = useSocket()
  const [viewers, setViewers] = useState<string[]>([])
  const [realtimeStats, setRealtimeStats] = useState({
    views: 0,
    likes: 0,
    comments: 0,
  })

  useEffect(() => {
    if (!postId) return

    // Join post room
    joinRoom(`post:${postId}`, 'post')
    
    // Track view
    emit('post:view', { postId })

    // Subscribe to events
    const unsubscribeViewers = on('post:viewers', (data: { viewers: string[] }) => {
      setViewers(data.viewers)
    })

    const unsubscribeStats = on('post:stats:updated', (data: any) => {
      setRealtimeStats(prev => ({ ...prev, ...data }))
    })

    return () => {
      leaveRoom(`post:${postId}`)
      unsubscribeViewers()
      unsubscribeStats()
    }
  }, [postId, joinRoom, leaveRoom, on, emit])

  return {
    viewers,
    realtimeStats,
  }
}

// Hook for chat-specific socket events
export function useChatSocket(roomId: string) {
  const { emit, on } = useSocket()
  const [messages, setMessages] = useState<any[]>([])
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!roomId) return

    // Join chat room
    emit('chat:join', { roomId })

    // Subscribe to events
    const unsubscribeMessages = on('chat:messages:initial', (data: any[]) => {
      setMessages(data)
    })

    const unsubscribeNewMessage = on('chat:message:new', (message: any) => {
      setMessages(prev => [...prev, message])
    })

    const unsubscribeTyping = on('chat:typing:update', (data: {
      userId: string
      username: string
      isTyping: boolean
    }) => {
      setTypingUsers(prev => {
        const next = new Map(prev)
        if (data.isTyping) {
          next.set(data.userId, data.username)
        } else {
          next.delete(data.userId)
        }
        return next
      })
    })

    return () => {
      emit('chat:leave', { roomId })
      unsubscribeMessages()
      unsubscribeNewMessage()
      unsubscribeTyping()
    }
  }, [roomId, emit, on])

  const sendMessage = useCallback((message: string, replyTo?: string) => {
    emit('chat:message', { roomId, message, replyTo })
  }, [roomId, emit])

  const setTyping = useCallback((isTyping: boolean) => {
    emit('chat:typing', { roomId, isTyping })
  }, [roomId, emit])

  return {
    messages,
    typingUsers: Array.from(typingUsers.values()),
    sendMessage,
    setTyping,
  }
}
```

### 3. `/src/server/services/youtube.service.ts` - Complete Implementation

```typescript
// src/server/services/youtube.service.ts
import { google, youtube_v3 } from 'googleapis'
import { CacheService } from './cache.service'
import { db } from '@/lib/db'
import { TRPCError } from '@trpc/server'

interface VideoDetails {
  id: string
  title: string
  description: string
  thumbnail: string
  thumbnailHd: string | null
  channelId: string
  channelTitle: string
  duration: number // in seconds
  durationFormatted: string
  viewCount: number
  likeCount: number
  commentCount: number
  publishedAt: Date
  tags: string[]
  categoryId: string
  liveBroadcast: boolean
  premiereDate: Date | null
  embedHtml: string
  statistics: {
    viewCount: string
    likeCount: string
    commentCount: string
    favoriteCount: string
  }
}

interface ChannelDetails {
  id: string
  title: string
  description: string
  customUrl: string | null
  thumbnail: string
  bannerUrl: string | null
  subscriberCount: number
  videoCount: number
  viewCount: number
  country: string | null
  joinedDate: Date
  topics: string[]
  keywords: string[]
  isVerified: boolean
}

interface PlaylistDetails {
  id: string
  title: string
  description: string
  thumbnail: string
  channelId: string
  channelTitle: string
  itemCount: number
  privacy: string
  publishedAt: Date
}

export class YouTubeService {
  private youtube: youtube_v3.Youtube
  private cacheService: CacheService
  private apiKey: string
  private quotaTracker: Map<string, number>

  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY!
    if (!this.apiKey) {
      throw new Error('YouTube API key is not configured')
    }

    this.youtube = google.youtube({
      version: 'v3',
      auth: this.apiKey,
    })

    this.cacheService = new CacheService()
    this.quotaTracker = new Map()

    // Reset quota daily
    this.scheduleQuotaReset()
  }

  async getVideoDetails(videoId: string): Promise<VideoDetails> {
    // Check cache first
    const cacheKey = `youtube:video:${videoId}`
    const cached = await this.cacheService.get<VideoDetails>(cacheKey)
    if (cached) return cached

    try {
      // Check quota
      await this.checkQuota(1)

      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails', 'liveStreamingDetails', 'player'],
        id: [videoId],
        maxResults: 1,
      })

      const video = response.data.items?.[0]
      if (!video) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Video not found',
        })
      }

      // Parse video details
      const details: VideoDetails = {
        id: video.id!,
        title: video.snippet?.title || '',
        description: video.snippet?.description || '',
        thumbnail: video.snippet?.thumbnails?.high?.url || 
                   video.snippet?.thumbnails?.default?.url || '',
        thumbnailHd: video.snippet?.thumbnails?.maxres?.url || null,
        channelId: video.snippet?.channelId || '',
        channelTitle: video.snippet?.channelTitle || '',
        duration: this.parseDuration(video.contentDetails?.duration || ''),
        durationFormatted: this.formatDuration(video.contentDetails?.duration || ''),
        viewCount: parseInt(video.statistics?.viewCount || '0'),
        likeCount: parseInt(video.statistics?.likeCount || '0'),
        commentCount: parseInt(video.statistics?.commentCount || '0'),
        publishedAt: new Date(video.snippet?.publishedAt || ''),
        tags: video.snippet?.tags || [],
        categoryId: video.snippet?.categoryId || '',
        liveBroadcast: video.snippet?.liveBroadcastContent !== 'none',
        premiereDate: video.liveStreamingDetails?.scheduledStartTime 
          ? new Date(video.liveStreamingDetails.scheduledStartTime)
          : null,
        embedHtml: video.player?.embedHtml || '',
        statistics: video.statistics as any,
      }

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, details, 3600)

      // Store in database for analytics
      await this.storeVideoData(details)

      // Track quota usage
      await this.trackQuotaUsage(1)

      return details
    } catch (error) {
      console.error('YouTube API error:', error)
      
      // Try to get from database as fallback
      const dbVideo = await this.getVideoFromDatabase(videoId)
      if (dbVideo) return dbVideo

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch video details',
      })
    }
  }

  async getChannelDetails(channelId: string): Promise<ChannelDetails> {
    const cacheKey = `youtube:channel:${channelId}`
    const cached = await this.cacheService.get<ChannelDetails>(cacheKey)
    if (cached) return cached

    try {
      await this.checkQuota(1)

      const response = await this.youtube.channels.list({
        part: ['snippet', 'statistics', 'brandingSettings', 'topicDetails'],
        id: [channelId],
        maxResults: 1,
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
        customUrl: channel.snippet?.customUrl || null,
        thumbnail: channel.snippet?.thumbnails?.high?.url || 
                   channel.snippet?.thumbnails?.default?.url || '',
        bannerUrl: channel.brandingSettings?.image?.bannerExternalUrl || null,
        subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
        videoCount: parseInt(channel.statistics?.videoCount || '0'),
        viewCount: parseInt(channel.statistics?.viewCount || '0'),
        country: channel.snippet?.country || null,
        joinedDate: new Date(channel.snippet?.publishedAt || ''),
        topics: channel.topicDetails?.topicIds || [],
        keywords: channel.brandingSettings?.channel?.keywords?.split(',') || [],
        isVerified: channel.status?.isLinked || false,
      }

      // Cache for 24 hours
      await this.cacheService.set(cacheKey, details, 86400)

      // Store in database
      await this.storeChannelData(details)

      await this.trackQuotaUsage(1)

      return details
    } catch (error) {
      console.error('YouTube API error:', error)
      
      const dbChannel = await this.getChannelFromDatabase(channelId)
      if (dbChannel) return dbChannel

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch channel details',
      })
    }
  }

  async searchVideos(query: string, options: {
    maxResults?: number
    order?: 'relevance' | 'date' | 'rating' | 'viewCount' | 'title'
    channelId?: string
    type?: 'video' | 'channel' | 'playlist'
    videoDuration?: 'short' | 'medium' | 'long'
    publishedAfter?: Date
    publishedBefore?: Date
  } = {}): Promise<any[]> {
    const cacheKey = `youtube:search:${JSON.stringify({ query, ...options })}`
    const cached = await this.cacheService.get<any[]>(cacheKey)
    if (cached) return cached

    try {
      await this.checkQuota(100) // Search costs 100 quota units

      const searchParams: any = {
        part: ['snippet'],
        q: query,
        maxResults: options.maxResults || 10,
        order: options.order || 'relevance',
        type: options.type || 'video',
        safeSearch: 'moderate',
      }

      if (options.channelId) {
        searchParams.channelId = options.channelId
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

      const results = response.data.items?.map(item => ({
        id: item.id?.videoId || item.id?.channelId || item.id?.playlistId,
        type: item.id?.kind?.split('#')[1],
        title: item.snippet?.title,
        description: item.snippet?.description,
        thumbnail: item.snippet?.thumbnails?.high?.url || 
                   item.snippet?.thumbnails?.default?.url,
        channelId: item.snippet?.channelId,
        channelTitle: item.snippet?.channelTitle,
        publishedAt: item.snippet?.publishedAt,
      })) || []

      // Cache for 30 minutes
      await this.cacheService.set(cacheKey, results, 1800)

      await this.trackQuotaUsage(100)

      return results
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to search videos',
      })
    }
  }

  async getPlaylistItems(playlistId: string, options: {
    maxResults?: number
    pageToken?: string
  } = {}): Promise<{
    items: any[]
    nextPageToken?: string
    totalResults: number
  }> {
    const cacheKey = `youtube:playlist:${playlistId}:${options.pageToken || 'first'}`
    const cached = await this.cacheService.get<any>(cacheKey)
    if (cached) return cached

    try {
      await this.checkQuota(1)

      const response = await this.youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults: options.maxResults || 50,
        pageToken: options.pageToken,
      })

      const result = {
        items: response.data.items?.map(item => ({
          id: item.id,
          videoId: item.contentDetails?.videoId,
          title: item.snippet?.title,
          description: item.snippet?.description,
          thumbnail: item.snippet?.thumbnails?.high?.url || 
                     item.snippet?.thumbnails?.default?.url,
          channelId: item.snippet?.channelId,
          channelTitle: item.snippet?.channelTitle,
          position: item.snippet?.position,
          addedAt: item.snippet?.publishedAt,
        })) || [],
        nextPageToken: response.data.nextPageToken || undefined,
        totalResults: response.data.pageInfo?.totalResults || 0,
      }

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, result, 3600)

      await this.trackQuotaUsage(1)

      return result
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch playlist items',
      })
    }
  }

  async getVideoComments(videoId: string, options: {
    maxResults?: number
    order?: 'time' | 'relevance'
    pageToken?: string
  } = {}): Promise<{
    items: any[]
    nextPageToken?: string
    totalResults: number
  }> {
    try {
      await this.checkQuota(1)

      const response = await this.youtube.commentThreads.list({
        part: ['snippet', 'replies'],
        videoId,
        maxResults: options.maxResults || 20,
        order: options.order || 'relevance',
        pageToken: options.pageToken,
      })

      const result = {
        items: response.data.items?.map(item => ({
          id: item.id,
          text: item.snippet?.topLevelComment?.snippet?.textDisplay,
          author: item.snippet?.topLevelComment?.snippet?.authorDisplayName,
          authorChannelId: item.snippet?.topLevelComment?.snippet?.authorChannelId?.value,
          authorProfileImage: item.snippet?.topLevelComment?.snippet?.authorProfileImageUrl,
          likeCount: item.snippet?.topLevelComment?.snippet?.likeCount,
          publishedAt: item.snippet?.topLevelComment?.snippet?.publishedAt,
          updatedAt: item.snippet?.topLevelComment?.snippet?.updatedAt,
          replyCount: item.snippet?.totalReplyCount,
          replies: item.replies?.comments?.map(reply => ({
            id: reply.id,
            text: reply.snippet?.textDisplay,
            author: reply.snippet?.authorDisplayName,
            authorChannelId: reply.snippet?.authorChannelId?.value,
            authorProfileImage: reply.snippet?.authorProfileImageUrl,
            likeCount: reply.snippet?.likeCount,
            publishedAt: reply.snippet?.publishedAt,
          })),
        })) || [],
        nextPageToken: response.data.nextPageToken || undefined,
        totalResults: response.data.pageInfo?.totalResults || 0,
      }

      await this.trackQuotaUsage(1)

      return result
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch video comments',
      })
    }
  }

  async getRelatedVideos(videoId: string, maxResults: number = 10): Promise<any[]> {
    const cacheKey = `youtube:related:${videoId}`
    const cached = await this.cacheService.get<any[]>(cacheKey)
    if (cached) return cached

    try {
      await this.checkQuota(100)

      // YouTube API v3 doesn't directly support relatedToVideoId anymore
      // We'll use search with the video's tags and channel as a workaround
      const videoDetails = await this.getVideoDetails(videoId)
      
      const searchQuery = videoDetails.tags.slice(0, 3).join(' ')
      const results = await this.searchVideos(searchQuery, {
        maxResults,
        channelId: videoDetails.channelId,
        type: 'video',
      })

      // Filter out the current video
      const filtered = results.filter(v => v.id !== videoId)

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, filtered, 3600)

      return filtered
    } catch (error) {
      console.error('YouTube API error:', error)
      return []
    }
  }

  async getTrendingVideos(options: {
    regionCode?: string
    categoryId?: string
    maxResults?: number
  } = {}): Promise<any[]> {
    const cacheKey = `youtube:trending:${JSON.stringify(options)}`
    const cached = await this.cacheService.get<any[]>(cacheKey)
    if (cached) return cached

    try {
      await this.checkQuota(1)

      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics'],
        chart: 'mostPopular',
        regionCode: options.regionCode || 'US',
        videoCategoryId: options.categoryId,
        maxResults: options.maxResults || 10,
      })

      const results = response.data.items?.map(video => ({
        id: video.id,
        title: video.snippet?.title,
        description: video.snippet?.description,
        thumbnail: video.snippet?.thumbnails?.high?.url || 
                   video.snippet?.thumbnails?.default?.url,
        channelId: video.snippet?.channelId,
        channelTitle: video.snippet?.channelTitle,
        viewCount: parseInt(video.statistics?.viewCount || '0'),
        likeCount: parseInt(video.statistics?.likeCount || '0'),
        publishedAt: video.snippet?.publishedAt,
      })) || []

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, results, 3600)

      await this.trackQuotaUsage(1)

      return results
    } catch (error) {
      console.error('YouTube API error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch trending videos',
      })
    }
  }

  // Helper methods
  private parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    if (!match) return 0

    const hours = parseInt(match[1] || '0')
    const minutes = parseInt(match[2] || '0')
    const seconds = parseInt(match[3] || '0')

    return hours * 3600 + minutes * 60 + seconds
  }

  private formatDuration(duration: string): string {
    const seconds = this.parseDuration(duration)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  private async checkQuota(cost: number) {
    const today = new Date().toDateString()
    const usage = this.quotaTracker.get(today) || 0
    const limit = 10000 // YouTube API daily quota

    if (usage + cost > limit) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'YouTube API quota exceeded. Please try again tomorrow.',
      })
    }
  }

  private async trackQuotaUsage(cost: number) {
    const today = new Date().toDateString()
    const current = this.quotaTracker.get(today) || 0
    this.quotaTracker.set(today, current + cost)

    // Also track in database
    await db.youTubeApiQuota.upsert({
      where: { date: new Date(today) },
      create: {
        date: new Date(today),
        unitsUsed: cost,
        quotaLimit: 10000,
        resetAt: new Date(new Date().setDate(new Date().getDate() + 1)),
      },
      update: {
        unitsUsed: { increment: cost },
      },
    }).catch(console.error)
  }

  private scheduleQuotaReset() {
    // Reset quota at midnight
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    
    const msUntilMidnight = midnight.getTime() - now.getTime()
    
    setTimeout(() => {
      this.quotaTracker.clear()
      this.scheduleQuotaReset() // Schedule next reset
    }, msUntilMidnight)
  }

  private async storeVideoData(video: VideoDetails) {
    try {
      await db.youtubeVideo.upsert({
        where: { videoId: video.id },
        create: {
          videoId: video.id,
          channelId: video.channelId,
          title: video.title,
          description: video.description,
          thumbnailUrl: video.thumbnail,
          thumbnailUrlHd: video.thumbnailHd,
          duration: video.duration,
          durationFormatted: video.durationFormatted,
          viewCount: BigInt(video.viewCount),
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          tags: video.tags,
          categoryId: video.categoryId,
          liveBroadcast: video.liveBroadcast,
          premiereDate: video.premiereDate,
          publishedAt: video.publishedAt,
          metadata: video as any,
          lastSyncedAt: new Date(),
        },
        update: {
          title: video.title,
          viewCount: BigInt(video.viewCount),
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          lastSyncedAt: new Date(),
        },
      })
    } catch (error) {
      console.error('Failed to store video data:', error)
    }
  }

  private async storeChannelData(channel: ChannelDetails) {
    try {
      await db.youtubeChannel.upsert({
        where: { channelId: channel.id },
        create: {
          channelId: channel.id,
          channelTitle: channel.title,
          channelDescription: channel.description,
          channelHandle: channel.customUrl,
          thumbnailUrl: channel.thumbnail,
          bannerUrl: channel.bannerUrl,
          subscriberCount: BigInt(channel.subscriberCount),
          viewCount: BigInt(channel.viewCount),
          videoCount: channel.videoCount,
          channelData: channel as any,
          verified: channel.isVerified,
          lastSyncedAt: new Date(),
        },
        update: {
          channelTitle: channel.title,
          subscriberCount: BigInt(channel.subscriberCount),
          viewCount: BigInt(channel.viewCount),
          videoCount: channel.videoCount,
          verified: channel.isVerified,
          lastSyncedAt: new Date(),
        },
      })
    } catch (error) {
      console.error('Failed to store channel data:', error)
    }
  }

  private async getVideoFromDatabase(videoId: string): Promise<VideoDetails | null> {
    try {
      const video = await db.youtubeVideo.findUnique({
        where: { videoId },
      })

      if (!video) return null

      return {
        id: video.videoId,
        title: video.title || '',
        description: video.description || '',
        thumbnail: video.thumbnailUrl || '',
        thumbnailHd: video.thumbnailUrlHd,
        channelId: video.channelId,
        channelTitle: '',
        duration: video.duration || 0,
        durationFormatted: video.durationFormatted || '',
        viewCount: Number(video.viewCount),
        likeCount: video.likeCount,
        commentCount: video.commentCount,
        publishedAt: video.publishedAt || new Date(),
        tags: video.tags,
        categoryId: video.categoryId || '',
        liveBroadcast: video.liveBroadcast,
        premiereDate: video.premiereDate,
        embedHtml: '',
        statistics: video.metadata as any,
      }
    } catch (error) {
      console.error('Failed to get video from database:', error)
      return null
    }
  }

  private async getChannelFromDatabase(channelId: string): Promise<ChannelDetails | null> {
    try {
      const channel = await db.youtubeChannel.findUnique({
        where: { channelId },
      })

      if (!channel) return null

      return {
        id: channel.channelId,
        title: channel.channelTitle || '',
        description: channel.channelDescription || '',
        customUrl: channel.channelHandle,
        thumbnail: channel.thumbnailUrl || '',
        bannerUrl: channel.bannerUrl,
        subscriberCount: Number(channel.subscriberCount),
        videoCount: channel.videoCount,
        viewCount: Number(channel.viewCount),
        country: null,
        joinedDate: channel.createdAt,
        topics: [],
        keywords: [],
        isVerified: channel.verified,
      }
    } catch (error) {
      console.error('Failed to get channel from database:', error)
      return null
    }
  }

  // Public method to get quota usage
  async getQuotaUsage(): Promise<{
    used: number
    limit: number
    remaining: number
    resetAt: Date
  }> {
    const today = new Date().toDateString()
    const used = this.quotaTracker.get(today) || 0
    const limit = 10000

    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)

    return {
      used,
      limit,
      remaining: limit - used,
      resetAt: midnight,
    }
  }
}

// Export singleton instance
export const youtubeService = new YouTubeService()
```

### 4. `/src/components/features/youtube/youtube-embed.tsx` - Complete Implementation

```typescript
// src/components/features/youtube/youtube-embed.tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { api } from '@/lib/api'
import { cn, formatDuration, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useInView } from '@/hooks/use-in-view'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  ExternalLink,
  Clock,
  Eye,
  ThumbsUp,
  MessageSquare,
  Share2,
  Sparkles,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface YouTubeEmbedProps {
  videoId: string
  className?: string
  showDetails?: boolean
  showRelated?: boolean
  autoplay?: boolean
  muted?: boolean
  controls?: boolean
  startTime?: number
  endTime?: number
  onTimeUpdate?: (currentTime: number) => void
  onPlay?: () => void
  onPause?: () => void
  onEnded?: () => void
  aspectRatio?: '16/9' | '4/3' | '1/1'
  quality?: 'default' | 'small' | 'medium' | 'large' | 'hd720' | 'hd1080'
}

interface PlayerState {
  isLoading: boolean
  isPlaying: boolean
  isMuted: boolean
  currentTime: number
  duration: number
  volume: number
  error: string | null
}

export function YouTubeEmbed({
  videoId,
  className,
  showDetails = true,
  showRelated = false,
  autoplay = false,
  muted = false,
  controls = true,
  startTime,
  endTime,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
  aspectRatio = '16/9',
  quality = 'default',
}: YouTubeEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playerRef = useRef<any>(null)
  const isInView = useInView(containerRef)
  
  const [playerState, setPlayerState] = useState<PlayerState>({
    isLoading: true,
    isPlaying: false,
    isMuted: muted,
    currentTime: startTime || 0,
    duration: 0,
    volume: muted ? 0 : 100,
    error: null,
  })
  
  const [showPlayer, setShowPlayer] = useState(autoplay)
  const [isYouTubeAPIReady, setIsYouTubeAPIReady] = useState(false)

  // Fetch video details
  const { data: video, isLoading: isLoadingDetails, error: detailsError } = api.youtube.getVideo.useQuery(
    { videoId },
    { 
      enabled: showDetails && !!videoId,
      staleTime: 3600000, // 1 hour
    }
  )

  // Fetch related videos
  const { data: relatedVideos } = api.youtube.getRelated.useQuery(
    { videoId, limit: 4 },
    { 
      enabled: showRelated && !!videoId,
      staleTime: 3600000,
    }
  )

  // Load YouTube IFrame API
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if API is already loaded
    if (window.YT && window.YT.Player) {
      setIsYouTubeAPIReady(true)
      return
    }

    // Load the IFrame Player API code asynchronously
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)

    // API ready callback
    window.onYouTubeIframeAPIReady = () => {
      setIsYouTubeAPIReady(true)
    }

    return () => {
      window.onYouTubeIframeAPIReady = undefined
    }
  }, [])

  // Initialize player when API is ready and player is shown
  useEffect(() => {
    if (!isYouTubeAPIReady || !showPlayer || !containerRef.current) return

    const playerId = `youtube-player-${videoId}`
    
    // Create container for player
    const playerContainer = document.createElement('div')
    playerContainer.id = playerId
    containerRef.current.appendChild(playerContainer)

    // Player configuration
    const playerVars: any = {
      autoplay: autoplay ? 1 : 0,
      controls: controls ? 1 : 0,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      mute: muted ? 1 : 0,
      playsinline: 1,
      origin: window.location.origin,
    }

    if (startTime) playerVars.start = startTime
    if (endTime) playerVars.end = endTime
    if (quality !== 'default') playerVars.vq = quality

    // Create player
    playerRef.current = new window.YT.Player(playerId, {
      videoId,
      playerVars,
      events: {
        onReady: handlePlayerReady,
        onStateChange: handlePlayerStateChange,
        onError: handlePlayerError,
      },
    })

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [isYouTubeAPIReady, showPlayer, videoId, autoplay, muted, controls, startTime, endTime, quality])

  // Player event handlers
  const handlePlayerReady = (event: any) => {
    setPlayerState(prev => ({
      ...prev,
      isLoading: false,
      duration: event.target.getDuration(),
    }))
  }

  const handlePlayerStateChange = (event: any) => {
    const player = event.target
    
    switch (event.data) {
      case window.YT.PlayerState.PLAYING:
        setPlayerState(prev => ({ ...prev, isPlaying: true }))
        onPlay?.()
        startTimeTracking()
        break
      case window.YT.PlayerState.PAUSED:
        setPlayerState(prev => ({ ...prev, isPlaying: false }))
        onPause?.()
        stopTimeTracking()
        break
      case window.YT.PlayerState.ENDED:
        setPlayerState(prev => ({ ...prev, isPlaying: false }))
        onEnded?.()
        stopTimeTracking()
        break
    }
  }

  const handlePlayerError = (event: any) => {
    const errorMessages: Record<number, string> = {
      2: 'Invalid video ID',
      5: 'HTML5 player error',
      100: 'Video not found',
      101: 'Video is not embeddable',
      150: 'Video is not embeddable',
    }
    
    setPlayerState(prev => ({
      ...prev,
      error: errorMessages[event.data] || 'An error occurred',
      isLoading: false,
    }))
  }

  // Time tracking
  const timeTrackingRef = useRef<NodeJS.Timeout>()
  
  const startTimeTracking = () => {
    if (timeTrackingRef.current) return
    
    const trackTime = () => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        const currentTime = playerRef.current.getCurrentTime()
        setPlayerState(prev => ({ ...prev, currentTime }))
        onTimeUpdate?.(currentTime)
      }
    }
    
    timeTrackingRef.current = setInterval(trackTime, 1000)
  }
  
  const stopTimeTracking = () => {
    if (timeTrackingRef.current) {
      clearInterval(timeTrackingRef.current)
      timeTrackingRef.current = undefined
    }
  }

  // Player controls
  const togglePlay = useCallback(() => {
    if (!playerRef.current) return
    
    if (playerState.isPlaying) {
      playerRef.current.pauseVideo()
    } else {
      playerRef.current.playVideo()
    }
  }, [playerState.isPlaying])

  const toggleMute = useCallback(() => {
    if (!playerRef.current) return
    
    if (playerState.isMuted) {
      playerRef.current.unMute()
      setPlayerState(prev => ({ ...prev, isMuted: false }))
    } else {
      playerRef.current.mute()
      setPlayerState(prev => ({ ...prev, isMuted: true }))
    }
  }, [playerState.isMuted])

  const handleFullscreen = useCallback(() => {
    const iframe = containerRef.current?.querySelector('iframe')
    if (!iframe) return
    
    if (iframe.requestFullscreen) {
      iframe.requestFullscreen()
    }
  }, [])

  const handleShare = useCallback(async () => {
    const url = `https://youtube.com/watch?v=${videoId}`
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: video?.title || 'Check out this video',
          url,
        })
      } catch (error) {
        // User cancelled sharing
      }
    } else {
      await navigator.clipboard.writeText(url)
      // Show toast notification
    }
  }, [videoId, video])

  // Render error state
  if (playerState.error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{playerState.error}</AlertDescription>
      </Alert>
    )
  }

  // Render thumbnail preview
  if (!showPlayer) {
    return (
      <div className={cn('relative group cursor-pointer', className)}>
        <div 
          className={cn(
            'relative overflow-hidden rounded-lg bg-black',
            aspectRatio === '16/9' && 'aspect-video',
            aspectRatio === '4/3' && 'aspect-[4/3]',
            aspectRatio === '1/1' && 'aspect-square'
          )}
          onClick={() => setShowPlayer(true)}
        >
          {/* Thumbnail */}
          <Image
            src={video?.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
            alt={video?.title || 'Video thumbnail'}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            priority={isInView}
          />
          
          {/* Play button overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
            <div className="bg-red-600 hover:bg-red-700 rounded-full p-4 transform group-hover:scale-110 transition-all shadow-2xl">
              <Play className="w-8 h-8 text-white fill-white ml-1" />
            </div>
          </div>

          {/* Duration badge */}
          {video?.duration && (
            <Badge 
              variant="secondary" 
              className="absolute bottom-2 right-2 bg-black/80 text-white border-0"
            >
              {video.durationFormatted}
            </Badge>
          )}

          {/* Live badge */}
          {video?.liveBroadcast && (
            <Badge 
              variant="destructive" 
              className="absolute top-2 left-2 gap-1"
            >
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
              LIVE
            </Badge>
          )}
        </div>

        {/* Video details */}
        {showDetails && video && (
          <div className="mt-3 space-y-2">
            <h3 className="font-semibold line-clamp-2">{video.title}</h3>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{video.channelTitle}</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {formatNumber(video.viewCount)}
                </span>
                <span className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3" />
                  {formatNumber(video.likeCount)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {showDetails && isLoadingDetails && (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render player
  return (
    <div className={cn('space-y-4', className)}>
      {/* Player container */}
      <Card className="overflow-hidden">
        <div 
          ref={containerRef}
          className={cn(
            'relative bg-black',
            aspectRatio === '16/9' && 'aspect-video',
            aspectRatio === '4/3' && 'aspect-[4/3]',
            aspectRatio === '1/1' && 'aspect-square'
          )}
        >
          {playerState.isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Custom controls (if enabled) */}
        {controls && playerRef.current && (
          <div className="p-3 bg-background/95 backdrop-blur">
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={togglePlay}
                className="h-8 w-8 p-0"
              >
                {playerState.isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={toggleMute}
                className="h-8 w-8 p-0"
              >
                {playerState.isMuted ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>

              <div className="flex-1 text-xs text-muted-foreground">
                {formatDuration(playerState.currentTime)} / {formatDuration(playerState.duration)}
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleFullscreen}
                className="h-8 w-8 p-0"
              >
                <Maximize className="h-4 w-4" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleShare}
                className="h-8 w-8 p-0"
              >
                <Share2 className="h-4 w-4" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                asChild
                className="h-8 w-8 p-0"
              >
                <a
                  href={`https://youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Video details */}
      {showDetails && video && (
        <Card className="p-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">{video.title}</h3>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span>{video.channelTitle}</span>
                <span>•</span>
                <span>{formatNumber(video.viewCount)} views</span>
                <span>•</span>
                <span>{new Date(video.publishedAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-4 w-4" />
                <span className="text-sm">{formatNumber(video.likeCount)}</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <span className="text-sm">{formatNumber(video.commentCount)}</span>
              </div>
            </div>

            {video.description && (
              <div className="pt-3 border-t">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {video.description}
                </p>
              </div>
            )}

            {video.tags && video.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-3 border-t">
                {video.tags.slice(0, 5).map((tag, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Related videos */}
      {showRelated && relatedVideos && relatedVideos.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Related Videos
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {relatedVideos.map((relatedVideo) => (
              <Card
                key={relatedVideo.id}
                className="p-3 hover:bg-accent/50 transition-colors cursor-pointer"
                onClick={() => {
                  // Handle video change
                  window.location.href = `?v=${relatedVideo.id}`
                }}
              >
                <div className="flex gap-3">
                  <div className="relative w-32 aspect-video rounded overflow-hidden shrink-0">
                    <Image
                      src={relatedVideo.thumbnail}
                      alt={relatedVideo.title}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <h5 className="text-sm font-medium line-clamp-2">
                      {relatedVideo.title}
                    </h5>
                    <p className="text-xs text-muted-foreground">
                      {relatedVideo.channelTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(relatedVideo.viewCount)} views
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Declare YouTube types
declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}
```

### 5. `/src/server/services/search.service.ts` - Complete Implementation

```typescript
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
```

### 6. Additional Components for Phase 4

#### `/src/server/services/cache.service.ts` - Caching Service

```typescript
// src/server/services/cache.service.ts
import { Redis } from 'ioredis'

export class CacheService {
  private redis: Redis | null = null
  private localCache: Map<string, { value: any; expiry: number }> = new Map()

  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL)
      console.log('✅ Redis cache connected')
    } else {
      console.warn('⚠️  Redis not configured, using in-memory cache')
    }

    // Clean up expired entries every minute
    setInterval(() => this.cleanupLocalCache(), 60000)
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      // Try local cache first
      const local = this.localCache.get(key)
      if (local && local.expiry > Date.now()) {
        return local.value as T
      }

      // Try Redis if available
      if (this.redis) {
        const value = await this.redis.get(key)
        if (value) {
          const parsed = JSON.parse(value)
          // Store in local cache for faster access
          this.localCache.set(key, {
            value: parsed,
            expiry: Date.now() + 60000, // 1 minute local cache
          })
          return parsed as T
        }
      }

      return null
    } catch (error) {
      console.error('Cache get error:', error)
      return null
    }
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    try {
      const serialized = JSON.stringify(value)
      
      // Set in local cache
      this.localCache.set(key, {
        value,
        expiry: Date.now() + (ttl * 1000),
      })

      // Set in Redis if available
      if (this.redis) {
        await this.redis.setex(key, ttl, serialized)
      }
    } catch (error) {
      console.error('Cache set error:', error)
    }
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      // Clear from local cache
      const keysToDelete: string[] = []
      for (const key of this.localCache.keys()) {
        if (key.includes(pattern)) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach(key => this.localCache.delete(key))

      // Clear from Redis if available
      if (this.redis) {
        const keys = await this.redis.keys(`*${pattern}*`)
        if (keys.length > 0) {
          await this.redis.del(...keys)
        }
      }
    } catch (error) {
      console.error('Cache invalidate error:', error)
    }
  }

  async flush(): Promise<void> {
    try {
      this.localCache.clear()
      if (this.redis) {
        await this.redis.flushdb()
      }
    } catch (error) {
      console.error('Cache flush error:', error)
    }
  }

  private cleanupLocalCache() {
    const now = Date.now()
    const keysToDelete: string[] = []
    
    for (const [key, data] of this.localCache.entries()) {
      if (data.expiry <= now) {
        keysToDelete.push(key)
      }
    }
    
    keysToDelete.forEach(key => this.localCache.delete(key))
  }
}
```

#### `/src/server/services/recommendation.service.ts` - Basic Recommendation Engine

```typescript
// src/server/services/recommendation.service.ts
import { PrismaClient } from '@prisma/client'
import { CacheService } from './cache.service'

export class RecommendationService {
  private cacheService: CacheService

  constructor(private db: PrismaClient) {
    this.cacheService = new CacheService()
  }

  async getRecommendedPosts(userId: string, limit: number = 10) {
    const cacheKey = `recommendations:posts:${userId}`
    const cached = await this.cacheService.get(cacheKey)
    if (cached) return cached

    // Get user's interests based on their activity
    const userInterests = await this.getUserInterests(userId)
    
    // Get posts based on interests
    const posts = await this.db.post.findMany({
      where: {
        published: true,
        authorId: { not: userId },
        OR: [
          // Posts with similar tags
          {
            tags: {
              some: {
                tagId: { in: userInterests.tagIds },
              },
            },
          },
          // Posts from followed users
          {
            author: {
              followers: {
                some: { followerId: userId },
              },
            },
          },
          // Popular posts in user's categories
          {
            categoryId: { in: userInterests.categoryIds },
            views: { gte: 100 },
          },
        ],
      },
      include: {
        author: {
          include: {
            profile: true,
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy: [
        { views: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    })

    // Cache for 30 minutes
    await this.cacheService.set(cacheKey, posts, 1800)

    return posts
  }

  private async getUserInterests(userId: string) {
    // Get user's recent activity
    const [viewedPosts, likedPosts, commentedPosts] = await Promise.all([
      // Recently viewed posts
      this.db.viewHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          post: {
            include: {
              tags: true,
            },
          },
        },
      }),
      // Recently liked posts
      this.db.reaction.findMany({
        where: { userId, postId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          post: {
            include: {
              tags: true,
            },
          },
        },
      }),
      // Recently commented posts
      this.db.comment.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          post: {
            include: {
              tags: true,
            },
          },
        },
      }),
    ])

    // Extract tags and categories
    const tagIds = new Set<string>()
    const categoryIds = new Set<string>()

    const processPost = (post: any) => {
      if (post) {
        post.tags?.forEach((t: any) => tagIds.add(t.tagId || t.id))
        if (post.categoryId) categoryIds.add(post.categoryId)
      }
    }

    viewedPosts.forEach(v => processPost(v.post))
    likedPosts.forEach(r => processPost(r.post))
    commentedPosts.forEach(c => processPost(c.post))

    return {
      tagIds: Array.from(tagIds),
      categoryIds
