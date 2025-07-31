// src/components/features/comments/comment-thread.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { api } from '@/lib/api'
import { CommentItem } from './comment-item'
import { CommentForm } from './comment-form'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, MessageSquare, TrendingUp, Clock, AlertCircle } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useSocket } from '@/hooks/use-socket'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

interface CommentThreadProps {
  postId: string
  postAuthorId: string
  className?: string
}

export function CommentThread({ postId, postAuthorId, className }: CommentThreadProps) {
  const { user } = useAuth()
  const { on, off } = useSocket()
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'popular'>('newest')
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const commentsContainerRef = useRef<HTMLDivElement>(null)
  const { ref: loadMoreRef, inView } = useInView()

  // Fetch comments
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = api.comment.list.useInfiniteQuery(
    { postId, sortBy, limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchOnWindowFocus: false,
    }
  )

  // Fetch comment stats
  const { data: stats } = api.comment.getStats.useQuery({ postId })

  // Auto-fetch more when scrolled to bottom
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Real-time comment updates
  useEffect(() => {
    const handleNewComment = (event: any) => {
      if (event.postId === postId) {
        // Highlight new comment
        setHighlightedCommentId(event.comment.id)
        setTimeout(() => setHighlightedCommentId(null), 3000)
        
        // Refetch to get new comment
        refetch()
      }
    }

    const handleCommentUpdate = (event: any) => {
      if (event.postId === postId) {
        refetch()
      }
    }

    on('comment:created', handleNewComment)
    on('comment:updated', handleCommentUpdate)
    on('comment:deleted', handleCommentUpdate)
    on('comment:reacted', handleCommentUpdate)
    on('comment:pinned', handleCommentUpdate)

    return () => {
      off('comment:created', handleNewComment)
      off('comment:updated', handleCommentUpdate)
      off('comment:deleted', handleCommentUpdate)
      off('comment:reacted', handleCommentUpdate)
      off('comment:pinned', handleCommentUpdate)
    }
  }, [postId, on, off, refetch])

  const comments = data?.pages.flatMap(page => page.items) ?? []
  const totalComments = stats?.totalComments ?? 0

  const handleCommentCreated = () => {
    refetch()
    // Scroll to top if sorted by newest
    if (sortBy === 'newest' && commentsContainerRef.current) {
      commentsContainerRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleSortChange = (newSort: typeof sortBy) => {
    setSortBy(newSort)
    // Refetch will happen automatically due to query key change
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load comments. Please try again later.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={cn('space-y-6', className)} id="comments">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          <h2 className="text-xl font-semibold">
            Comments {totalComments > 0 && `(${totalComments})`}
          </h2>
        </div>

        {totalComments > 1 && (
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Newest
                </div>
              </SelectItem>
              <SelectItem value="oldest">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Oldest
                </div>
              </SelectItem>
              <SelectItem value="popular">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3 w-3" />
                  Popular
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Comment form */}
      {user ? (
        <Card className="p-4">
          <CommentForm
            postId={postId}
            onSuccess={handleCommentCreated}
            autoFocus={false}
          />
        </Card>
      ) : (
        <Alert>
          <AlertDescription>
            Please <Button variant="link" className="p-0 h-auto" asChild>
              <a href="/login">sign in</a>
            </Button> to leave a comment.
          </AlertDescription>
        </Alert>
      )}

      {/* Comments list */}
      <div ref={commentsContainerRef} className="space-y-4">
        {isLoading ? (
          // Loading skeletons
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <Card className="p-8 text-center">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No comments yet. Be the first to share your thoughts!
            </p>
          </Card>
        ) : (
          <AnimatePresence>
            {comments.map((comment, index) => (
              <motion.div
                key={comment.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{
                  duration: 0.3,
                  delay: index * 0.05,
                }}
              >
                <CommentItem
                  comment={comment}
                  postId={postId}
                  postAuthorId={postAuthorId}
                  onUpdate={refetch}
                  isHighlighted={highlightedCommentId === comment.id}
                  currentUserId={user?.id}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {/* Load more */}
        {hasNextPage && (
          <div ref={loadMoreRef} className="flex justify-center py-4">
            {isFetchingNextPage ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                Load more comments
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Comment stats */}
      {stats && totalComments > 0 && (
        <Card className="p-4 bg-muted/50">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">
                {stats.uniqueCommenters} {stats.uniqueCommenters === 1 ? 'person' : 'people'} joined the discussion
              </span>
              {stats.averageCommentsPerUser > 1 && (
                <span className="text-muted-foreground">
                  • {stats.averageCommentsPerUser.toFixed(1)} comments per person
                </span>
              )}
            </div>
            {stats.reactionDistribution && Object.keys(stats.reactionDistribution).length > 0 && (
              <div className="flex items-center gap-2">
                {Object.entries(stats.reactionDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3)
                  .map(([type, count]) => (
                    <span key={type} className="flex items-center gap-1">
                      <span className="text-lg">{getReactionEmoji(type as any)}</span>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </span>
                  ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

// Helper function to get emoji for reaction type
function getReactionEmoji(type: string): string {
  const emojis: Record<string, string> = {
    LIKE: '👍',
    LOVE: '❤️',
    FIRE: '🔥',
    SPARKLE: '✨',
    MIND_BLOWN: '🤯',
  }
  return emojis[type] || '👍'
}
