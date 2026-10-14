# ---------------------------------------------------------------------------
# FlowForge API image — build from the repository root:
#   docker build -f apps/api/Dockerfile -t flowforge-api .
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Workspace manifests first so dependency layers cache independently of source.
COPY package.json package-lock.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --include=dev

COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build -w @flowforge/api

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# Production dependencies only; @flowforge/shared is bundled into dist by tsup.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /app/apps/api/storage && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
