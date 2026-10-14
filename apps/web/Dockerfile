# ---------------------------------------------------------------------------
# FlowForge web image — builds the SPA, serves it with nginx and proxies
# /api and /socket.io to the api service. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t flowforge-web .
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --include=dev

COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build -w @flowforge/web

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY infra/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
