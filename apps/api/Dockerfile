FROM oven/bun:1.3.13 AS builder
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile
RUN bun --filter @dailydraft/db db:generate
RUN bun --filter @dailydraft/api build

FROM oven/bun:1.3.13 AS runner
WORKDIR /app
# pg-connection-string treats sslmode=require as verify-full, so the runtime verifies
# the RDS certificate chain against the system trust store -- which has no Amazon RDS
# root and fails with "self signed certificate in certificate chain". The Prisma CLI
# uses its own engine and is unaffected, which is why migrations pass and queries do
# not. Trusting the region bundle keeps full verification instead of disabling it.
ENV NODE_ENV=production PORT=3000 NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-ca.pem
COPY deploy/dailydraft/rds-us-west-1-bundle.pem /etc/ssl/certs/rds-ca.pem

COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/bun.lock ./bun.lock
COPY --from=builder --chown=bun:bun /app/apps/api/package.json ./apps/api/package.json
# Bun links workspaces in isolation: apps/api/node_modules holds the symlink farm for
# this app's dependencies, each pointing into the shared /app/node_modules/.bun store.
# Without it the API resolves none of its runtime deps and dies on reflect-metadata.
COPY --from=builder --chown=bun:bun /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=bun:bun /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=bun:bun /app/packages/contracts ./packages/contracts
COPY --from=builder --chown=bun:bun /app/packages/db ./packages/db

USER bun
EXPOSE 3000
CMD ["bun", "run", "apps/api/dist/src/main.js"]
