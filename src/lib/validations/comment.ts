// src/lib/validations/comment.ts
import { z } from 'zod'

const COMMENT_MIN_LENGTH = 1
const COMMENT_MAX_LENGTH = 1000

export const createCommentSchema = z.object({
  postId: z.string().cuid('Invalid post ID'),
  content: z.string()
    .min(COMMENT_MIN_LENGTH, 'Comment cannot be empty')
    .max(COMMENT_MAX_LENGTH, `Comment must be at most ${COMMENT_MAX_LENGTH} characters`)
    .trim(),
  parentId: z.string().cuid('Invalid parent comment ID').optional(),
})

export const updateCommentSchema = z.object({
  id: z.string().cuid('Invalid comment ID'),
  content: z.string()
    .min(COMMENT_MIN_LENGTH, 'Comment cannot be empty')
    .max(COMMENT_MAX_LENGTH, `Comment must be at most ${COMMENT_MAX_LENGTH} characters`)
    .trim(),
})

export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>
