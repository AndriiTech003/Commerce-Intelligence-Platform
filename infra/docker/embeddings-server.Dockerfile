FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @cip/embeddings-server --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY infra ./infra
RUN pnpm turbo run build --filter=@cip/embeddings-server... && pnpm --filter @cip/embeddings-server deploy --prod --legacy /app

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app .
COPY --from=builder /repo/apps/embeddings-server/dist ./dist
ENV EMBEDDINGS_CACHE_DIR=/app/.cache/embeddings EMBEDDINGS_SERVER_HOST=0.0.0.0
USER node
EXPOSE 4189
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4189/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1
CMD ["node", "dist/main.js"]
