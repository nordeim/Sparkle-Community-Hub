// src/components/features/post/post-card.tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { formatRelativeTime, formatCompactNumber } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { YouTubeEmbed } from '@/components/features/youtube/youtube-embed'
import { type RouterOutputs } from '@/lib/api'
import {
  Heart,
  MessageSquare,
  Share2,
  Bookmark,
  MoreHorizontal,
  Eye,
  Clock,
  TrendingUp,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { api } from '@/lib/api'
import { toast } from '@/components/ui/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { motion } from 'framer-motion'

type Post = RouterOutputs['post']['list']['items'][0]

interface PostCardProps {
  post: Post
  variant?: 'default' | 'compact' | 'featured'
  showAuthor?: boolean
  onUpdate?: () => void
}

export function PostCard({ 
  post, 
  variant = 'default',
  showAuthor = true,
  onUpdate,
}: PostCardProps) {
  const { user } = useAuth()
  const [isLiked, setIsLiked] = useState(post.isLiked)
  const [likeCount, setLikeCount] = useState(post._count.reactions)
  const [isSaved, setIsSaved] = useState(false)

  const likeMutation = api.post.like.useMutation({
    onMutate: () => {
      setIsLiked(true)
      setLikeCount(prev => prev + 1)
    },
    onError: () => {
      setIsLiked(false)
      setLikeCount(prev => prev - 1)
      toast({
        title: 'Error',
        description: 'Failed to like post',
        variant: 'destructive',
      })
    },
  })

  const unlikeMutation = api.post.unlike.useMutation({
    onMutate: () => {
      setIsLiked(false)
      setLikeCount(prev => prev - 1)
    },
    onError: () => {
      setIsLiked(true)
      setLikeCount(prev => prev + 1)
      toast({
        title: 'Error',
        description: 'Failed to unlike post',
        variant: 'destructive',
      })
    },
  })

  const handleLike = () => {
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to like posts',
      })
      return
    }

    if (isLiked) {
      unlikeMutation.mutate({ postId: post.id })
    } else {
      likeMutation.mutate({ postId: post.id })
    }
  }

  const handleShare = async () => {
    const url = `${window.location.origin}/post/${post.slug}`
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: post.excerpt || post.title,
          url,
        })
      } catch (error) {
        // User cancelled share
      }
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(url)
      toast({
        title: 'Link copied!',
        description: 'Post link has been copied to clipboard',
      })
    }
  }

  const isOwner = user?.id === post.authorId

  if (variant === 'compact') {
    return (
      <article className="group">
        <Link href={`/post/${post.slug}`}>
          <div className="flex gap-4 p-4 rounded-lg hover:bg-muted/50 transition-colors">
            {post.coverImage && (
              <div className="relative w-20 h-20 rounded-md overflow-hidden flex-shrink-0">
                <Image
                  src={post.coverImage}
                  alt={post.title}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">
                {post.title}
              </h3>
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                {post.excerpt}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span>{formatRelativeTime(post.publishedAt || post.createdAt)}</span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {formatCompactNumber(post.views)}
                </span>
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" />
                  {formatCompactNumber(likeCount)}
                </span>
              </div>
            </div>
          </div>
        </Link>
      </article>
    )
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn(
        'overflow-hidden hover:shadow-lg transition-all duration-300',
        variant === 'featured' && 'md:col-span-2 md:row-span-2'
      )}>
        {/* Cover Image */}
        {post.coverImage && (
          <Link href={`/post/${post.slug}`}>
            <div className={cn(
              'relative overflow-hidden bg-muted',
              variant === 'featured' ? 'aspect-[21/9]' : 'aspect-video'
            )}>
              <Image
                src={post.coverImage}
                alt={post.title}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                priority={variant === 'featured'}
              />
              {variant === 'featured' && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              )}
            </div>
          </Link>
        )}

        <div className="p-6">
          {/* Author info */}
          {showAuthor && (
            <div className="flex items-center justify-between mb-4">
              <Link href={`/user/${post.author.username}`}>
                <div className="flex items-center gap-3 group/author">
                  <Avatar className="h-10 w-10 ring-2 ring-background group-hover/author:ring-primary transition-all">
                    <AvatarImage src={post.author.image || undefined} />
                    <AvatarFallback>{post.author.username[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-sm group-hover/author:text-primary transition-colors">
                      {post.author.username}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(post.publishedAt || post.createdAt)}
                    </p>
                  </div>
                </div>
              </Link>

              {/* More options */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isOwner && (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href={`/post/${post.slug}/edit`}>
                          Edit post
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={handleShare}>
                    Share post
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    Save post
                  </DropdownMenuItem>
                  {!isOwner && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive">
                        Report post
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Content */}
          <Link href={`/post/${post.slug}`}>
            <h2 className={cn(
              'font-bold mb-2 line-clamp-2 hover:text-primary transition-colors',
              variant === 'featured' ? 'text-2xl md:text-3xl' : 'text-xl'
            )}>
              {post.title}
            </h2>
          </Link>
          
          {post.excerpt && (
            <p className={cn(
              'text-muted-foreground mb-4',
              variant === 'featured' ? 'line-clamp-3' : 'line-clamp-2'
            )}>
              {post.excerpt}
            </p>
          )}

          {/* YouTube embed */}
          {post.youtubeVideoId && !post.coverImage && (
            <div className="mb-4">
              <YouTubeEmbed videoId={post.youtubeVideoId} showDetails={false} />
            </div>
          )}

          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.slice(0, 3).map(({ tag }) => (
                <Link key={tag.id} href={`/tag/${tag.slug}`}>
                  <Badge 
                    variant="secondary" 
                    className="hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    #{tag.name}
                  </Badge>
                </Link>
              ))}
              {post.tags.length > 3 && (
                <Badge variant="outline">+{post.tags.length - 3}</Badge>
              )}
            </div>
          )}

          {/* Stats & Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'gap-2 hover:text-red-600',
                  isLiked && 'text-red-600'
                )}
                onClick={handleLike}
              >
                <Heart className={cn('h-4 w-4', isLiked && 'fill-current')} />
                <span className="text-sm">{formatCompactNumber(likeCount)}</span>
              </Button>

              <Link href={`/post/${post.slug}#comments`}>
                <Button variant="ghost" size="sm" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-sm">{formatCompactNumber(post._count.comments)}</span>
                </Button>
              </Link>

              <Button variant="ghost" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className={cn(isSaved && 'text-primary')}
                onClick={() => setIsSaved(!isSaved)}
              >
                <Bookmark className={cn('h-4 w-4', isSaved && 'fill-current')} />
              </Button>
            </div>

            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {post.readingTime && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {post.readingTime} min
                </span>
              )}
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {formatCompactNumber(post.views)}
              </span>
              {post.featured && (
                <Badge variant="default" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Featured
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>
    </motion.article>
  )
}
