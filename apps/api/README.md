# OpenPacks Duel API

NestJS 11 API implementing the devnet contract in `apps/docs/openapi.yaml`.

The devnet foundation provides health, pack discovery, durable PostgreSQL-backed
duel intents, direct invitations, open matchmaking, disclosed house opponents,
auditable state events, transaction reconciliation records, deterministic timeout
cancellation, and social-card metadata. Transaction preparation returns
`501 Not Implemented` until the Solana escrow integration constructs verifiable
unsigned transactions.

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

Never expose an integration API key in browser code. Wallet authentication and
signed sessions remain separate from server-to-server integration keys.
