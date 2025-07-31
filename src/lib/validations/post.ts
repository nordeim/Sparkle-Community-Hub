// src/lib/validations/post.ts
import { z } from 'zod'

// Constants
const TITLE_MIN_LENGTH = 3
const TITLE_MAX_LENGTH = 200
const CONTENT_MIN_LENGTH = 10
const CONTENT_MAX_LENGTH = 100000 // ~20 pages
const EXCERPT_MAX_LENGTH = 500
const TAG_MAX_LENGTH = 30
const MAX_TAGS = 5

// Custom refinements
const youtubeVideoIdRegex = /^[a-zA-Z0-9_-]{11}$/
const isValidYouTubeId = (id: string) => youtubeVideoIdRegex.test(id)

// Base schemas
const titleSchema = z.string()
  .min(TITLE_MIN_LENGTH, `Title must be at least ${TITLE_MIN_LENGTH} characters`)
  .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`)
  .trim()

const contentSchema = z.string()
  .min(CONTENT_MIN_LENGTH, `Content must be at least ${CONTENT_MIN_LENGTH} characters`)
  .max(CONTENT_MAX_LENGTH, `Content is too long`)

const excerptSchema = z.string()
  .max(EXCERPT_MAX_LENGTH, `Excerpt must be at most ${EXCERPT_MAX_LENGTH} characters`)
  .trim()
  .optional()

const tagsSchema = z.array(
  z.string()
    .min(1, 'Tag cannot be empty')
    .max(TAG_MAX_LENGTH, `Tag must be at most ${TAG_MAX_LENGTH} characters`)
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Tag can only contain lowercase letters, numbers, and hyphens')
)
  .max(MAX_TAGS, `You can add at most ${MAX_TAGS} tags`)
  .optional()
  .transform(tags => tags?.filter((tag, index, self) => self.indexOf(tag) === index)) // Remove duplicates

const youtubeVideoIdSchema = z.string()
  .refine(isValidYouTubeId, 'Invalid YouTube video ID')
  .optional()

const coverImageSchema = z.string()
  .url('Invalid image URL')
  .optional()

// Main schemas
export const createPostSchema = z.object({
  title: titleSchema,
  content: contentSchema,
  excerpt: excerptSchema,
  tags: tagsSchema,
  youtubeVideoId: youtubeVideoIdSchema,
  coverImage: coverImageSchema,
  published: z.boolean().optional().default(false),
})

export const updatePostSchema = z.object({
  id: z.string().cuid('Invalid post ID'),
  title: titleSchema.optional(),
  content: contentSchema.optional(),
  excerpt: excerptSchema,
  tags: tagsSchema,
  youtubeVideoId: youtubeVideoIdSchema.nullable(),
  coverImage: coverImageSchema.nullable(),
})

// Search schema
export const searchPostsSchema = z.object({
  query: z.string().min(1).max(100),
  tags: z.array(z.string()).optional(),
  authorId: z.string().cuid().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  sortBy: z.enum(['relevance', 'date', 'popularity']).default('relevance'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
})

// Type exports
export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type SearchPostsInput = z.infer<typeof searchPostsSchema>

// Validation helpers
export function validatePostTitle(title: string): { valid: boolean; error?: string } {
  const result = titleSchema.safeParse(title)
  return {
    valid: result.success,
    error: result.error?.errors[0]?.message,
  }
}

export function validatePostContent(content: string): { valid: boolean; error?: string } {
  const result = contentSchema.safeParse(content)
  return {
    valid: result.success,
    error: result.error?.errors[0]?.message,
  }
}

export function validateTags(tags: string[]): { valid: boolean; error?: string } {
  const result = tagsSchema.safeParse(tags)
  return {
    valid: result.success,
    error: result.error?.errors[0]?.message,
  }
}
