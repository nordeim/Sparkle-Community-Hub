// src/components/features/comments/comment-item.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatRelativeTime } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CommentForm } from './comment-form'
import { CommentActions } from './comment-actions'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { 
  Pin, 
  Crown, 
  Shield, 
  CheckCircle,
  Edit2,
  Trash2,
  Flag,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/use-toast'
import { motion } from 'framer-motion'

interface CommentItemProps {
  comment: any // Type from API
  postId: string
  postAuthorId: string
  onUpdate: () => void
  isHighlighted?: boolean
  currentUserId?: string
  depth?: number
}

export function CommentItem({
  comment,
  postId,
  postAuthorId,
  onUpdate,
  isHighlighted = false,
  currentUserId,
  depth = 0,
}: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isReplying, setIsReplying] = useState(false)
  const [showReplies, setShowReplies] = useState(true)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [loadingMoreReplies, setLoadingMoreReplies] = useState(false)

  const isAuthor = currentUserId === comment.author.id
  const isPostAuthor = currentUserId === postAuthorId
  const canModerate = false // Would check user role

  const updateMutation = api.comment.update.useMutation({
    onSuccess: () => {
      setIsEditing(false)
      onUpdate()
      toast({
        title: 'Comment updated',
        description: 'Your comment has been updated successfully.',
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

  const deleteMutation = api.comment.delete.useMutation({
    onSuccess: () => {
      onUpdate()
      toast({
        title: 'Comment deleted',
        description: 'The comment has been deleted.',
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

  const pinMutation = api.comment.togglePin.useMutation({
    onSuccess: () => {
      onUpdate()
    },
  })

  const handleEdit = (content: string) => {
    updateMutation.mutate({
      id: comment.id,
      content,
    })
  }

  const handleDelete = () => {
    deleteMutation.mutate({ id: comment.id })
    setShowDeleteDialog(false)
  }

  const handlePin = () => {
    pinMutation.mutate({ commentId: comment.id })
  }

  const loadMoreReplies = async () => {
    setLoadingMoreReplies(true)
    // Load more replies logic
    setLoadingMoreReplies(false)
  }

  // Role badges
  const getRoleBadge = () => {
    if (comment.author.id === postAuthorId) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Crown className="h-3 w-3" />
          Author
        </Badge>
      )
    }
    if (comment.author.role === 'ADMIN') {
      return (
        <Badge variant="destructive" className="gap-1">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      )
    }
    if (comment.author.role === 'MODERATOR') {
      return (
        <Badge variant="default" className="gap-1">
          <Shield className="h-3 w-3" />
          Mod
        </Badge>
      )
    }
    return null
  }

  return (
    <motion.div
      initial={false}
      animate={{
        backgroundColor: isHighlighted ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
      }}
      transition={{ duration: 0.3 }}
      className={cn(
        'relative',
        depth > 0 && 'ml-8 mt-4',
        depth > 3 && 'ml-4' // Less indentation for deep nesting
      )}
    >
      <Card className={cn(
        'p-4 transition-all',
        comment.pinned && 'border-primary',
        comment.deleted && 'opacity-50'
      )}>
        {/* Pinned indicator */}
        {comment.pinned && (
          <div className="flex items-center gap-2 mb-2 text-sm text-primary">
            <Pin className="h-4 w-4" />
            <span className="font-medium">Pinned by author</span>
          </div>
        )}

        <div className="flex gap-3">
          {/* Avatar */}
          <Link href={`/user/${comment.author.username}`}>
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarImage src={comment.author.image || undefined} />
              <AvatarFallback>{comment.author.username[0].toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap">
              <Link 
                href={`/user/${comment.author.username}`}
                className="font-semibold hover:underline"
              >
                {comment.author.username}
              </Link>
              {comment.author.verified && (
                <CheckCircle className="h-4 w-4 text-primary" />
              )}
              {getRoleBadge()}
              <span className="text-sm text-muted-foreground">
                {formatRelativeTime(comment.createdAt)}
              </span>
              {comment.edited && (
                <span className="text-sm text-muted-foreground italic">
                  (edited)
                </span>
              )}
            </div>

            {/* Content */}
            {isEditing ? (
              <div className="mt-2">
                <CommentForm
                  postId={postId}
                  parentId={comment.parentId}
                  initialContent={comment.content}
                  onSuccess={(content) => handleEdit(content)}
                  onCancel={() => setIsEditing(false)}
                  autoFocus
                  submitLabel="Update"
                />
              </div>
            ) : (
              <div 
                className="mt-2 prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: comment.content }}
              />
            )}

            {/* Actions */}
            {!comment.deleted && (
              <div className="flex items-center gap-2 mt-3">
                <CommentActions
                  comment={comment}
                  currentUserId={currentUserId}
                  onReply={() => setIsReplying(!isReplying)}
                  onUpdate={onUpdate}
                />

                {/* More options */}
                {currentUserId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        •••
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isAuthor && (
                        <>
                          <DropdownMenuItem onClick={() => setIsEditing(true)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setShowDeleteDialog(true)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      {isPostAuthor && !isAuthor && (
                        <>
                          <DropdownMenuItem onClick={handlePin}>
                            <Pin className="h-4 w-4 mr-2" />
                            {comment.pinned ? 'Unpin' : 'Pin'} comment
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setShowDeleteDialog(true)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      {!isAuthor && (
                        <DropdownMenuItem className="text-destructive">
                          <Flag className="h-4 w-4 mr-2" />
                          Report
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}

            {/* Reply form */}
            {isReplying && currentUserId && (
              <div className="mt-4">
                <CommentForm
                  postId={postId}
                  parentId={comment.id}
                  onSuccess={() => {
                    setIsReplying(false)
                    onUpdate()
                  }}
                  onCancel={() => setIsReplying(false)}
                  autoFocus
                  placeholder={`Reply to ${comment.author.username}...`}
                />
              </div>
            )}

            {/* Replies */}
            {comment.replies && comment.replies.totalCount > 0 && (
              <div className="mt-4">
                {comment.replies.items.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowReplies(!showReplies)}
                    className="mb-2"
                  >
                    {showReplies ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Hide replies
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Show {comment.replies.totalCount} {comment.replies.totalCount === 1 ? 'reply' : 'replies'}
                      </>
                    )}
                  </Button>
                )}

                {showReplies && (
                  <div className="space-y-4">
                    {comment.replies.items.map((reply: any) => (
                      <CommentItem
                        key={reply.id}
                        comment={reply}
                        postId={postId}
                        postAuthorId={postAuthorId}
                        onUpdate={onUpdate}
                        currentUserId={currentUserId}
                        depth={depth + 1}
                      />
                    ))}

                    {comment.replies.hasMore && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMoreReplies}
                        disabled={loadingMoreReplies}
                        className="ml-8"
                      >
                        {loadingMoreReplies ? (
                          'Loading...'
                        ) : (
                          `View ${comment.replies.totalCount - comment.replies.items.length} more replies`
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The comment will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
