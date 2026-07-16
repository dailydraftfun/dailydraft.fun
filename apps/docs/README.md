# OpenPacks Duel Developer Docs

Contract-first integration documentation for OpenPacks Duel.

The canonical API contract is [`openapi.yaml`](openapi.yaml). The included
Scalar reference is a static Vercel site. The initial API implementation lives
in `apps/api`; production persistence and Solana settlement remain preview work.

> [!IMPORTANT]
> The v1 API is a preview contract. Endpoints marked with
> `x-openpacksduel-availability: preview` are not production promises yet.

## Local preview

```bash
bun install
bun run api:lint
bunx serve .
```

Open `http://localhost:3000`. No secrets are required to render the reference.

## Contract rules

- Wallets sign Solana transactions; the API never accepts private keys.
- Mutations require an API key and `Idempotency-Key`.
- Transaction endpoints return serialized transactions for the wallet to inspect
  and sign; they never claim settlement before chain confirmation.
- Monetary values are integer minor units plus an explicit currency.
- Winner calculation uses only the provider-specific, pre-funded valuation policy documented in
  [`guides/valuation-and-proof.md`](guides/valuation-and-proof.md).
- Webhook consumers must verify signatures and tolerate duplicate delivery.

## Monorepo location

This app lives at `apps/docs` in
[`openpacksduel/app`](https://github.com/openpacksduel/app). Configure that path
as the Vercel project root.

## Related repositories

- [`openpacksduel/app`](https://github.com/openpacksduel/app) — product, docs, MCP, and API implementation
- [`openpacksduel/escrow`](https://github.com/openpacksduel/escrow) — public Solana program
- [`openpacksduel/skills`](https://github.com/openpacksduel/skills) — installable agent workflows

## License

[MIT](LICENSE)
