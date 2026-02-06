## Stage 1: Build gog-token-sync
FROM golang:1.21-bookworm AS gog-token-sync-builder
WORKDIR /build
COPY tools/gog-token-sync/go.mod tools/gog-token-sync/go.sum ./
RUN go mod download
COPY tools/gog-token-sync/main.go ./
RUN CGO_ENABLED=0 go build -o gog-token-sync .

## Stage 2: Main application
FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install gog (Google Workspace CLI)
ARG TARGETARCH
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -fsSL "https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_${ARCH}.tar.gz" | \
    tar -xz -C /usr/local/bin gog && \
    chmod +x /usr/local/bin/gog

# Copy gog-token-sync from builder
COPY --from=gog-token-sync-builder /build/gog-token-sync /usr/local/bin/gog-token-sync

# Install jq for JSON parsing in scripts
RUN apt-get update && apt-get install -y --no-install-recommends jq && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Playwright with Chromium for browser automation
RUN npx playwright install chromium --with-deps

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
# Increase Node.js heap size for TypeScript compilation
RUN NODE_OPTIONS="--max-old-space-size=4096" OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:install
RUN pnpm ui:build

ENV NODE_ENV=production

# Copy and setup entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Note: Running as root for now because gog config needs /root/.config
# TODO: Fix permissions for non-root user
# USER node

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
