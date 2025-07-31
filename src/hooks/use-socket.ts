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
