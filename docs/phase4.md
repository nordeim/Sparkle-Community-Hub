# 🚀 Phase 4: Advanced Features - Complete Implementation

I'll create all Phase 4 files with meticulous attention to real-time features, YouTube integration, and advanced search capabilities.

## 🔌 1. `/src/server/websocket/socket.server.ts`

```typescript
// src/server/websocket/socket.server.ts
import { Server as HTTPServer } from 'http'
import { Server as SocketServer, Socket } from 'socket.io'
import { parse } from 'cookie'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/auth.config'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import { db } from '@/lib/db'
import { RateLimiter } from '@/lib/rate-limiter'
import { monitoring } from '@/lib/monitoring'
import { z } from 'zod'

// Event schemas for type safety
const eventSchemas = {
  'post:join': z.object({ postId: z.string() }),
  'post:leave': z.object({ postId: z.string() }),
  'post:view': z.object({ postId: z.string() }),
  'comment:typing:start': z.object({ postId: z.string() }),
  'comment:typing:stop': z.object({ postId: z.string() }),
  'user:status': z.object({ status: z.enum(['online', 'away', 'busy']) }),
  'notification:mark-read': z.object({ notificationId: z.string() }),
  'live:join': z.object({ liveId: z.string() }),
  'live:leave': z.object({ liveId: z.string() }),
  'live:message': z.object({ liveId: z.string(), message: z.string() }),
}

interface SocketData {
  userId: string
  username: string
  role: string
  sessionId: string
}

interface TypingUser {
  userId: string
  username: string
  avatar?: string
}

export class WebSocketServer {
  private io: SocketServer
  private rateLimiter: RateLimiter
  private typingUsers: Map<string, Map<string, TypingUser>> = new Map() // postId -> Map<userId, user>
  private userSockets: Map<string, Set<string>> = new Map() // userId -> Set<socketId>
  private presenceRedis: Redis
  private pubClient: Redis
  private subClient: Redis

  constructor(httpServer: HTTPServer) {
    // Initialize Redis clients
    this.pubClient = new Redis(process.env.REDIS_URL!)
    this.subClient = this.pubClient.duplicate()
    this.presenceRedis = this.pubClient.duplicate()

    // Initialize Socket.io with Redis adapter for scaling
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL?.split(',') || ['http://localhost:3000'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    })

    // Use Redis adapter for horizontal scaling
    this.io.adapter(createAdapter(this.pubClient, this.subClient))

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter()

    // Set up middleware and handlers
    this.setupMiddleware()
    this.setupHandlers()
    this.setupCleanupTasks()

    console.log('WebSocket server initialized')
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const cookies = parse(socket.request.headers.cookie || '')
        const sessionToken = 
          cookies['__Secure-next-auth.session-token'] || 
          cookies['next-auth.session-token']

        if (!sessionToken) {
          return next(new Error('No session token'))
        }

        // Verify session
        const session = await getServerSession(authOptions)
        if (!session?.user) {
          return next(new Error('Invalid session'))
        }

        // Rate limiting
        const limited = await this.rateLimiter.checkLimit(session.user.id, {
          windowMs: 60000,
          maxRequests: 100,
          namespace: 'websocket',
        })

        if (!limited.success) {
          return next(new Error('Rate limit exceeded'))
        }

        // Attach user data to socket
        socket.data = {
          userId: session.user.id,
          username: session.user.username,
          role: session.user.role,
          sessionId: sessionToken.substring(0, 8), // Short ID for tracking
        } as SocketData

        next()
      } catch (error) {
        console.error('WebSocket auth error:', error)
        next(new Error('Authentication failed'))
      }
    })

    // Error handling middleware
    this.io.use((socket, next) => {
      socket.on('error', (error) => {
        console.error(`Socket error for user ${socket.data?.userId}:`, error)
        monitoring.trackError(error, {
          userId: socket.data?.userId,
          socketId: socket.id,
        })
      })
      next()
    })
  }

  private setupHandlers() {
    this.io.on('connection', async (socket) => {
      const { userId, username } = socket.data as SocketData

      console.log(`User ${username} (${userId}) connected via socket ${socket.id}`)

      // Track user socket connection
      this.addUserSocket(userId, socket.id)

      // Join user's personal room
      socket.join(`user:${userId}`)

      // Update user presence
      await this.updateUserPresence(userId, 'online')

      // Emit online users to the new user
      const onlineUsers = await this.getOnlineUsers()
      socket.emit('users:online', onlineUsers)

      // Notify others that user is online
      socket.broadcast.emit('user:online', { userId, username })

      // Set up event handlers
      this.setupPostHandlers(socket)
      this.setupCommentHandlers(socket)
      this.setupNotificationHandlers(socket)
      this.setupUserHandlers(socket)
      this.setupLiveHandlers(socket)

      // Handle disconnection
      socket.on('disconnect', async (reason) => {
        console.log(`User ${username} disconnected: ${reason}`)
        
        // Remove from typing users
        this.removeUserFromAllTyping(userId)
        
        // Remove socket tracking
        this.removeUserSocket(userId, socket.id)
        
        // Update presence if no more sockets
        const userSockets = this.userSockets.get(userId)
        if (!userSockets || userSockets.size === 0) {
          await this.updateUserPresence(userId, 'offline')
          socket.broadcast.emit('user:offline', { userId })
        }
      })
    })
  }

  private setupPostHandlers(socket: Socket) {
    const { userId } = socket.data as SocketData

    // Join post room
    socket.on('post:join', async (data) => {
      try {
        const validated = eventSchemas['post:join'].parse(data)
        socket.join(`post:${validated.postId}`)
        
        // Track active viewers
        await this.trackPostViewer(validated.postId, userId, true)
        
        // Emit viewer count update
        const viewerCount = await this.getPostViewerCount(validated.postId)
        this.io.to(`post:${validated.postId}`).emit('post:viewers', {
          postId: validated.postId,
          count: viewerCount,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid post join data' })
      }
    })

    // Leave post room
    socket.on('post:leave', async (data) => {
      try {
        const validated = eventSchemas['post:leave'].parse(data)
        socket.leave(`post:${validated.postId}`)
        
        // Remove from active viewers
        await this.trackPostViewer(validated.postId, userId, false)
        
        // Remove from typing if applicable
        this.removeUserFromTyping(validated.postId, userId)
        
        // Emit updated viewer count
        const viewerCount = await this.getPostViewerCount(validated.postId)
        this.io.to(`post:${validated.postId}`).emit('post:viewers', {
          postId: validated.postId,
          count: viewerCount,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid post leave data' })
      }
    })

    // Track post view
    socket.on('post:view', async (data) => {
      try {
        const validated = eventSchemas['post:view'].parse(data)
        
        // Increment view count in database
        await db.post.update({
          where: { id: validated.postId },
          data: { views: { increment: 1 } },
        })
        
        // Track analytics
        monitoring.trackEvent('post_viewed', {
          postId: validated.postId,
          userId,
        })
      } catch (error) {
        console.error('Error tracking post view:', error)
      }
    })
  }

  private setupCommentHandlers(socket: Socket) {
    const { userId, username } = socket.data as SocketData

    // Typing indicators
    socket.on('comment:typing:start', async (data) => {
      try {
        const validated = eventSchemas['comment:typing:start'].parse(data)
        const { postId } = validated

        // Get user avatar
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { image: true },
        })

        // Add to typing users
        this.addUserToTyping(postId, {
          userId,
          username,
          avatar: user?.image || undefined,
        })

        // Broadcast to post room (except sender)
        socket.to(`post:${postId}`).emit('comment:typing', {
          postId,
          users: this.getTypingUsers(postId),
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid typing data' })
      }
    })

    socket.on('comment:typing:stop', async (data) => {
      try {
        const validated = eventSchemas['comment:typing:stop'].parse(data)
        const { postId } = validated

        // Remove from typing users
        this.removeUserFromTyping(postId, userId)

        // Broadcast to post room
        socket.to(`post:${postId}`).emit('comment:typing', {
          postId,
          users: this.getTypingUsers(postId),
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid typing data' })
      }
    })
  }

  private setupNotificationHandlers(socket: Socket) {
    const { userId } = socket.data as SocketData

    // Mark notification as read
    socket.on('notification:mark-read', async (data) => {
      try {
        const validated = eventSchemas['notification:mark-read'].parse(data)
        
        // Update in database
        await db.notification.update({
          where: {
            id: validated.notificationId,
            userId, // Ensure user owns the notification
          },
          data: { read: true },
        })

        // Get updated unread count
        const unreadCount = await db.notification.count({
          where: {
            userId,
            read: false,
          },
        })

        // Emit updated count to user's other devices
        this.io.to(`user:${userId}`).emit('notification:unread-count', {
          count: unreadCount,
        })
      } catch (error) {
        socket.emit('error', { message: 'Failed to mark notification as read' })
      }
    })
  }

  private setupUserHandlers(socket: Socket) {
    const { userId } = socket.data as SocketData

    // Update user status
    socket.on('user:status', async (data) => {
      try {
        const validated = eventSchemas['user:status'].parse(data)
        
        // Update presence with status
        await this.updateUserPresence(userId, validated.status)
        
        // Broadcast to all users
        socket.broadcast.emit('user:status-changed', {
          userId,
          status: validated.status,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid status data' })
      }
    })

    // Get online users
    socket.on('users:get-online', async () => {
      const onlineUsers = await this.getOnlineUsers()
      socket.emit('users:online', onlineUsers)
    })
  }

  private setupLiveHandlers(socket: Socket) {
    const { userId, username } = socket.data as SocketData

    // Join live session (watch party, etc.)
    socket.on('live:join', async (data) => {
      try {
        const validated = eventSchemas['live:join'].parse(data)
        const { liveId } = validated

        socket.join(`live:${liveId}`)

        // Track live viewer
        await this.trackLiveViewer(liveId, userId, true)

        // Get current viewers
        const viewers = await this.getLiveViewers(liveId)

        // Notify others in the live session
        socket.to(`live:${liveId}`).emit('live:user-joined', {
          userId,
          username,
          viewers: viewers.length,
        })

        // Send current state to joining user
        socket.emit('live:state', {
          liveId,
          viewers,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid live join data' })
      }
    })

    // Leave live session
    socket.on('live:leave', async (data) => {
      try {
        const validated = eventSchemas['live:leave'].parse(data)
        const { liveId } = validated

        socket.leave(`live:${liveId}`)

        // Remove from live viewers
        await this.trackLiveViewer(liveId, userId, false)

        // Get updated viewers
        const viewers = await this.getLiveViewers(liveId)

        // Notify others
        socket.to(`live:${liveId}`).emit('live:user-left', {
          userId,
          username,
          viewers: viewers.length,
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid live leave data' })
      }
    })

    // Send message in live session
    socket.on('live:message', async (data) => {
      try {
        const validated = eventSchemas['live:message'].parse(data)
        const { liveId, message } = validated

        // Rate limit live messages
        const limited = await this.rateLimiter.checkLimit(userId, {
          windowMs: 60000,
          maxRequests: 30,
          namespace: `live:${liveId}`,
        })

        if (!limited.success) {
          socket.emit('error', { message: 'Too many messages' })
          return
        }

        // Broadcast to live session
        this.io.to(`live:${liveId}`).emit('live:message', {
          userId,
          username,
          message,
          timestamp: new Date(),
        })
      } catch (error) {
        socket.emit('error', { message: 'Invalid message data' })
      }
    })
  }

  // Public methods for emitting events from other services
  async emitToUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, data)
  }

  async emitToPost(postId: string, event: string, data: any) {
    this.io.to(`post:${postId}`).emit(event, data)
  }

  async emitToLive(liveId: string, event: string, data: any) {
    this.io.to(`live:${liveId}`).emit(event, data)
  }

  async broadcast(event: string, data: any) {
    this.io.emit(event, data)
  }

  // Notification methods
  async sendNotification(notification: any) {
    // Format notification for real-time delivery
    const formattedNotification = {
      id: notification.id,
      type: notification.type,
      message: notification.message,
      actor: notification.actor ? {
        id: notification.actor.id,
        username: notification.actor.username,
        image: notification.actor.image,
      } : null,
      data: notification.data,
      createdAt: notification.createdAt,
      read: notification.read,
    }

    // Emit to user's room
    await this.emitToUser(notification.userId, 'notification:new', formattedNotification)

    // Update unread count
    const unreadCount = await db.notification.count({
      where: {
        userId: notification.userId,
        read: false,
      },
    })

    await this.emitToUser(notification.userId, 'notification:unread-count', {
      count: unreadCount,
    })
  }

  // Comment event methods
  async notifyNewComment(comment: any) {
    await this.emitToPost(comment.postId, 'comment:created', {
      comment: {
        id: comment.id,
        content: comment.content,
        author: {
          id: comment.author.id,
          username: comment.author.username,
          image: comment.author.image,
          verified: comment.author.verified,
        },
        parentId: comment.parentId,
        createdAt: comment.createdAt,
      },
    })
  }

  async notifyCommentUpdate(comment: any) {
    await this.emitToPost(comment.postId, 'comment:updated', {
      commentId: comment.id,
      content: comment.content,
      edited: true,
      editedAt: comment.editedAt,
    })
  }

  async notifyCommentDeleted(postId: string, commentId: string) {
    await this.emitToPost(postId, 'comment:deleted', {
      commentId,
    })
  }

  async notifyCommentReaction(postId: string, commentId: string, reaction: any) {
    await this.emitToPost(postId, 'comment:reacted', {
      commentId,
      reaction: {
        type: reaction.type,
        userId: reaction.userId,
      },
    })
  }

  // Post event methods
  async notifyPostUpdate(post: any) {
    await this.emitToPost(post.id, 'post:updated', {
      postId: post.id,
      title: post.title,
      content: post.content,
      updatedAt: post.updatedAt,
    })
  }

  async notifyPostReaction(postId: string, reaction: any) {
    // Get updated reaction count
    const reactionCount = await db.reaction.count({
      where: { postId },
    })

    await this.emitToPost(postId, 'post:reacted', {
      postId,
      reaction: {
        type: reaction.type,
        userId: reaction.userId,
      },
      totalReactions: reactionCount,
    })
  }

  // Private helper methods
  private addUserSocket(userId: string, socketId: string) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set())
    }
    this.userSockets.get(userId)!.add(socketId)
  }

  private removeUserSocket(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId)
    if (sockets) {
      sockets.delete(socketId)
      if (sockets.size === 0) {
        this.userSockets.delete(userId)
      }
    }
  }

  private addUserToTyping(postId: string, user: TypingUser) {
    if (!this.typingUsers.has(postId)) {
      this.typingUsers.set(postId, new Map())
    }
    this.typingUsers.get(postId)!.set(user.userId, user)

    // Auto-remove after 5 seconds if not updated
    setTimeout(() => {
      this.removeUserFromTyping(postId, user.userId)
    }, 5000)
  }

  private removeUserFromTyping(postId: string, userId: string) {
    const postTypingUsers = this.typingUsers.get(postId)
    if (postTypingUsers) {
      postTypingUsers.delete(userId)
      if (postTypingUsers.size === 0) {
        this.typingUsers.delete(postId)
      }
    }
  }

  private removeUserFromAllTyping(userId: string) {
    this.typingUsers.forEach((users, postId) => {
      if (users.has(userId)) {
        users.delete(userId)
        // Notify others in the post
        this.io.to(`post:${postId}`).emit('comment:typing', {
          postId,
          users: Array.from(users.values()),
        })
      }
    })
  }

  private getTypingUsers(postId: string): TypingUser[] {
    const users = this.typingUsers.get(postId)
    return users ? Array.from(users.values()) : []
  }

  private async updateUserPresence(userId: string, status: string) {
    const key = `presence:${userId}`
    const data = {
      status,
      lastSeen: Date.now(),
    }

    // Store in Redis with TTL
    await this.presenceRedis.setex(
      key,
      300, // 5 minutes TTL
      JSON.stringify(data)
    )
  }

  private async getOnlineUsers(): Promise<Array<{ userId: string; status: string }>> {
    const keys = await this.presenceRedis.keys('presence:*')
    const users = []

    for (const key of keys) {
      const data = await this.presenceRedis.get(key)
      if (data) {
        const parsed = JSON.parse(data)
        const userId = key.replace('presence:', '')
        users.push({
          userId,
          status: parsed.status,
        })
      }
    }

    return users
  }

  private async trackPostViewer(postId: string, userId: string, join: boolean) {
    const key = `post:${postId}:viewers`
    
    if (join) {
      await this.presenceRedis.sadd(key, userId)
      await this.presenceRedis.expire(key, 3600) // 1 hour TTL
    } else {
      await this.presenceRedis.srem(key, userId)
    }
  }

  private async getPostViewerCount(postId: string): Promise<number> {
    const key = `post:${postId}:viewers`
    return this.presenceRedis.scard(key)
  }

  private async trackLiveViewer(liveId: string, userId: string, join: boolean) {
    const key = `live:${liveId}:viewers`
    
    if (join) {
      await this.presenceRedis.sadd(key, userId)
      await this.presenceRedis.expire(key, 7200) // 2 hours TTL
    } else {
      await this.presenceRedis.srem(key, userId)
    }
  }

  private async getLiveViewers(liveId: string): Promise<string[]> {
    const key = `live:${liveId}:viewers`
    return this.presenceRedis.smembers(key)
  }

  private setupCleanupTasks() {
    // Clean up stale presence data every minute
    setInterval(async () => {
      try {
        const keys = await this.presenceRedis.keys('presence:*')
        const now = Date.now()

        for (const key of keys) {
          const data = await this.presenceRedis.get(key)
          if (data) {
            const parsed = JSON.parse(data)
            // Remove if last seen more than 5 minutes ago
            if (now - parsed.lastSeen > 300000) {
              await this.presenceRedis.del(key)
            }
          }
        }
      } catch (error) {
        console.error('Error cleaning up presence data:', error)
      }
    }, 60000) // Every minute

    // Clean up empty typing users
    setInterval(() => {
      this.typingUsers.forEach((users, postId) => {
        if (users.size === 0) {
          this.typingUsers.delete(postId)
        }
      })
    }, 10000) // Every 10 seconds
  }

  // Graceful shutdown
  async shutdown() {
    console.log('Shutting down WebSocket server...')
    
    // Close all connections
    this.io.disconnectSockets(true)
    
    // Close Redis connections
    await this.pubClient.quit()
    await this.subClient.quit()
    await this.presenceRedis.quit()
    
    // Close Socket.io server
    await new Promise<void>((resolve) => {
      this.io.close(() => {
        console.log('WebSocket server closed')
        resolve()
      })
    })
  }
}

// Export singleton instance
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

## 🪝 2. `/src/hooks/use-socket.ts`

```typescript
// src/hooks/use-socket.ts
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from './use-auth'
import { toast } from '@/components/ui/use-toast'

