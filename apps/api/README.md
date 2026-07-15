# OpenPacks Duel API

NestJS 11 API implementing the devnet contract in `apps/docs/openapi.yaml`.

The devnet foundation provides health, pack discovery, durable PostgreSQL-backed
duel intents, direct invitations, open matchmaking, disclosed house opponents,
auditable state events, transaction reconciliation records, deterministic timeout
cancellation, and social-card metadata. Transaction preparation returns
`501 Not Implemented` until the Solana escrow integration constructs verifiable
unsigned transactions.

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

The API listens on `http://localhost:3003/v1`. Mutation routes require a bearer
key listed in `OPENPACKSDUEL_API_KEYS`; the server fails closed when no keys are
configured.

`DATABASE_URL` is mandatory. `OPENPACKSDUEL_PROVIDER_MODE` defaults to `mock` and
every duel is explicitly labeled `solana-devnet`; this API is not mainnet-ready.
The deterministic mock provider refuses to run unless `OPENPACKSDUEL_NETWORK`
is `solana-devnet`. Its asset references and values are valueless test data.

`collector-crypt-sandbox` is a fail-closed adapter stub: no undocumented HTTP
paths or response shapes are assumed. It remains unavailable until Collector
Crypt confirms partner authentication, sandbox access, pack identifiers,
generate/open/status schemas, idempotency, alternate-recipient custody, the
canonical insured-value field, and buyback eligibility. Any future provider
credential is server-only and must never use a `NEXT_PUBLIC_` variable.

Never expose an integration API key in browser code. Wallet authentication and
signed sessions remain separate from server-to-server integration keys.
