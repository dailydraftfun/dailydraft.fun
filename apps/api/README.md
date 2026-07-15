# OpenPacks Duel API

NestJS 11 API implementing the preview contract in `apps/docs/openapi.yaml`.

The current foundation provides health, pack discovery, duel discovery, ephemeral
authenticated duel creation, and social-card metadata. Transaction preparation
returns `501 Not Implemented` until the Solana escrow integration can construct
verifiable unsigned transactions.

## Local development

```bash
cp .env.example .env
bun run dev
```

The API listens on `http://localhost:3003/v1`. Mutation routes require a bearer
key listed in `OPENPACKSDUEL_API_KEYS`; the server fails closed when no keys are
configured.

Never expose an integration API key in browser code. Wallet authentication and
signed sessions remain separate from server-to-server integration keys.
