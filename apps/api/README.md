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

Funding reconciliation follows escrow v2's two-sided fee-deposit protocol. A
single finalized `fund` transaction records that participant's side but keeps
the duel `committing`; only one finalized deposit from each distinct creator and
opponent wallet atomically advances the duel to `funded`. Duplicate-wallet or
non-participant quorum fails closed into refund recovery.

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

## Open matchmaking

`POST /v1/matchmaking/search` is the canonical public queue. It creates one durable
ticket per wallet and matches only an exact pack tier, valuation policy, provider
mode, server-verified region segment, and risk segment. Duplicate tabs and reconnects
receive the same ticket. Assignment uses wallet and duel-role unique constraints plus
status/version compare-and-swap updates inside the database client's serializable
transaction policy; a general duel join cannot claim a ticket-backed queue duel.
Matches have a bounded funding commitment window; timeouts
record a behavior failure and requeue the creator unless repeated failures trigger a
temporary block. Search expiry, cancellation, match, commitment failure, wait time,
and house fallback are recorded as server-side product events.

The queue fails closed until `OPENPACKSDUEL_MATCHMAKING_REGION_SEGMENT` and
`OPENPACKSDUEL_MATCHMAKING_RISK_SEGMENT` are provided by an upstream verified policy;
the API does not infer geolocation from user input. House fallback is a separate,
explicit endpoint, includes disclosure in the session response, and remains disabled
by default through `OPENPACKSDUEL_HOUSE_ENABLED=false`. It is never an automatic queue
conversion. Wallet-level limits do not prevent coordinated multi-wallet abuse, which
still requires upstream identity/risk controls before mainnet.

## Privacy-safe observability

`POST /v1/analytics/events` accepts only allowlisted names and bounded
duel/status/tier/mode fields under a random per-tab `anon_*` session. The schema
has no wallet, signature, bearer-token, private-key, metadata, or free-form error
field. The public allowlist contains UI intent only; lifecycle transitions and
operational failures are recorded server-side. Payloads are capped at 20 events
and each anonymous session is capped at 120 events per five minutes. Those caps
are defense-in-depth, not abuse resistance: session churn bypasses them. A public
production deployment must configure Vercel Firewall/IP rate limiting while the
API continues not to persist network identifiers.

`GET /v1/analytics/funnel` requires an integration key and returns only
aggregates: funnel conversion, match/provider latency percentiles, abandonment,
refund and settlement-failure rates, provider/RPC error totals, duel-status
counts, and the stuck-funded alert configured by
`OPENPACKSDUEL_STUCK_FUNDED_MINUTES`.
Canonical funnel transitions and operational alerts use `SERVER` rows only;
client UI errors are reported separately under `experience`.

## Admin and emergency controls

All `/v1/admin/*` routes require an integration key and return `no-store`
responses. Operators can paginate stuck/failed duels, inspect complete duel,
transaction, provider, valuation, and custody timelines, view risk/configuration
readiness, and pause or resume new exposure. The pause blocks create, join,
funding preparation, pack opening, and house entry while reads, cancellation,
refund/settlement recovery, and reconciliation remain available.

Pause changes append an immutable database audit record containing only the
fixed `integration-key` actor class and a bounded reason code; raw API keys are
never persisted. Configure allowed tiers, wallet exposure, tier concurrency,
and house availability with the `OPENPACKSDUEL_ALLOWED_TIERS`,
`OPENPACKSDUEL_MAX_ACTIVE_DUELS_PER_WALLET`,
`OPENPACKSDUEL_MAX_CONCURRENT_DUELS_PER_TIER`, and
`OPENPACKSDUEL_HOUSE_ENABLED` environment variables. Conservative defaults are
`50`, `3`, `20`, and `false` respectively.
The deterministic mock provider refuses to run unless `OPENPACKSDUEL_NETWORK`
is `solana-devnet`. Its asset references and values are valueless test data.
`SOLANA_RPC_URL` defaults server-side to `https://api.devnet.solana.com`; every
worker validates the official devnet genesis hash before reading transaction
state. Funding preparation additionally requires `ESCROW_PROGRAM_ID`,
`ESCROW_PROVIDER_SIGNER`, `ESCROW_FEE_RECIPIENT`, and
`OPENPACKSDUEL_DEVNET_FEE_LAMPORTS`; it fails closed if any value is missing or invalid. Set a long
random `CRON_SECRET` in Vercel.

`collector-crypt-sandbox` is a fail-closed adapter stub: no undocumented HTTP
paths or response shapes are assumed. It remains unavailable until Collector
Crypt confirms partner authentication, sandbox access, pack identifiers,
generate/open/status schemas, idempotency, alternate-recipient custody, the
canonical insured-value field, and buyback eligibility. Any future provider
credential is server-only and must never use a `NEXT_PUBLIC_` variable.

The integration-only provider escrow preparation endpoint builds unsigned card
deposit, result commitment, settlement, and per-asset expiry-refund transactions.
It never signs or submits. Real-asset preparation remains disabled unless the
persisted outcomes are non-mock Collector Crypt evidence with canonical Solana
mint addresses, integer USDC insured values, one valuation policy, and
`OPENPACKSDUEL_PROVIDER_ASSET_STANDARD=legacy-spl-nft`. Finalized RPC reads must
also prove a zero-decimal/single-supply legacy mint and the exact card in each
escrow PDA vault before result or settlement preparation.

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