interface UseSocketOptions {
  autoConnect?: boolean
  reconnection?: boolean
  reconnectionAttempts?: number
  reconnectionDelay?: number
}

interface SocketState {
  isConnected: boolean
  isConnecting: boolean
  error: Error | null
  reconnectAttempt: number
}

export function useSocket(options: UseSocketOptions = {}) {
  const { user } = useAuth()
  const [state, setState] = useState<SocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    reconnectAttempt: 0,
  })
  
  const socketRef = useRef<Socket | null>(null)
  const listenersRef = useRef<Map<string, Set<Function>>>(new Map())
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()

  // Initialize socket connection
  const connect = useCallback(() => {
    if (!user || socketRef.current?.connected) return

    setState(prev => ({ ...prev, isConnecting: true, error: null }))

    const socket = io(process.env.NEXT_PUBLIC_WS_URL || '', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: options.reconnection ?? true,
      reconnectionAttempts: options.reconnectionAttempts ?? 5,
      reconnectionDelay: options.reconnectionDelay ?? 1000,
      autoConnect: false,
    })

    // Connection event handlers
    socket.on('connect', () => {
      console.log('WebSocket connected:', socket.id)
      setState({
        isConnected: true,
        isConnecting: false,
        error: null,
        reconnectAttempt: 0,
      })
      
      // Re-attach all listeners
      listenersRef.current.forEach((handlers, event) => {
        handlers.forEach(handler => {
          socket.on(event, handler as any)
        })
      })
    })

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason)
      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
      }))

      // Handle disconnect reasons
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, don't auto-reconnect
        toast({
          title: 'Disconnected',
          description: 'You have been disconnected from the server.',
          variant: 'destructive',
        })
      }
    })

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message)
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: new Error(error.message),
      }))
    })

    socket.io.on('reconnect_attempt', (attemptNumber) => {
      setState(prev => ({
        ...prev,
        isConnecting: true,
        reconnectAttempt: attemptNumber,
      }))
    })

    socket.io.on('reconnect_failed', () => {
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: new Error('Failed to reconnect'),
      }))
      
      toast({
        title: 'Connection failed',
        description: 'Unable to connect to the server. Please refresh the page.',
        variant: 'destructive',
      })
    })

    // Custom event: handle errors from server
    socket.on('error', (data: { message: string }) => {
      console.error('Server error:', data.message)
      toast({
        title: 'Error',
        description: data.message,
        variant: 'destructive',
      })
    })

    socketRef.current = socket
    socket.connect()
  }, [user, options])

  // Disconnect socket
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setState({
        isConnected: false,
        isConnecting: false,
        error: null,
        reconnectAttempt: 0,
      })
    }
  }, [])

  // Emit event
  const emit = useCallback((event: string, data?: any) => {
    if (!socketRef.current?.connected) {
      console.warn('Socket not connected, cannot emit:', event)
      return
    }

    socketRef.current.emit(event, data)
  }, [])

  // Subscribe to event
  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    // Track listener
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set())
    }
    listenersRef.current.get(event)!.add(handler)

    // Add listener if socket is connected
    if (socketRef.current?.connected) {
      socketRef.current.on(event, handler)
    }

    // Return cleanup function
    return () => {
      const handlers = listenersRef.current.get(event)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          listenersRef.current.delete(event)
        }
      }

      if (socketRef.current) {
        socketRef.current.off(event, handler)
      }
    }
  }, [])

  // Unsubscribe from event
  const off = useCallback((event: string, handler?: (...args: any[]) => void) => {
    if (!handler) {
      // Remove all handlers for this event
      listenersRef.current.delete(event)
      if (socketRef.current) {
        socketRef.current.removeAllListeners(event)
      }
    } else {
      // Remove specific handler
      const handlers = listenersRef.current.get(event)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          listenersRef.current.delete(event)
        }
      }

      if (socketRef.current) {
        socketRef.current.off(event, handler)
      }
    }
  }, [])

  // Join a room (e.g., post room for real-time updates)
  const joinRoom = useCallback((roomType: string, roomId: string) => {
    emit(`${roomType}:join`, { [`${roomType}Id`]: roomId })
  }, [emit])

  // Leave a room
  const leaveRoom = useCallback((roomType: string, roomId: string) => {
    emit(`${roomType}:leave`, { [`${roomType}Id`]: roomId })
  }, [emit])

  // Typing indicators
  const startTyping = useCallback((postId: string) => {
    emit('comment:typing:start', { postId })
  }, [emit])

  const stopTyping = useCallback((postId: string) => {
    emit('comment:typing:stop', { postId })
  }, [emit])

  // User status
  const updateStatus = useCallback((status: 'online' | 'away' | 'busy') => {
    emit('user:status', { status })
  }, [emit])

  // Mark notification as read
  const markNotificationRead = useCallback((notificationId: string) => {
    emit('notification:mark-read', { notificationId })
  }, [emit])

  // Get online users
  const getOnlineUsers = useCallback(() => {
    emit('users:get-online')
  }, [emit])

  // Auto-connect when user is available
  useEffect(() => {
    if (user && (options.autoConnect ?? true)) {
      connect()
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      disconnect()
    }
  }, [user, connect, disconnect, options.autoConnect])

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, update status to away
        if (socketRef.current?.connected) {
          updateStatus('away')
        }
      } else {
        // Page is visible, update status to online
        if (socketRef.current?.connected) {
          updateStatus('online')
        } else if (user) {
          // Reconnect if needed
          connect()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user, connect, updateStatus])

  return {
    // Connection state
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    error: state.error,
    reconnectAttempt: state.reconnectAttempt,
    
    // Connection methods
    connect,
    disconnect,
    
    // Event methods
    emit,
    on,
    off,
    
    // Room methods
    joinRoom,
    leaveRoom,
    
    // Utility methods
    startTyping,
    stopTyping,
    updateStatus,
    markNotificationRead,
    getOnlineUsers,
    
    // Raw socket instance (use with caution)
    socket: socketRef.current,
  }
}

