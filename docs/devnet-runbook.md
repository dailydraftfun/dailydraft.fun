# Devnet MVP runbook

The OpenPacks Duel devnet environment is a public integration preview. It is
not a mainnet deployment and must not accept assets with real-world value.

## Public surfaces

| Surface | Address |
| --- | --- |
| Product app | <https://openpacksduel.vercel.app> |
| Marketing site | <https://openpacksduel-web.vercel.app> |
| Solana RPC fallback | `https://api.devnet.solana.com` |
| Escrow program | `Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS` |

The API project is provisioned as `openpacksduel-api` in Vercel. Its production
alias becomes canonical only after `GET /v1/health` passes the manual devnet
smoke workflow.

## Safety boundary

- Show a persistent `DEVNET` label anywhere a wallet or transaction is shown.
- Use only the explicit OpenPacks devnet provider and valueless, real devnet SPL
  mints until Collector Crypt supplies approved partner credentials and confirms
  the custody flow. Never label demo cards as Collector Crypt inventory.
- Support only the token standards explicitly implemented by the devnet escrow.
- Never accept a private key through the app, API, MCP server, issue, or log.
- Keep mainnet and real-value features disabled independently of deployment.
- Treat the public devnet RPC as a fallback. Set a dedicated RPC URL in hosted
  environments before load testing.

## Required environment

### Product app

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SOLANA_NETWORK` | Must be `devnet` for the MVP. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Optional RPC override; defaults to the public devnet endpoint. |
| `NEXT_PUBLIC_DUEL_API_URL` | Public base URL of the deployed API, including `/v1`. |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` | Published devnet escrow program address. |
| `NEXT_PUBLIC_PROVIDER_MODE` | Must be `openpacksduel-devnet` for the on-chain demo. |

### API

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Devnet-only PostgreSQL connection. |
| `OPENPACKSDUEL_NETWORK` | Must be `solana-devnet`. |
| `SOLANA_RPC_URL` | Server-side RPC endpoint. |
| `ESCROW_PROGRAM_ID` | Published devnet escrow program address. |
| `ESCROW_PROVIDER_SIGNER` | Public key authorized to attest provider outcomes; never a private key. |
| `ESCROW_FEE_RECIPIENT` | Public key that receives the platform fee during settlement. |
| `OPENPACKSDUEL_DEVNET_FEE_LAMPORTS` | Per-side platform fee deposited as WSOL; `1000000` for the MVP. |
| `CRON_SECRET` | Long random bearer secret used by Vercel Cron. |
| `SOLANA_RPC_TIMEOUT_MS` | Optional per-request timeout; bounded to 30 seconds. |
| `SOLANA_RPC_RETRIES` | Optional retry count; bounded to four retries. |
| `SOLANA_RECONCILIATION_STUCK_MS` | Operator alert threshold; defaults to ten minutes. |
| `OPENPACKSDUEL_PROVIDER_MODE` | Must be `openpacksduel-devnet` for the on-chain demo. |
| `OPENPACKSDUEL_PROVIDER_ASSET_STANDARD` | Must be `legacy-spl-nft` for OpenPacks devnet demo mints. |
| `OPENPACKSDUEL_DEVNET_PROVIDER_KEYPAIR_JSON` | Sensitive JSON byte array for the isolated devnet provider signer; never expose to browser code. |
| `POKEMON_TCG_API_KEY` | Optional server-only Pokémon TCG API key. Unauthenticated requests work at lower documented limits. |
| `OPENPACKSDUEL_API_KEYS` | Server-to-server integration keys; never expose to the browser. |
| `OPENPACKSDUEL_APP_URL` | Canonical product URL. |
| `OPENPACKSDUEL_AUTH_DOMAIN` | Host matching the canonical product URL in wallet sign-in messages. |
| `OPENPACKSDUEL_STUCK_FUNDED_MINUTES` | Alert threshold for funded duels that have not progressed; defaults to 5. |
| `OPENPACKSDUEL_ALLOWED_TIERS` | Comma-separated enabled USD tiers; defaults to `50`. |
| `OPENPACKSDUEL_MAX_ACTIVE_DUELS_PER_WALLET` | New-exposure wallet limit; defaults to 3. |
| `OPENPACKSDUEL_MAX_CONCURRENT_DUELS_PER_TIER` | New-exposure tier limit; defaults to 20. |
| `OPENPACKSDUEL_HOUSE_ENABLED` | Explicit house-entry switch; defaults to `false`. |
| `OPENPACKSDUEL_HOUSE_DEVNET_FUNDING_SIGNER` | House hot-wallet public key; must equal the finalized token account's bounded SPL delegate. |
| `OPENPACKSDUEL_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY` | Cold finalized token-account owner; must not equal the hot wallet or delegate. |
| `OPENPACKSDUEL_HOUSE_DEVNET_USDC_MINT` | Devnet USDC mint verified from finalized RPC state. |
| `OPENPACKSDUEL_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT` | House token account whose mint, owner, and finalized balance are verified. |
| `OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO` | Required integer total exposure ceiling; missing/zero disables house entry. |
| `OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO` | Required integer UTC-day loss ceiling; missing/zero disables house entry. |
| `OPENPACKSDUEL_HOUSE_MIN_LIQUIDITY_USDC_MICRO` | Required post-reservation liquidity floor; missing/zero disables house entry. |
| `OPENPACKSDUEL_HOUSE_MAX_ACTIVE_PER_WALLET` | House reservation limit per player; defaults to 1. |
| `OPENPACKSDUEL_HOUSE_MAX_CONCURRENT_PER_TIER` | House reservation limit per tier; defaults to 1. |
| `OPENPACKSDUEL_HOUSE_ALLOWED_DISPOSITIONS` | Operator inventory workflow allowlist; defaults to `hold,manual_review`. |
| `CORS_ORIGINS` | Explicit allowed browser origins. |

