// src/components/features/comments/comment-actions.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { 
  Heart, 
  MessageSquare, 
  Smile,
  Flame,
  Sparkles,
  Brain,
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import { ReactionType } from '@prisma/client'
import { motion, AnimatePresence } from 'framer-motion'

interface CommentActionsProps {
  comment: any
  currentUserId?: string
  onReply: () => void
  onUpdate: () => void
}

const reactions: Array<{ type: ReactionType; emoji: string; icon: any }> = [
  { type: 'LIKE', emoji: '👍', icon: Heart },
  { type: 'LOVE', emoji: '❤️', icon: Heart },
  { type: 'FIRE', emoji: '🔥', icon: Flame },
  { type: 'SPARKLE', emoji: '✨', icon: Sparkles },
  { type: 'MIND_BLOWN', emoji: '🤯', icon: Brain },
]

export function CommentActions({
  comment,
  currentUserId,
  onReply,
  onUpdate,
}: CommentActionsProps) {
  const [showReactions, setShowReactions] = useState(false)
  const [recentReaction, setRecentReaction] = useState<string | null>(null)

  const userReaction = comment.userReactions?.[0]
  const totalReactions = comment._count.reactions

  const reactMutation = api.comment.react.useMutation({
    onSuccess: () => {
      onUpdate()
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const unreactMutation = api.comment.unreact.useMutation({
    onSuccess: () => {
      onUpdate()
    },
  })

  const handleReaction = (type: ReactionType) => {
    if (!currentUserId) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to react to comments',
      })
      return
    }

    if (userReaction === type) {
      unreactMutation.mutate({ commentId: comment.id, type })
    } else {
      reactMutation.mutate({ commentId: comment.id, type })
      
      // Show reaction animation
      setRecentReaction(reactions.find(r => r.type === type)?.emoji || '👍')
      setTimeout(() => setRecentReaction(null), 1000)
    }
    
    setShowReactions(false)
  }

  return (
    <div className="flex items-center gap-2">
      {/* Reaction button */}
      <Popover open={showReactions} onOpenChange={setShowReactions}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'gap-2 h-8',
              userReaction && 'text-primary'
            )}
          >
            {userReaction ? (
              <span className="text-lg">
                {reactions.find(r => r.type === userReaction)?.emoji}
              </span>
            ) : (
              <Smile className="h-4 w-4" />
            )}
            {totalReactions > 0 && (
              <span className="text-sm">{totalReactions}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex gap-1">
            {reactions.map((reaction) => (
              <Button
                key={reaction.type}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-10 w-10 p-0 hover:scale-110 transition-transform',
                  userReaction === reaction.type && 'bg-primary/10'
                )}
                onClick={() => handleReaction(reaction.type)}
              >
                <span className="text-xl">{reaction.emoji}</span>
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Reply button */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 h-8"
        onClick={onReply}
      >
        <MessageSquare className="h-4 w-4" />
        Reply
      </Button>

      {/* Reaction animation */}
      <AnimatePresence>
        {recentReaction && (
          <motion.div
            initial={{ scale: 0, y: 0 }}
            animate={{ scale: [1, 1.5, 1], y: -20 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute pointer-events-none"
          >
            <span className="text-2xl">{recentReaction}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
