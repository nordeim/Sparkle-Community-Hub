# CLAUDE.md - Sparkle Universe Project

This file contains project-specific instructions and context for Claude Code when working on the Sparkle Universe community platform.

## Project Overview
- **Name**: Sparkle Universe
- **Type**: Next.js 15 community platform for Sparkle YouTube fans
- **Stack**: TypeScript, Prisma, PostgreSQL, Tailwind CSS, tRPC

## Development Commands
```bash
# Development
npm run dev                 # Start development server
npm run build              # Build for production
npm run start              # Start production server
npm run lint               # Run ESLint
npm run lint:fix           # Fix ESLint issues
npm run type-check         # TypeScript checking
npm run format             # Format code with Prettier

# Database
npm run db:generate        # Generate Prisma client
npm run db:push            # Push schema changes
npm run db:migrate         # Run migrations
npm run db:seed            # Seed database
npm run db:studio          # Open Prisma Studio

# Testing
npm run test               # Run all tests
npm run test:watch         # Watch mode tests
npm run test:e2e           # E2E tests
```

## Key File Locations
- **Main Routes**: `/src/app/(main)/`
- **Auth Routes**: `/src/app/(auth)/`
- **Admin**: `/src/app/admin/`
- **API**: `/src/server/api/`
- **Components**: `/src/components/`
- **Database**: `/prisma/schema.prisma`

## Environment Setup
Required `.env.local` variables:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_URL` - Auth callback URL
- `NEXTAUTH_SECRET` - Auth secret
- `GOOGLE_CLIENT_ID` - Google OAuth
- `GITHUB_CLIENT_ID` - GitHub OAuth
- `YOUTUBE_API_KEY` - YouTube integration

## Code Standards
- TypeScript strict mode enabled
- ESLint + Prettier configured
- Component-based architecture
- Server components by default
- tRPC for type-safe APIs

## Testing Notes
- Jest for unit tests
- Playwright for E2E tests
- Focus on user flows and security
- Test critical paths: auth, posting, moderation

## Security Guidelines
- All auth routes protected
- Rate limiting implemented
- Input validation with Zod
- SQL injection prevention via Prisma
- XSS protection built-in

## Common Patterns
- Use `use client` directive sparingly
- Server actions for mutations
- Optimistic updates for UX
- Error boundaries for resilience
- Loading states for async operations

## Deployment
- Primary: Vercel Edge Functions
- Docker support available
- PostgreSQL + Redis required
- CDN for static assets