Every submitted transaction receives an opportunistic finality check. Either
authenticated participant can continue the duel-scoped check at
`POST /v1/duels/{duelId}/transactions/reconciliation`, and the product polls
that endpoint while a known transaction remains active. The global transaction
worker is a once-daily Vercel Hobby recovery net and can also be invoked manually
at `POST /v1/internal/reconciliation/solana`. Both paths treat `confirmed` as
progress and advance duel state only after a `finalized` transaction matches the
stored signer and blockhash plus one unique escrow instruction with the stored
data hash and exact ordered account constraints. The public RPC fallback is
appropriate only for this devnet preview and may rate-limit calls. Funding
requires distinct finalized deposits from both duel participants; the first
side remains `committing`, and only the second completes `funded`.

The once-daily treasury recovery worker at
`GET|POST /v1/internal/reconciliation/treasury` first
advances durable reservation/refund/settlement lifecycle state, then verifies
the configured finalized devnet USDC balance and legacy-SPL house inventory.
House creation and explicit queue fallback reserve micro-USDC inside a
serializable, advisory-locked transaction. Funding preparation fails closed if
that durable reservation is absent, stale, released, or already terminal.
The USDC snapshot is accepted only when the cold withdrawal authority owns the
account and the hot funding signer is its delegate with a remaining allowance no
larger than the configured total-exposure ceiling. Pending worst-case exposure is
included in both daily-loss and total-exposure admission checks.

Provider result commitments, settlement, and per-asset refunds are prepared as
durable unsigned intents and use the same submission/reconciliation path. Card
deposits remain operator-proof only. Each finalized refund records its asset
proof but intentionally leaves the duel `refunding`; a full custody quorum is
still required before any later implementation may mark the duel `refunded`.
Successful demo settlement routes both cards and the fee, then closes all three
empty custody vaults in the same atomic transaction. Card-vault rent returns to
the isolated provider signer that created them; payment-vault rent returns to the
duel creator, and any excess wrapped SOL is swept to the configured fee account.

`POST /v1/duels/:duelId/transactions` prepares the verified Duel v4 funding transaction. It
creates the player's wrapped-SOL associated token account idempotently, wraps exactly the configured
per-side platform fee, and funds the duel PDA. The creator transaction also initializes the duel;
the opponent transaction is enabled only after creator funding finalizes. This transaction does not
pay for or purchase a pack. Solana fees and recoverable token-account rent remain additional.

## Emergency operation

Use only the integration-key-guarded admin API. Do not paste API keys into an
issue, audit reason, or support record.

```bash
curl --fail-with-body -X PUT "$API_URL/admin/emergency-pause" \
  -H "Authorization: Bearer $OPENPACKSDUEL_OPERATOR_KEY" \
  -H "Content-Type: application/json" \
  --data '{"paused":true,"reasonCode":"provider_degraded"}'
```

Confirm the returned `paused` state, then inspect `/admin/audit`, `/admin/risk`,
`/admin/readiness`, and `/admin/duels?attention=all`. Pausing blocks new risk but
deliberately leaves reconciliation, cancel recovery, refunds, and settlement
available. Resume with the same endpoint and `paused:false` after the incident
owner confirms recovery.

