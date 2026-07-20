# OpenPacks Duel database

Prisma 7 schema and PostgreSQL migrations for durable devnet duel state.

## Deploy migrations

Set the target database URL explicitly, then deploy the checked-in migrations:

```bash
export DATABASE_URL='postgresql://...'
bun --filter @openpacksduel/db db:deploy
```

Generate the client without connecting to PostgreSQL:

```bash
bun --filter @openpacksduel/db db:generate
```

Client generation uses an inert localhost URL when `DATABASE_URL` is absent.
The workspace build also bundles the generated client into `dist/index.js` for
Node serverless runtimes. Bun and TypeScript continue to resolve the source entry
directly during local development.

The API does not: startup fails closed with `DATABASE_URL is required for durable
duel state`, and `/v1/health` returns `503` when PostgreSQL is unavailable or the
migrations have not been deployed.

The current schema supports Solana devnet only. Adding mainnet requires a new
network enum migration, audited settlement integration, and an explicit release.

## Migration CI

Pull requests that change this package run every committed migration against an
empty workflow-local PostgreSQL database, validate `schema.prisma`, and reject
drift between the migrated database and the schema. The check uses no repository
secrets and also proves that a temporary schema-only change is detected. The same
job executes `prisma/verify-house-treasury.sql` inside a rolled-back transaction
to verify reservation states, exposure indexes and constraints, and the
append-only ledger trigger against the migrated PostgreSQL schema.
