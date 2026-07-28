# API production artifact contract

The API production build is a deterministic Bun artifact. `bun --filter
@dailydraft/api build` emits both execution paths under `apps/api/dist`:

- `src/main.js` is the long-running Bun entrypoint used by `bun --filter
  @dailydraft/api start`; that command sets `NODE_ENV=production` explicitly.
- `api/index.js` is the Vercel serverless handler.
- `openapi.yaml` is a byte-for-byte copy of the canonical contract in
  `apps/docs/public/openapi.yaml`.
- `production-manifest.json` binds the runtime, entrypoints, health route,
  OpenAPI SHA-256, environment-contract version, and persistence profiles.

The bundled OpenAPI remains a devnet contract. The build and conformance job do
not add or advertise a live production API server.

## Deployment environment

`createApp()` validates deployed configuration before constructing Fastify,
Nest, or the database client. Both preview and production deployments require:

- `DATABASE_URL`
- `DAILYDRAFT_API_KEYS`
- `DAILYDRAFT_APP_URL`
- `DAILYDRAFT_AUTH_DOMAIN`
- `DAILYDRAFT_NETWORK=solana-devnet`
- `CORS_ORIGINS`, including the canonical app origin

Production additionally requires `CRON_SECRET`,
`DAILYDRAFT_PROVIDER_MODE=dailydraft-devnet`, and an explicit
`DAILYDRAFT_TRUSTED_PROXIES`. The production deploy derives the last value from
the exact `shipshit-caddy` address on the selected Docker network; it does not
accept a potentially stale SSM override. URLs, domains, ports, and secrets are
validated without writing their values to the conformance report.
Every required key has a deterministic missing-value fixture.

The HTTP boundary accepts browser origins only from `CORS_ORIGINS`, preserves a
canonical `x-request-id` or assigns one, and publishes bounded rate-limit
metadata. Forwarded headers are trusted only from literal addresses listed in
`DAILYDRAFT_TRUSTED_PROXIES`; malformed forwarding from a trusted proxy is
rejected, while forwarding from every other peer is ignored. Structured request
logs contain route, method, status, duration, request ID, remote address, and
rate-limit counters only—never headers, credentials, bodies, or provider
payloads. Unmatched routes are logged without query strings or fragments.

Preview persistence is classified as `ephemeral-preview`; it must never be
treated as release evidence. Production persistence is classified as
`durable-postgresql` and requires an explicit PostgreSQL connection string.
This classification describes the deployment guarantee, not permission to
perform production operations.

## CI evidence

The `API production contract` workflow uses a disposable PostgreSQL service,
applies committed migrations, and assembles the artifact. Its conformance
reporter compares the running route inventory with OpenAPI before starting
`dist/src/main.js` and probing `/v1/health`, so a compatibility failure is part of
the retained machine verdict. The probe requires the service, version, database
dependency, and request ID metadata already declared by the public health
contract.

The workflow always uploads `artifacts/api-production-conformance.json` for
seven days. The report contains check names and pass/fail details only; it never
contains environment values, credentials, database URLs, or response logs.