// Typed event helpers
export function useSocketEvent<T = any>(
  event: string,
  handler: (data: T) => void,
  deps: React.DependencyList = []
) {
  const { on, off } = useSocket()

  useEffect(() => {
    const unsubscribe = on(event, handler)
    return unsubscribe
  }, [event, ...deps])
}

// Helper hook for post real-time updates
export function usePostSocket(postId: string | null) {
  const socket = useSocket()
  const [viewers, setViewers] = useState(0)
  const [typingUsers, setTypingUsers] = useState<Array<{
    userId: string
    username: string
    avatar?: string
  }>>([])

  useEffect(() => {
    if (!postId || !socket.isConnected) return

    // Join post room
    socket.joinRoom('post', postId)

    // Set up event listeners
    const handleViewers = (data: { postId: string; count: number }) => {
      if (data.postId === postId) {
        setViewers(data.count)
      }
    }

    const handleTyping = (data: { postId: string; users: any[] }) => {
      if (data.postId === postId) {
        setTypingUsers(data.users)
      }
    }

    const unsubscribeViewers = socket.on('post:viewers', handleViewers)
    const unsubscribeTyping = socket.on('comment:typing', handleTyping)

    // Track view
    socket.emit('post:view', { postId })

    return () => {
      // Leave room and clean up
      socket.leaveRoom('post', postId)
      unsubscribeViewers()
      unsubscribeTyping()
    }
  }, [postId, socket.isConnected])

  return {
    viewers,
    typingUsers,
    startTyping: () => postId && socket.startTyping(postId),
    stopTyping: () => postId && socket.stopTyping(postId),
  }
}

