// src/lib/db.ts
import { PrismaClient } from '@prisma/client'

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Configure logging based on environment
const logLevels = process.env.NODE_ENV === 'production' 
  ? ['error'] 
  : ['query', 'info', 'warn', 'error']

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: logLevels.map(level => ({
    emit: 'event',
    level: level as any,
  })),
  errorFormat: 'colorless',
})

// Enable query logging in development
if (process.env.NODE_ENV !== 'production') {
  // Log queries
  db.$on('query' as any, (e: any) => {
    console.log(`Query: ${e.query}`)
    console.log(`Duration: ${e.duration}ms`)
  })

  // Log errors
  db.$on('error' as any, (e: any) => {
    console.error('Prisma Error:', e)
  })

  // Save to global to prevent new instances
  globalForPrisma.prisma = db
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await db.$disconnect()
})

// Helper function to handle database errors
export function handleDatabaseError(error: unknown): never {
  if (error instanceof Error) {
    console.error('Database error:', error.message)
    throw new Error('A database error occurred. Please try again later.')
  }
  throw new Error('An unexpected database error occurred.')
}

// Transaction helper with retry logic
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
      return withRetry(fn, retries - 1, delay * 2)
    }
    throw error
  }
}
