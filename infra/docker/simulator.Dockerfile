FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @cip/simulator --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY infra ./infra
RUN pnpm turbo run build --filter=@cip/simulator... && pnpm --filter @cip/simulator deploy --prod --legacy /app

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app .
COPY --from=builder /repo/apps/simulator/dist ./dist
COPY --from=builder /repo/infra /infra
USER node
EXPOSE 4160
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4160/health/live || exit 1
CMD ["node", "dist/main.js"]