// Helper hook for notification real-time updates
export function useNotificationSocket() {
  const socket = useSocket()
  const [unreadCount, setUnreadCount] = useState(0)

  useSocketEvent('notification:new', (notification: any) => {
    // Show toast notification
    toast({
      title: notification.actor?.username || 'System',
      description: notification.message,
    })
    
    // You could also update a global notification store here
  })

  useSocketEvent('notification:unread-count', (data: { count: number }) => {
    setUnreadCount(data.count)
  })

  return {
    unreadCount,
    markAsRead: (notificationId: string) => socket.markNotificationRead(notificationId),
  }
}

// Helper hook for live sessions (watch parties, etc.)
export function useLiveSocket(liveId: string | null) {
  const socket = useSocket()
  const [viewers, setViewers] = useState<string[]>([])
  const [messages, setMessages] = useState<Array<{
    userId: string
    username: string
    message: string
    timestamp: Date
  }>>([])

  useEffect(() => {
    if (!liveId || !socket.isConnected) return

    // Join live session
    socket.joinRoom('live', liveId)

    // Set up event listeners
    const handleState = (data: { liveId: string; viewers: string[] }) => {
      if (data.liveId === liveId) {
        setViewers(data.viewers)
      }
    }

    const handleUserJoined = (data: { userId: string; viewers: number }) => {
      // Update viewers count or fetch new list
    }

    const handleMessage = (data: any) => {
      setMessages(prev => [...prev, data])
    }

    const unsubscribeState = socket.on('live:state', handleState)
    const unsubscribeJoined = socket.on('live:user-joined', handleUserJoined)
    const unsubscribeMessage = socket.on('live:message', handleMessage)

    return () => {
      // Leave room and clean up
      socket.leaveRoom('live', liveId)
      unsubscribeState()
      unsubscribeJoined()
      unsubscribeMessage()
    }
  }, [liveId, socket.isConnected])

  const sendMessage = useCallback((message: string) => {
    if (!liveId) return
    socket.emit('live:message', { liveId, message })
  }, [liveId, socket])

  return {
    viewers,
    messages,
    sendMessage,
  }
}
```

## 🎥 3. `/src/server/services/youtube.service.ts`

```typescript
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
```

## 🎬 4. `/src/components/features/youtube/youtube-embed.tsx`

```typescript
// src/components/features/youtube/youtube-embed.tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Play, ExternalLink, Clock, Eye, ThumbsUp, MessageSquare, Volume2, VolumeX, Maximize, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDuration, formatCompactNumber, formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface YouTubeEmbedProps {
  videoId: string
  className?: string
  showDetails?: boolean
  showControls?: boolean
  autoplay?: boolean
  muted?: boolean
  loop?: boolean
  startTime?: number
  endTime?: number
  aspectRatio?: '16:9' | '4:3' | '9:16'
  quality?: 'auto' | 'small' | 'medium' | 'large' | 'hd720' | 'hd1080'
  onPlay?: () => void
  onPause?: () => void
  onEnd?: () => void
  onError?: (error: string) => void
}

