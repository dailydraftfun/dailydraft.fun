# OpenPacks Duel API

NestJS 11 API implementing the devnet contract in `apps/docs/openapi.yaml`.

The devnet foundation provides health, pack discovery, durable PostgreSQL-backed
duel intents, direct invitations, open matchmaking, disclosed house opponents,
auditable state events, transaction reconciliation records, deterministic timeout
cancellation, and social-card metadata. Transaction preparation returns
`501 Not Implemented` until the Solana escrow integration constructs verifiable
unsigned transactions.

Submitted escrow signatures are bound idempotently to a previously prepared
intent and reconciled independently of the browser. The server validates the
RPC cluster genesis hash, follows `confirmed` progress, requires `finalized`
before advancing a duel, and re-verifies the transaction signature, recent
blockhash, signer, and one uniquely matching target instruction. That instruction
must match the escrow program, encoded-data hash, and exact ordered account
signer/write constraints recorded by the prepared intent. Vercel Cron
calls `GET /v1/internal/reconciliation/solana` with `CRON_SECRET`; operators can
run the same batch with `POST` and either the cron secret or an integration key.

The monitor does not create pack purchases or escrow instructions. Preparation
remains `501` until the deployed escrow IDL, valueless devnet mints, and provider
transaction builders are integrated. A signature without a durable prepared
intent is rejected rather than inferred from chain data.

Funded duels can use the authenticated `POST /v1/duels/{duelId}/open-packs`
orchestrator. It generates and opens both sides through one provider boundary,
normalizes USDC insured values, compares integer amounts, and records a public,
sanitized result ready for the settlement service. House and wallet opponents
use the same path.

## Local development

```bash
cp .env.example .env
bun --filter @openpacksduel/db db:deploy
bun run dev
```

The API listens on `http://localhost:3003/v1`. Browser players authenticate by
signing a five-minute, domain/URI/chain-bound Wallet Standard message. The API
stores the nonce in PostgreSQL, consumes it once, and returns a 15-minute opaque
session whose SHA-256 hash is the only token material persisted server-side.
That wallet session can create, join, or cancel only for its own address.

Server integrations can still use a bearer key listed in
`OPENPACKSDUEL_API_KEYS`. Integration keys retain access to operator event and
transaction routes and must never be shipped to browser code.

`DATABASE_URL` is mandatory. `OPENPACKSDUEL_PROVIDER_MODE` defaults to `mock` and
every duel is explicitly labeled `solana-devnet`; this API is not mainnet-ready.
The deterministic mock provider refuses to run unless `OPENPACKSDUEL_NETWORK`
is `solana-devnet`. Its asset references and values are valueless test data.
`SOLANA_RPC_URL` defaults server-side to `https://api.devnet.solana.com`; every
worker validates the official devnet genesis hash before reading transaction
state. Set `ESCROW_PROGRAM_ID` and a long random `CRON_SECRET` in Vercel.

`collector-crypt-sandbox` is a fail-closed adapter stub: no undocumented HTTP
paths or response shapes are assumed. It remains unavailable until Collector
Crypt confirms partner authentication, sandbox access, pack identifiers,
generate/open/status schemas, idempotency, alternate-recipient custody, the
canonical insured-value field, and buyback eligibility. Any future provider
credential is server-only and must never use a `NEXT_PUBLIC_` variable.

## Vercel

The Vercel project uses `apps/api` as its Root Directory, but CLI deploys must be
started from the monorepo root so the `@openpacksduel/db` workspace is uploaded.
`api/[...path].ts` caches one initialized Nest/Fastify application per warm Node
24 function instance and disables process shutdown hooks in serverless mode.

The build generates Prisma Client and explicitly includes it in the function
trace. Database migrations are never run during a Vercel build. Follow the
ordered migration and deploy procedure in `docs/devnet-runbook.md`.

Set `OPENPACKSDUEL_APP_URL` to the canonical HTTPS app origin and
`OPENPACKSDUEL_AUTH_DOMAIN` to its matching host. Only localhost may use HTTP.
Every signed message is hard-bound to `solana:devnet`; there is no mainnet
configuration switch.
