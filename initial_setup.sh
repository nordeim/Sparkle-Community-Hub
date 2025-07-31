# 1. Create Next.js project
npx create-next-app@latest sparkle-universe --typescript --tailwind --app

# 2. Install core dependencies
cd sparkle-universe
npm install @prisma/client prisma @tanstack/react-query zustand
npm install @trpc/client @trpc/server @trpc/react-query @trpc/next
npm install next-auth @auth/prisma-adapter
npm install zod bcryptjs jsonwebtoken
npm install --save-dev @types/bcryptjs

# 3. Setup project structure
mkdir -p src/{components,lib,hooks,server,types,styles}
mkdir -p src/components/{ui,features,layouts,providers}
mkdir -p src/server/{api,db,services}
mkdir -p src/lib/{auth,utils,constants}

# 4. Initialize Prisma
npx prisma init

# 5. Configure environment variables
cp .env.example .env.local

# 1. Install shadcn/ui
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card input form toast

# 2. Create base components
# src/components/ui/[component].tsx
# Implement each UI component with Sparkle theme

# 3. Create layout components
# src/components/layouts/navbar.tsx
# src/components/layouts/sidebar.tsx
# src/components/layouts/footer.tsx