interface PlayerState {
  isLoading: boolean
  isPlaying: boolean
  isPlayerReady: boolean
  isMuted: boolean
  currentTime: number
  duration: number
  error: string | null
}

// YouTube Player API types
declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

export function YouTubeEmbed({
  videoId,
  className,
  showDetails = true,
  showControls = true,
  autoplay = false,
  muted = false,
  loop = false,
  startTime,
  endTime,
  aspectRatio = '16:9',
  quality = 'auto',
  onPlay,
  onPause,
  onEnd,
  onError,
}: YouTubeEmbedProps) {
  const [state, setState] = useState<PlayerState>({
    isLoading: true,
    isPlaying: false,
    isPlayerReady: false,
    isMuted: muted,
    currentTime: 0,
    duration: 0,
    error: null,
  })

  const [showPlayer, setShowPlayer] = useState(autoplay)
  const [isFullscreen, setIsFullscreen] = useState(false)
  
  const playerRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressIntervalRef = useRef<NodeJS.Timeout>()

  // Fetch video details
  const { data: video, isLoading: isLoadingDetails } = api.youtube.getVideo.useQuery(
    { videoId },
    { 
      enabled: showDetails && !!videoId,
      staleTime: 3600000, // 1 hour
    }
  )

  // Load YouTube IFrame API
  useEffect(() => {
    if (!showPlayer || typeof window === 'undefined') return

    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)

    window.onYouTubeIframeAPIReady = () => {
      initializePlayer()
    }

    // Cleanup
    return () => {
      if (playerRef.current) {
        playerRef.current.destroy()
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [showPlayer, videoId])

  const initializePlayer = useCallback(() => {
    if (!window.YT || !containerRef.current) return

    const playerVars: any = {
      autoplay: autoplay ? 1 : 0,
      controls: showControls ? 1 : 0,
      disablekb: 0,
      enablejsapi: 1,
      fs: 1,
      hl: 'en',
      loop: loop ? 1 : 0,
      modestbranding: 1,
      origin: window.location.origin,
      playsinline: 1,
      rel: 0,
      showinfo: 0,
      mute: muted ? 1 : 0,
    }

    if (startTime) playerVars.start = startTime
    if (endTime) playerVars.end = endTime
    if (loop) playerVars.playlist = videoId

    playerRef.current = new window.YT.Player(`youtube-player-${videoId}`, {
      height: '100%',
      width: '100%',
      videoId,
      playerVars,
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    })
  }, [videoId, autoplay, muted, loop, startTime, endTime, showControls])

  const onPlayerReady = (event: any) => {
    setState(prev => ({ 
      ...prev, 
      isPlayerReady: true,
      isLoading: false,
      duration: event.target.getDuration(),
    }))

    // Set quality
    if (quality !== 'auto') {
      event.target.setPlaybackQuality(quality)
    }

    // Start progress tracking
    startProgressTracking()
  }

  const onPlayerStateChange = (event: any) => {
    const playerState = event.data

    switch (playerState) {
      case window.YT.PlayerState.PLAYING:
        setState(prev => ({ ...prev, isPlaying: true }))
        onPlay?.()
        break
      case window.YT.PlayerState.PAUSED:
        setState(prev => ({ ...prev, isPlaying: false }))
        onPause?.()
        break
      case window.YT.PlayerState.ENDED:
        setState(prev => ({ ...prev, isPlaying: false }))
        onEnd?.()
        break
      case window.YT.PlayerState.BUFFERING:
        setState(prev => ({ ...prev, isLoading: true }))
        break
    }
  }

  const onPlayerError = (event: any) => {
    const errorMessage = getErrorMessage(event.data)
    setState(prev => ({ ...prev, error: errorMessage, isLoading: false }))
    onError?.(errorMessage)
  }

  const getErrorMessage = (code: number): string => {
    switch (code) {
      case 2:
        return 'Invalid video ID'
      case 5:
        return 'HTML5 player error'
      case 100:
        return 'Video not found'
      case 101:
      case 150:
        return 'Video cannot be embedded'
      default:
        return 'An error occurred while loading the video'
    }
  }

  const startProgressTracking = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
    }

    progressIntervalRef.current = setInterval(() => {
      if (playerRef.current && state.isPlaying) {
        setState(prev => ({
          ...prev,
          currentTime: playerRef.current.getCurrentTime(),
        }))
      }
    }, 1000)
  }

  const handlePlayClick = () => {
    setShowPlayer(true)
  }

  const togglePlay = () => {
    if (!playerRef.current) return

    if (state.isPlaying) {
      playerRef.current.pauseVideo()
    } else {
      playerRef.current.playVideo()
    }
  }

  const toggleMute = () => {
    if (!playerRef.current) return

    if (state.isMuted) {
      playerRef.current.unMute()
      setState(prev => ({ ...prev, isMuted: false }))
    } else {
      playerRef.current.mute()
      setState(prev => ({ ...prev, isMuted: true }))
    }
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  const seekTo = (time: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(time, true)
    }
  }

  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case '4:3':
        return 'aspect-[4/3]'
      case '9:16':
        return 'aspect-[9/16]'
      default:
        return 'aspect-video'
    }
  }

  if (state.error) {
    return (
      <Card className={cn('p-8 text-center', className)}>
        <div className="text-destructive mb-2">⚠️</div>
        <p className="text-sm text-muted-foreground">{state.error}</p>
      </Card>
    )
  }

  return (
    <div className={cn('relative group', className)}>
      <div 
        ref={containerRef}
        className={cn(
          'relative overflow-hidden rounded-lg bg-black',
          getAspectRatioClass()
        )}
      >
        {showPlayer ? (
          <>
            <div id={`youtube-player-${videoId}`} className="absolute inset-0" />
            
            {/* Custom controls overlay */}
            {showControls && state.isPlayerReady && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              >
                <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-auto">
                  {/* Progress bar */}
                  <div className="mb-3">
                    <div 
                      className="h-1 bg-white/30 rounded-full cursor-pointer"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const percent = (e.clientX - rect.left) / rect.width
                        seekTo(percent * state.duration)
                      }}
                    >
                      <div 
                        className="h-full bg-red-600 rounded-full"
                        style={{ width: `${(state.currentTime / state.duration) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-white hover:bg-white/20"
                        onClick={togglePlay}
                      >
                        {state.isPlaying ? '⏸' : '▶'}
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-white hover:bg-white/20"
                        onClick={toggleMute}
                      >
                        {state.isMuted ? <VolumeX /> : <Volume2 />}
                      </Button>

                      <span className="text-white text-sm">
                        {formatDuration(Math.floor(state.currentTime))} / {formatDuration(Math.floor(state.duration))}
                      </span>
                    </div>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-white hover:bg-white/20"
                      onClick={toggleFullscreen}
                    >
                      <Maximize className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </>
        ) : (
          <>
            {/* Thumbnail with play button */}
            <div className="relative w-full h-full">
              {video?.thumbnail?.maxres || video?.thumbnail?.high ? (
                <Image
                  src={video.thumbnail.maxres || video.thumbnail.high}
                  alt={video?.title || 'Video thumbnail'}
                  fill
                  className="object-cover"
                  priority
                />
              ) : (
                <img
                  src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
                  alt="Video thumbnail"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback to lower quality if maxresdefault doesn't exist
                    e.currentTarget.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                  }}
                />
              )}
              
              {/* Play button overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                <button
                  onClick={handlePlayClick}
                  className="relative"
                  aria-label="Play video"
                >
                  <div className="absolute inset-0 bg-red-600 rounded-full blur-xl opacity-60 group-hover:opacity-80 transition-opacity" />
                  <div className="relative bg-red-600 hover:bg-red-700 rounded-full p-5 transform group-hover:scale-110 transition-all duration-200 shadow-2xl">
                    <Play className="w-10 h-10 text-white fill-white ml-1" />
                  </div>
                </button>
              </div>

              {/* Duration badge */}
              {video?.duration && (
                <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                  {formatDuration(video.duration)}
                </div>
              )}

              {/* Live badge */}
              {video?.liveBroadcastContent === 'live' && (
                <Badge className="absolute top-2 right-2 bg-red-600 text-white">
                  <div className="w-2 h-2 bg-white rounded-full mr-1 animate-pulse" />
                  LIVE
                </Badge>
              )}
            </div>
          </>
        )}

        {/* Loading state */}
        {state.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Video details */}
      {showDetails && video && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-4 space-y-3"
        >
          <div>
            <h3 className="font-semibold text-lg line-clamp-2 pr-8">{video.title}</h3>
            
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link 
                        href={`https://youtube.com/channel/${video.channelId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:text-primary transition-colors"
                      >
                        {video.channelTitle}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      View channel on YouTube
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <span>•</span>
                
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {formatCompactNumber(video.viewCount)}
                </span>

                <span>•</span>

                <span className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3" />
                  {formatCompactNumber(video.likeCount)}
                </span>

                {video.commentCount > 0 && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {formatCompactNumber(video.commentCount)}
                    </span>
                  </>
                )}
              </div>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      asChild
                    >
                      <a
                        href={`https://youtube.com/watch?v=${videoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Watch on YouTube
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="text-sm text-muted-foreground mt-1">
              Published {formatRelativeTime(video.publishedAt)}
            </div>
          </div>

          {/* Tags */}
          {video.tags && video.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {video.tags.slice(0, 5).map((tag, index) => (
                <Badge key={index} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {video.tags.length > 5 && (
                <Badge variant="outline" className="text-xs">
                  +{video.tags.length - 5} more
                </Badge>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Loading skeleton for details */}
      {showDetails && isLoadingDetails && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      )}
    </div>
  )
}

// Lightweight version for lists
export function YouTubeEmbedCompact({ 
  videoId, 
  className 
}: { 
  videoId: string
  className?: string 
}) {
  const { data: video } = api.youtube.getVideo.useQuery(
    { videoId },
    { staleTime: 3600000 }
  )

  return (
    <div className={cn('flex gap-3', className)}>
      <div className="relative w-40 aspect-video rounded overflow-hidden flex-shrink-0">
        {video ? (
          <Image
            src={video.thumbnail.medium}
            alt={video.title}
            fill
            className="object-cover"
          />
        ) : (
          <Skeleton className="w-full h-full" />
        )}
        {video?.duration && (
          <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
            {formatDuration(video.duration)}
          </div>
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        {video ? (
          <>
            <h4 className="font-medium line-clamp-2 text-sm">{video.title}</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {video.channelTitle} • {formatCompactNumber(video.viewCount)} views
            </p>
          </>
        ) : (
          <>
            <Skeleton className="h-4 w-full mb-1" />
            <Skeleton className="h-3 w-2/3" />
          </>
        )}
      </div>
    </div>
  )
}
```

## 🔍 5. `/src/server/services/search.service.ts`

```typescript
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
```

---

## Additional Supporting Files

### 🎥 `/src/server/api/routers/youtube.ts`

```typescript
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
```

### 🔍 `/src/server/api/routers/search.ts`

```typescript
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
```

### 🔧 `/src/lib/rate-limiter.ts`

```typescript
// src/lib/rate-limiter.ts
import { Redis } from 'ioredis'

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: Date
  retryAfter?: number
}

interface RateLimitOptions {
  windowMs: number
  maxRequests: number
  namespace?: string
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

export class RateLimiter {
  private redis: Redis | null = null
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map()

  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL)
    }
  }

  async checkLimit(
    identifier: string,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    const {
      windowMs,
      maxRequests,
      namespace = 'default',
    } = options

    const key = `ratelimit:${namespace}:${identifier}`
    const now = Date.now()
    const windowStart = now - windowMs

    if (this.redis) {
      return this.checkLimitWithRedis(key, windowStart, now, windowMs, maxRequests)
    } else {
      return this.checkLimitWithMemory(key, now, windowMs, maxRequests)
    }
  }

  private async checkLimitWithRedis(
    key: string,
    windowStart: number,
    now: number,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const multi = this.redis!.multi()

    // Remove old entries
    multi.zremrangebyscore(key, '-inf', windowStart)
    
    // Count current entries
    multi.zcard(key)
    
    // Add current request
    multi.zadd(key, now, `${now}-${Math.random()}`)
    
    // Set expiry
    multi.expire(key, Math.ceil(windowMs / 1000))

    const results = await multi.exec()
    const count = (results?.[1]?.[1] as number) || 0

    const success = count < maxRequests
    const remaining = Math.max(0, maxRequests - count - 1)
    const reset = new Date(now + windowMs)

    if (!success) {
      // Get oldest entry to calculate retry after
      const oldestEntry = await this.redis!.zrange(key, 0, 0, 'WITHSCORES')
      if (oldestEntry.length >= 2) {
        const oldestTime = parseInt(oldestEntry[1])
        const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000)
        
        return {
          success: false,
          limit: maxRequests,
          remaining: 0,
          reset,
          retryAfter,
        }
      }
    }

    return {
      success,
      limit: maxRequests,
      remaining,
      reset,
    }
  }

  private checkLimitWithMemory(
    key: string,
    now: number,
    windowMs: number,
    maxRequests: number
  ): RateLimitResult {
    const record = this.memoryStore.get(key)
    
    if (!record || record.resetTime < now) {
      this.memoryStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      })
      
      return {
        success: true,
        limit: maxRequests,
        remaining: maxRequests - 1,
        reset: new Date(now + windowMs),
      }
    }

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000)
      
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        reset: new Date(record.resetTime),
        retryAfter,
      }
    }

    record.count++
    
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - record.count,
      reset: new Date(record.resetTime),
    }
  }

  // Clean up old entries periodically
  startCleanup(intervalMs: number = 60000) {
    setInterval(() => {
      const now = Date.now()
      for (const [key, record] of this.memoryStore.entries()) {
        if (record.resetTime < now) {
          this.memoryStore.delete(key)
        }
      }
    }, intervalMs)
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter()
```

### 📚 `/src/config/constants.ts`

```typescript
// src/config/constants.ts

export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  COMMENTS_LIMIT: 20,
  NOTIFICATIONS_LIMIT: 50,
  SEARCH_LIMIT: 20,
} as const

export const CACHE_TIMES = {
  USER_PROFILE: 300, // 5 minutes
  POST_DETAILS: 300, // 5 minutes
  YOUTUBE_VIDEO: 3600, // 1 hour
  YOUTUBE_CHANNEL: 86400, // 24 hours
  TRENDING_POSTS: 600, // 10 minutes
  SEARCH_SUGGESTIONS: 3600, // 1 hour
} as const

export const REAL_TIME = {
  TYPING_TIMEOUT: 5000, // 5 seconds
  PRESENCE_TIMEOUT: 300000, // 5 minutes
  RECONNECT_DELAY: 1000, // 1 second
  MAX_RECONNECT_ATTEMPTS: 5,
} as const

export const LIMITS = {
  POST_TITLE_MIN: 3,
  POST_TITLE_MAX: 200,
  POST_CONTENT_MIN: 10,
  POST_CONTENT_MAX: 100000,
  COMMENT_MIN: 1,
  COMMENT_MAX: 1000,
  BIO_MAX: 500,
  USERNAME_MIN: 3,
  USERNAME_MAX: 30,
  TAG_MAX: 30,
  MAX_TAGS_PER_POST: 5,
} as const

export const YOUTUBE = {
  VIDEO_ID_REGEX: /^[a-zA-Z0-9_-]{11}$/,
  API_QUOTA_LIMIT: 10000,
  CACHE_DURATION: {
    VIDEO: 3600,
    CHANNEL: 86400,
    PLAYLIST: 3600,
  },
} as const

export const SEARCH = {
  MIN_QUERY_LENGTH: 2,
  MAX_QUERY_LENGTH: 100,
  DEBOUNCE_MS: 300,
  MAX_SUGGESTIONS: 10,
  FACET_LIMIT: 100,
} as const
```

---

## 🎉 Phase 4 Complete!

All Phase 4 advanced features have been implemented with production
