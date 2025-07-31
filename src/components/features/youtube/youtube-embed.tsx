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
