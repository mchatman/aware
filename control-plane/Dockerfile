FROM node:22-slim

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY . .

# Build TypeScript
RUN pnpm build

# Run
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