## Release order

1. Merge green escrow CI and publish the reviewed program ID.
2. Fund the isolated devnet deployment authority from a faucet. Never change
   the machine-wide Solana RPC configuration to accomplish this.
3. Deploy the escrow using explicit devnet RPC and keypair arguments.
4. Apply the devnet database migration and deploy `openpacksduel-api`.
5. Configure the product app variables and deploy `apps/app` to Vercel.
   Before exposing `/v1/analytics/events`, enable Vercel Firewall/IP rate
   limiting. Its anonymous-session cap is defense-in-depth and session churn
   can bypass it.
6. Run the `Devnet smoke` GitHub workflow with the final API URL.
7. Exercise direct challenge, public queue, disclosed house, cancellation,
   refund, reveal, settlement, social card, and rematch states with valueless
   test assets.

## API deployment from the monorepo

The `openpacksduel-api` Vercel project is configured with Root Directory
`apps/api`, Framework `Other`, and Node.js 24. Run Vercel CLI from the monorepo
root—not `apps/api`—so Bun workspaces and `packages/db` are uploaded together.
Vercel CLI 20.1 or newer is required for shared monorepo source; the current
deployment baseline is 54.9.1.

Before the first deploy, verify **Include source files outside of the Root
Directory** is enabled in the Vercel project’s Root Directory settings. Modern
projects enable it by default, but the API cannot import `packages/db` without
that boundary.

1. Configure all required API variables in the Vercel project. Do not put
   credentials in tracked files. `DATABASE_URL` must use the pooled Neon runtime
   connection when available.
2. In a secure operator shell, set `DATABASE_URL` to the direct migration
   connection. The production deployment script applies only committed
   migrations and stops before deployment if migration fails:

   ```bash
   bun run deploy:api:prod
   ```

   Never substitute `prisma db push`; migration history is the deployment
   contract. A failed migration stops the release before the function deploy.
   The script sets `VERCEL_ORG_ID=team_KHSVltukbViA3Mbyd0KBdW22` and
   `VERCEL_PROJECT_ID=prj_rX5EyAaDo5slW8ea0mUDjwVhb1Xq`, so the repository’s
   frontend `.vercel/project.json` cannot redirect the deployment.
3. For a preview-only deployment after the production database is already at
   the committed migration, deploy from the monorepo root:

   ```bash
   VERCEL_ORG_ID=team_KHSVltukbViA3Mbyd0KBdW22 \
   VERCEL_PROJECT_ID=prj_rX5EyAaDo5slW8ea0mUDjwVhb1Xq \
   vercel deploy --scope vincentshipsit
   ```

4. Confirm the canonical alias and database readiness:

   ```bash
   curl --fail-with-body https://openpacksduel-api.vercel.app/v1/health
   ```

The function fails closed during bootstrap when `DATABASE_URL` is missing. Its
health endpoint returns `503` when PostgreSQL is unavailable or migrations are
pending. Vercel builds generate Prisma Client but never mutate the database.

## Promotion gate

For `openpacksduel-devnet`, provider escrow orchestration creates valueless SPL
demo cards and signs their deposit, result, and settlement transactions with an
isolated keypair stored only as a sensitive Vercel server variable. The key must
never appear in API responses, browser bundles, MCP output, logs, or issues.
The visible name, image, and comparison value are persisted from the Pokémon TCG
API before funding proof is resolved. The committed demo policy fixes the TCGPlayer
market variant order and conversion rule; every outcome hash binds the selected
card, variant, field, and upstream update timestamp. It must never be described
as Collector Crypt insured value.

Collector Crypt mode remains separately fail-closed until it confirms the
canonical mint, authoritative integer insured value and valuation policy,
stable provider references, alternate-recipient custody, and provider request
IDs. The OpenPacks demo path is not evidence that Collector Crypt supports it.

Result and settlement preparation read finalized devnet accounts and require a
legacy SPL mint with decimals `0`, supply `1`, and exactly one matching NFT in
each role PDA vault. Mock outcomes remain valid for UI reveal testing but are
categorically rejected from real escrow preparation.

Devnet readiness does not imply mainnet readiness. Mainnet remains blocked on
Collector Crypt approval, supported recipient and asset standards, canonical
valuation proof, legal/compliance sign-off, production persistence, independent
escrow audit, governed upgrade authority, and incident controls.
