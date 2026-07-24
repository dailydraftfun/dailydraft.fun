FROM oven/bun:1.3.13 AS builder
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile
RUN bun --filter @openpacksduel/db db:generate
RUN bun --filter @openpacksduel/api build

FROM oven/bun:1.3.13 AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/bun.lock ./bun.lock
COPY --from=builder --chown=bun:bun /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=bun:bun /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=bun:bun /app/packages/db ./packages/db

USER bun
EXPOSE 3000
CMD ["bun", "run", "apps/api/dist/src/main.js"]
