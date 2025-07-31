// src/components/features/comments/comment-form.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createCommentSchema, type CreateCommentInput } from '@/lib/validations/comment'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { toast } from '@/components/ui/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CommentFormProps {
  postId: string
  parentId?: string
  initialContent?: string
  onSuccess?: (content: string) => void
  onCancel?: () => void
  autoFocus?: boolean
  placeholder?: string
  submitLabel?: string
  className?: string
}

export function CommentForm({
  postId,
  parentId,
  initialContent = '',
  onSuccess,
  onCancel,
  autoFocus = false,
  placeholder = 'Write a comment...',
  submitLabel = 'Comment',
  className,
}: CommentFormProps) {
  const { user } = useAuth()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isExpanded, setIsExpanded] = useState(autoFocus || !!initialContent)

  const form = useForm<CreateCommentInput>({
    resolver: zodResolver(createCommentSchema),
    defaultValues: {
      postId,
      parentId,
      content: initialContent,
    },
  })

  const createComment = api.comment.create.useMutation({
    onSuccess: () => {
      form.reset()
      setIsExpanded(false)
      if (onSuccess) {
        onSuccess(form.getValues('content'))
      }
      toast({
        title: 'Comment posted!',
        description: 'Your comment has been added to the discussion.',
      })
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const onSubmit = (data: CreateCommentInput) => {
    createComment.mutate(data)
  }

  const handleCancel = () => {
    form.reset()
    setIsExpanded(false)
    if (onCancel) {
      onCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      form.handleSubmit(onSubmit)()
    }
  }

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  if (!user) return null

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={cn('space-y-4', className)}>
      <div className="flex gap-3">
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={user.image || undefined} />
          <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            placeholder={placeholder}
            className={cn(
              'min-h-[80px] resize-none transition-all',
              !isExpanded && 'min-h-[40px] cursor-pointer'
            )}
            {...form.register('content')}
            onFocus={() => setIsExpanded(true)}
            onKeyDown={handleKeyDown}
          />
          {form.formState.errors.content && (
            <p className="text-sm text-destructive mt-1">
              {form.formState.errors.content.message}
            </p>
          )}

          {isExpanded && (
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-muted-foreground">
                Press <kbd className="px-1 py-0.5 rounded bg-muted">⌘</kbd> + <kbd className="px-1 py-0.5 rounded bg-muted">Enter</kbd> to submit
              </p>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createComment.isLoading || !form.watch('content').trim()}
                  loading={createComment.isLoading}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {submitLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </form>
  )
}
