// src/app/(main)/create/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPostSchema, type CreatePostInput } from '@/lib/validations/post'
import { api } from '@/lib/api'
import { RichTextEditor } from '@/components/features/editor/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import {
  Save,
  Send,
  X,
  Plus,
  Youtube,
  Image as ImageIcon,
  AlertCircle,
  Sparkles,
  Eye,
} from 'lucide-react'
import { cn, parseYouTubeVideoId } from '@/lib/utils'
import { YouTubeEmbed } from '@/components/features/youtube/youtube-embed'
import { ImageUpload } from '@/components/features/upload/image-upload'
import { useAuth } from '@/hooks/use-auth'

export default function CreatePostPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [isPreview, setIsPreview] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null)

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(createPostSchema),
    defaultValues: {
      title: '',
      content: '',
      excerpt: '',
      tags: [],
      youtubeVideoId: undefined,
      coverImage: undefined,
      published: false,
    },
  })

  const createPost = api.post.create.useMutation({
    onSuccess: (post) => {
      toast({
        title: post.published ? 'Post published!' : 'Draft saved!',
        description: post.published 
          ? 'Your post is now live for everyone to see.'
          : 'Your draft has been saved. You can publish it later.',
      })
      router.push(`/post/${post.slug}`)
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const saveDraft = () => {
    form.setValue('published', false)
    form.handleSubmit(onSubmit)()
  }

  const publishPost = () => {
    form.setValue('published', true)
    form.handleSubmit(onSubmit)()
  }

  const onSubmit = async (data: CreatePostInput) => {
    // Set tags and YouTube video ID
    data.tags = tags
    data.youtubeVideoId = youtubeVideoId || undefined

    createPost.mutate(data)
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag])
      setTagInput('')
    }
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove))
  }

  const handleYouTubeUrlChange = (url: string) => {
    setYoutubeUrl(url)
    const videoId = parseYouTubeVideoId(url)
    setYoutubeVideoId(videoId)
  }

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (!form.formState.isDirty || createPost.isLoading) return

    const interval = setInterval(() => {
      const values = form.getValues()
      if (values.title && values.content) {
        saveDraft()
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [form.formState.isDirty])

  if (!user) {
    return (
      <div className="container max-w-4xl py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please sign in to create posts.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            Create New Post
          </h1>
          <p className="text-muted-foreground mt-1">
            Share your thoughts with the Sparkle community
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIsPreview(!isPreview)}
            size="sm"
          >
            <Eye className="h-4 w-4 mr-2" />
            {isPreview ? 'Edit' : 'Preview'}
          </Button>
        </div>
      </div>

      {isPreview ? (
        // Preview Mode
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{form.watch('title') || 'Untitled Post'}</CardTitle>
            {form.watch('excerpt') && (
              <p className="text-muted-foreground mt-2">{form.watch('excerpt')}</p>
            )}
          </CardHeader>
          <CardContent>
            {form.watch('coverImage') && (
              <img
                src={form.watch('coverImage')}
                alt="Cover"
                className="w-full h-64 object-cover rounded-lg mb-6"
              />
            )}
            {youtubeVideoId && (
              <div className="mb-6">
                <YouTubeEmbed videoId={youtubeVideoId} />
              </div>
            )}
            <div 
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: form.watch('content') || '<p>No content yet...</p>' }}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-6">
                {tags.map(tag => (
                  <Badge key={tag} variant="secondary">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        // Edit Mode
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Tabs defaultValue="content" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="media">Media</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="space-y-6">
              <div>
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  placeholder="Enter an engaging title..."
                  className="mt-1 text-lg"
                  {...form.register('title')}
                />
                {form.formState.errors.title && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.title.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="excerpt">Excerpt</Label>
                <Textarea
                  id="excerpt"
                  placeholder="Brief description of your post (optional)"
                  className="mt-1 resize-none"
                  rows={3}
                  {...form.register('excerpt')}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This will appear in post previews and search results
                </p>
              </div>

              <div>
                <Label>Content *</Label>
                <div className="mt-1">
                  <RichTextEditor
                    content={form.watch('content')}
                    onChange={(content) => form.setValue('content', content, { shouldDirty: true })}
                    placeholder="Write your amazing post..."
                  />
                </div>
                {form.formState.errors.content && (
                  <p className="text-sm text-destructive mt-1">
                    {form.formState.errors.content.message}
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="media" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Cover Image</CardTitle>
                </CardHeader>
                <CardContent>
                  <ImageUpload
                    value={form.watch('coverImage')}
                    onChange={(url) => form.setValue('coverImage', url)}
                    onRemove={() => form.setValue('coverImage', undefined)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Youtube className="h-5 w-5 text-red-600" />
                    YouTube Video
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="youtube-url">YouTube URL</Label>
                    <Input
                      id="youtube-url"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => handleYouTubeUrlChange(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  {youtubeVideoId && (
                    <div>
                      <Label>Preview</Label>
                      <div className="mt-2">
                        <YouTubeEmbed videoId={youtubeVideoId} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="settings" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Tags</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a tag..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      onClick={addTag}
                      disabled={!tagInput.trim() || tags.length >= 5}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map(tag => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="px-3 py-1"
                        >
                          #{tag}
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="ml-2 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Add up to 5 tags to help people discover your post
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Publishing Options</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="publish-now">Publish immediately</Label>
                      <p className="text-sm text-muted-foreground">
                        Make your post visible to everyone right away
                      </p>
                    </div>
                    <Switch
                      id="publish-now"
                      checked={form.watch('published')}
                      onCheckedChange={(checked) => form.setValue('published', checked)}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between pt-6 border-t">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={createPost.isLoading}
            >
              Cancel
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={saveDraft}
                disabled={createPost.isLoading || !form.formState.isDirty}
              >
                <Save className="h-4 w-4 mr-2" />
                Save Draft
              </Button>
              <Button
                type="button"
                onClick={publishPost}
                disabled={createPost.isLoading}
                loading={createPost.isLoading}
              >
                <Send className="h-4 w-4 mr-2" />
                {form.watch('published') ? 'Publish' : 'Save & Publish'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
