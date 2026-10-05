FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @cip/storefront --docker

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@cip/storefront...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4130 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder /repo/apps/storefront/.next/standalone ./
COPY --from=builder /repo/apps/storefront/.next/static ./apps/storefront/.next/static
USER node
EXPOSE 4130
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4130/ || exit 1
CMD ["node", "apps/storefront/server.js"]
