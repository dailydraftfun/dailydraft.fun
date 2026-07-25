# DailyDraft Developer Docs

Nextra-powered, contract-first integration documentation for DailyDraft.

The canonical API contract is [`public/openapi.yaml`](public/openapi.yaml). The
docs app exposes it at `/openapi.yaml` and renders an interactive Scalar
reference at `/reference`. The initial API implementation lives in `apps/api`;
production persistence and Solana settlement remain preview work.

> [!IMPORTANT]
> The v1 API is a preview contract. Endpoints marked with
> `x-dailydraft-availability: preview` are not production promises yet.

## Local preview

```bash
bun install
bun run api:lint
bun run dev
```

Open `http://localhost:3002`. No secrets are required to render the docs or API
reference.

## Contract rules

- Wallets sign Solana transactions; the API never accepts private keys.
- Mutations require an API key and `Idempotency-Key`.
- Transaction endpoints return serialized transactions for the wallet to inspect
  and sign; they never claim settlement before chain confirmation.
- Monetary values are integer minor units plus an explicit currency.
- Winner calculation uses only the provider-specific, pre-funded valuation policy documented in
  [`content/guides/valuation-and-proof.mdx`](content/guides/valuation-and-proof.mdx).
- Webhook consumers must verify signatures and tolerate duplicate delivery.

## Monorepo location

This app lives at `apps/docs` in
[`dailydraftfun/dailydraft.fun`](https://github.com/dailydraftfun/dailydraft.fun). Configure that path
as the Vercel project root.

## Related repositories

- [`dailydraftfun/dailydraft.fun`](https://github.com/dailydraftfun/dailydraft.fun) — product, docs, MCP, and API implementation
- [`dailydraftfun/escrow`](https://github.com/dailydraftfun/escrow) — public Solana program
- [`dailydraftfun/skills`](https://github.com/dailydraftfun/skills) — installable agent workflows

## License

[MIT](LICENSE)
