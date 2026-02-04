FROM node:22-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY db ./db
COPY routes ./routes
COPY services ./services
COPY middleware ./middleware
COPY index.ts ./
RUN npx tsc

FROM node:22-slim

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
