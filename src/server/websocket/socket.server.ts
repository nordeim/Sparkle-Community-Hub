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
