// prisma/seed.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Seed data
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
