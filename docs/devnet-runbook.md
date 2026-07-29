# Devnet MVP runbook

The DailyDraft devnet environment is a public integration preview. It is
not a mainnet deployment and must not accept assets with real-world value.

## Public surfaces

| Surface | Address |
| --- | --- |
| Marketing site | <https://dailydraft.fun> |
| Product app | <https://app.dailydraft.fun> |
| API | <https://api.dailydraft.fun> |
| Docs | <https://docs.dailydraft.fun> |
| MCP server | <https://mcp.dailydraft.fun> |
| Solana RPC fallback | `https://api.devnet.solana.com` |
| Escrow program | `Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS` |

Every surface except the API is a Vercel project named after the host it serves,
rooted at the matching workspace: `apps/web`, `apps/app`, `apps/docs`, `apps/mcp`.
The API runs on EC2 behind Caddy and is canonical only after `GET /v1/health`
passes the manual devnet smoke workflow.

## Safety boundary

- Show a persistent `DEVNET` label anywhere a wallet or transaction is shown.
- Use only the explicit DailyDraft devnet provider and valueless, real devnet SPL
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
| `NEXT_PUBLIC_PROVIDER_MODE` | Must be `dailydraft-devnet` for the on-chain demo. |

The read-only `/admin/treasury` operator view is server-rendered and fails
closed unless all three server-only values below are configured. None may use a
`NEXT_PUBLIC_` prefix.

| Variable | Purpose |
| --- | --- |
| `DAILYDRAFT_API_URL` | Server-side API base URL, including `/v1`. |
| `DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN` | Separate bearer presented to the product server by the operator access proxy. It authorizes only the dashboard route. |
| `DAILYDRAFT_OPERATOR_API_KEY` | Integration key used by the product server to read `/admin/treasury`; never returned to or entered in the browser. |

### API

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Devnet-only PostgreSQL connection. |
| `DAILYDRAFT_NETWORK` | Must be `solana-devnet`. |
| `SOLANA_RPC_URL` | Server-side RPC endpoint. |
| `ESCROW_PROGRAM_ID` | Published devnet escrow program address. |
| `ESCROW_PROVIDER_SIGNER` | Public key authorized to attest provider outcomes; never a private key. |
| `ESCROW_FEE_RECIPIENT` | Public key that receives the platform fee during settlement. |
| `DAILYDRAFT_DEVNET_FEE_LAMPORTS` | Per-side platform fee deposited as WSOL; `1000000` for the MVP. |
| `CRON_SECRET` | Long random bearer secret used by the host reconciliation timers. |
| `SOLANA_RPC_TIMEOUT_MS` | Optional per-request timeout; bounded to 30 seconds. |
| `SOLANA_RPC_RETRIES` | Optional retry count; bounded to four retries. |
| `SOLANA_RECONCILIATION_STUCK_MS` | Operator alert threshold; defaults to ten minutes. |
| `DAILYDRAFT_PROVIDER_MODE` | Must be `dailydraft-devnet` for the on-chain demo. |
| `DAILYDRAFT_PROVIDER_ASSET_STANDARD` | Must be `legacy-spl-nft` for DailyDraft devnet demo mints. |
| `DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON` | Sensitive JSON byte array for the isolated devnet provider signer; never expose to browser code. |
| `POKEMON_TCG_API_KEY` | Optional server-only Pokémon TCG API key. Unauthenticated requests work at lower documented limits. |
| `POKEMON_TCG_API_TIMEOUT_MS` | Optional per-attempt Pokémon TCG timeout; defaults to 20 seconds and is bounded to 60 seconds. |
| `POKEMON_TCG_API_RETRIES` | Optional transient Pokémon TCG retry count; defaults to one and is bounded to three retries. |
| `POKEMON_TCG_API_RETRY_DELAY_MS` | Optional linear retry backoff; defaults to 250 ms and is bounded to five seconds. |
| `DAILYDRAFT_API_KEYS` | Server-to-server integration keys; never expose to the browser. |
| `DAILYDRAFT_APP_URL` | Canonical HTTPS product origin; required outside explicit local development. |
| `DAILYDRAFT_AUTH_DOMAIN` | Host matching the canonical product URL in wallet sign-in messages. |
| `DAILYDRAFT_STUCK_FUNDED_MINUTES` | Alert threshold for funded duels that have not progressed; defaults to 5. |
| `DAILYDRAFT_ALLOWED_TIERS` | Comma-separated enabled USD tiers; defaults to `50`. |
| `DAILYDRAFT_MAX_ACTIVE_DUELS_PER_WALLET` | New-exposure wallet limit; defaults to 3. |
| `DAILYDRAFT_MAX_CONCURRENT_DUELS_PER_TIER` | New-exposure tier limit; defaults to 20. |
| `DAILYDRAFT_HOUSE_ENABLED` | Explicit house-entry switch; defaults to `false`. |
| `DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER` | House hot-wallet public key; must equal the finalized token account's bounded SPL delegate. |
| `DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY` | Cold finalized token-account owner; must not equal the hot wallet or delegate. |
| `DAILYDRAFT_HOUSE_DEVNET_USDC_MINT` | Devnet USDC mint verified from finalized RPC state. |
| `DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT` | House token account whose mint, owner, and finalized balance are verified. |
| `DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO` | Required integer total exposure ceiling; missing/zero disables house entry. |
| `DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO` | Required integer UTC-day loss ceiling; missing/zero disables house entry. |
| `DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO` | Required post-reservation liquidity floor; missing/zero disables house entry. |
| `DAILYDRAFT_HOUSE_MAX_ACTIVE_PER_WALLET` | House reservation limit per player; defaults to 1. |
| `DAILYDRAFT_HOUSE_MAX_CONCURRENT_PER_TIER` | House reservation limit per tier; defaults to 1. |
| `DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS` | Operator inventory workflow allowlist; defaults to `hold,manual_review`. |
| `CORS_ORIGINS` | Explicit allowed browser origins. |
| `DAILYDRAFT_TRUSTED_PROXIES` | Optional literal reverse-proxy peers for local/preview use. Production does not snapshot Caddy's ephemeral IP. |
| `DAILYDRAFT_TRUSTED_PROXY_HOSTS` | Stable reverse-proxy DNS identities refreshed at runtime. Production deploys set this to `shipshit-caddy`; do not maintain an SSM override. |
| `DAILYDRAFT_TRUSTED_PROXY_REFRESH_MS` | Optional DNS refresh interval, bounded from one to sixty seconds and defaulting to five seconds. |
| `DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS` | Optional JSON map of provider IDs to 32+ character HMAC keys. Listing sale/delist transitions fail closed until the relevant provider key is configured. |

## House treasury authority and operating procedure

House operation uses distinct authorities. A public address may appear in
configuration and evidence; its private key or recovery material must never
appear in application configuration, browser storage, logs, issues, chat, the
operator dashboard, or an API response.

| Role | Ownership and permitted use |
| --- | --- |
| House hot wallet / funding signer | `DAILYDRAFT_HOUSE_DEVNET_WALLET` and `DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER` must identify the same isolated devnet signing key. It may fund admitted House sessions only. |
| Treasury token-account delegate | The hot funding signer must be the finalized SPL delegate of `DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT`. Its remaining delegated allowance must not exceed `DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO`. |
| Cold withdrawal authority | `DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY` must own the finalized treasury token account. Keep its signing key offline or in separately controlled custody; the application and reconciliation worker do not receive it. |
| Provider signer | `ESCROW_PROVIDER_SIGNER` and `DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON` attest and submit devnet asset lifecycle transactions. Do not reuse the treasury hot key or cold withdrawal key. |
| Operator integration key | May read guarded evidence, pause new exposure, and record approved inventory dispositions. It is not a Solana signing authority and cannot withdraw funds. |
| Reconciliation worker key | Invokes internal recovery and reconciliation routes only. It is not an operator key or Solana signing authority. |

The following combinations are forbidden:

- The cold withdrawal authority must not equal the house wallet, funding
  signer, treasury delegate, provider signer, fee recipient, deployment
  authority, or operator integration key.
- The hot funding signer must not own the treasury token account or hold the
  cold authority's recovery material.
- The operator dashboard credential, integration key, and reconciliation
  worker key must remain separate credentials with separate rotation records.
- A single secret store entry, local keypair file, hardware-wallet seed, or
  recovery envelope must not back multiple roles.

The API checks the on-chain owner, delegate, delegated allowance, mint, network,
and finalized balance. A configuration value alone is not evidence that an
authority is correctly assigned.

### Approval record

Any authority change, limit change, withdrawal, or House re-enable requires a
reviewed change record before execution. Record:

1. purpose, incident or change identifier, environment, and UTC execution
   window;
2. current and proposed public addresses, limits, and affected SSM parameter
   names;
3. current pending reservations, funded sessions, available liquidity,
   unresolved discrepancies, and last finalized observation slot;
4. the approving operator and a separate custody approver for any action that
   uses the cold authority;
5. expected on-chain instructions and the rollback or fail-closed condition;
6. after execution, finalized transaction signatures, observed slot,
   reconciliation result, and the decision to remain paused or resume.

Never include seed phrases, private-key bytes, bearer values, decrypted SSM
values, or full keypair paths in the record. If an independent custody approver
is unavailable, do not perform a withdrawal or cold-authority rotation.

### Hot funding signer rotation

1. Pause new exposure through the guarded emergency-pause endpoint. Do not
   cancel or rewrite already-funded sessions.
2. Record `/admin/treasury`, `/admin/readiness`, and
   `/admin/duels?attention=all`. Wait for reservations that have not funded to
   release or cancel them through their normal player-safe path.
3. Create a new isolated devnet hot key in the approved secret store. Record
   only its public address.
4. Using the cold authority, replace the treasury token account's SPL delegate
   with the new hot address and an allowance no greater than the configured
   total-exposure ceiling. Wait for finalization.
5. Update both `DAILYDRAFT_HOUSE_DEVNET_WALLET` and
   `DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER` atomically to the new public address,
   then deploy through the normal candidate/health-check process.
6. Run treasury reconciliation. Confirm the finalized owner, mint, delegate,
   delegated allowance, balance, and observation slot match the approved
   record. Confirm there are no unresolved reconciliation discrepancies.
7. Revoke and archive the previous hot secret according to the secret-store
   retention policy. Resume only after readiness and every enabled tier are
   healthy.

A mismatched delegate, stale snapshot, unresolved discrepancy, or partially
updated configuration leaves House admission disabled. Never temporarily raise
an allowance or exposure limit to make a rotation pass.

### Cold withdrawal-authority rotation

1. Pause new exposure and keep it paused throughout the change.
2. Confirm there are no active reservations, funded House sessions, pending
   settlements or refunds, or unresolved custody discrepancies. Cold rotation
   does not override those lifecycle obligations.
3. Create the replacement authority in separately controlled cold custody and
   obtain the custody approval record.
4. Use the current cold authority to transfer the treasury token-account owner
   authority to the replacement public address. Do not change mint, token
   account, delegate, or allowance in the same change unless separately
   approved and itemized.
5. Wait for finalization, update
   `DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY`, deploy, and reconcile.
6. Verify the new owner and existing bounded delegate from finalized RPC
   evidence. Archive the old authority only after the new custody recovery
   procedure has been tested.
7. Resume only when the dashboard reports a fresh snapshot, zero
   discrepancies, separation of duties, and no configuration errors.

### Withdrawal procedure

There is no application, admin-API, dashboard, worker, or automated withdrawal
path. A withdrawal is an exceptional cold-custody operation:

1. Open and approve a withdrawal record containing destination public address,
   exact integer micro-USDC amount, purpose, expected post-withdrawal balance,
   and custody approver.
2. Pause new exposure. Confirm no active reservation, funded session,
   settlement, or refund depends on the amount.
3. Confirm the expected post-withdrawal balance remains at or above
   `DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO` and covers all unresolved
   worst-case exposure. Do not treat delegated allowance as available balance.
4. From cold custody, submit one exact SPL-token transfer to the approved
   destination. Do not use the hot signer, provider signer, API host, or
   operator browser.
5. Record the finalized signature and run treasury reconciliation immediately.
   The append-only ledger and prior snapshot must not be edited to conceal the
   balance movement; an expected discrepancy remains visible until reviewed
   and resolved through the normal accounting process.
6. Keep House paused if the observation is stale, the amount or destination
   differs, liquidity is below its floor, or any discrepancy remains open.

### Reconciliation and resume gate

The scheduled reconciliation worker is the normal recovery path.
`GET|POST /v1/internal/reconciliation/treasury` requires the worker key and
verifies a finalized slot before updating the latest observation. A manual run
uses the same endpoint and the same worker credential; the operator dashboard
deliberately offers no "reconcile now" or corrective action.

Reconciliation is append-only and slot-bound:

- an older finalized observation cannot replace a newer recorded slot;
- expected ledger movement and observed Solana balance remain distinct values;
- custody or balance mismatches create durable discrepancies rather than
  rewriting inventory, snapshots, or ledger entries;
- already-funded sessions continue toward settlement, refund, or recovery while
  new exposure is paused.

After an emergency pause, signer rotation, authority rotation, or withdrawal,
resume House admission only when all of the following are true:

- the API and database are healthy and the network is verified as
  `solana-devnet`;
- the finalized treasury snapshot is fresh and its slot is not older than the
  recorded slot;
- owner, mint, delegate, delegated allowance, wallet, and configured public
  addresses match the approved record;
- separation of duties is true and configuration errors are empty;
- unresolved treasury and inventory discrepancies are zero;
- available liquidity exceeds the configured floor after all reservations,
  daily-loss exposure, and total exposure are included;
- each intended tier reports enabled, or its disabled reason and deterministic
  re-enable boundary are accepted in the incident record.

Every submitted transaction receives an opportunistic finality check. Either
authenticated participant can continue the duel-scoped check at
`POST /v1/duels/{duelId}/transactions/reconciliation`, and the product polls
that endpoint while a known transaction remains active. The global transaction
worker is a once-daily recovery net driven by the `dailydraft-reconcile-solana`
systemd timer on the API host, and can also be invoked manually at
`POST /v1/internal/reconciliation/solana`. Both paths treat `confirmed` as
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
deposits remain operator-proof only. The global reconciliation worker decodes
the finalized Duel v4 account for `DAILYDRAFT_DEVNET` duels in `refunding`,
uses the isolated provider signer only as the permissionless fee payer, and
submits refunds only for custody flags still held on-chain. Each finalized
refund records its public signature and asset proof. The database reaches
`refunded` only after the on-chain account is refunded, every custody flag is
clear, and every required refund intent is finalized. A result commitment or
settled on-chain account routes the duel back to settlement recovery instead of
attempting a refund.
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
  -H "Authorization: Bearer $DAILYDRAFT_OPERATOR_KEY" \
  -H "Content-Type: application/json" \
  --data '{"paused":true,"reasonCode":"provider_degraded"}'
```

Confirm the returned `paused` state, then inspect `/admin/audit`, `/admin/risk`,
`/admin/readiness`, `/admin/treasury`, and `/admin/duels?attention=all`. Pausing
blocks new matches and funding preparation but deliberately lets already-funded
house sessions continue through opening, reconciliation, refunds, and settlement.
The treasury summary reports each affected tier's stable disable reason and
re-enable boundary. Do not rotate authorities, withdraw, edit policy, delete
ledger evidence, or submit a second payment as an incident shortcut. Use the
role-specific procedure above, run reconciliation, and satisfy every resume
gate before the incident owner sends the same endpoint with `paused:false`.

## Release order

1. Merge green escrow CI and publish the reviewed program ID.
2. Fund the isolated devnet deployment authority from a faucet. Never change
   the machine-wide Solana RPC configuration to accomplish this.
3. Deploy the escrow using explicit devnet RPC and keypair arguments.
4. Deploy the API; the workflow applies the committed migrations itself.
5. Configure the product app variables and deploy `apps/app` to Vercel.
   Before exposing `/v1/analytics/events`, enable Vercel Firewall/IP rate
   limiting. Its anonymous-session cap is defense-in-depth and session churn
   can bypass it.
6. Run the `Devnet smoke` GitHub workflow with the final API URL.
7. Exercise direct challenge, public queue, disclosed house, cancellation,
   refund, reveal, settlement, social card, and rematch states with valueless
   test assets.

## API deployment from the monorepo

The API deploys through the `Deploy API production` GitHub workflow. It builds
`apps/api/Dockerfile` from the monorepo root so Bun workspaces and `packages/db`
resolve together, uploads the image and `deploy/dailydraft/deploy-dailydraft.sh`
to S3, then runs that script on the API instance through Systems Manager. There
is no operator-side deploy command and no credential ever leaves SSM.

1. Configure API variables as SSM parameters under `/dailydraft/api/prod/`, one
   parameter per environment key. Do not put credentials in tracked files.
   Secrets—`DATABASE_URL`, `CRON_SECRET`, `DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON`,
   `DAILYDRAFT_API_KEYS`—must be `SecureString`. The host script reads the path
   with decryption at deploy time and writes a `0600` env file the container
   never outlives.
2. Merge to `main`. Pushes touching `apps/api/**`, `packages/db/**`,
   `deploy/dailydraft/**`, or the lockfile deploy automatically; otherwise
   dispatch the workflow by hand. Runs are serialized and never cancelled in
   flight, because a half-applied deploy can leave the host with no container.
3. The host script applies committed migrations before anything is swapped:

   ```bash
   bun --filter @dailydraft/db db:deploy
   ```

   Never substitute `prisma db push`; migration history is the deployment
   contract. A failed migration aborts the deploy with the previous container
   still serving. The new image is then started as `api-dailydraft-fun-candidate` and
   only renamed over the live container after its own health check passes, so a
   broken build cannot take production down.
4. Confirm the canonical host and database readiness:

   ```bash
   curl --fail-with-body https://api.dailydraft.fun/v1/health
   ```

The API fails closed during bootstrap when `DATABASE_URL` is missing. Its health
endpoint returns `503` when PostgreSQL is unavailable or migrations are pending.
The image build generates Prisma Client but never mutates the database.

## Promotion gate

For `dailydraft-devnet`, provider escrow orchestration creates valueless SPL
demo cards and signs their deposit, result, and settlement transactions with an
isolated keypair stored only as an SSM `SecureString`. The key must never appear
in API responses, browser bundles, MCP output, logs, or issues.
The visible name, image, and comparison value are persisted from the Pokémon TCG
API before funding proof is resolved. The committed demo policy fixes the TCGPlayer
market variant order and conversion rule; every outcome hash binds the selected
card, variant, field, and upstream update timestamp. It must never be described
as Collector Crypt insured value.

Collector Crypt mode remains separately fail-closed until it confirms the
canonical mint, authoritative integer insured value and valuation policy,
stable provider references, alternate-recipient custody, and provider request
IDs. The DailyDraft demo path is not evidence that Collector Crypt supports it.

Result and settlement preparation read finalized devnet accounts and require a
legacy SPL mint with decimals `0`, supply `1`, and exactly one matching NFT in
each role PDA vault. Mock outcomes remain valid for UI reveal testing but are
categorically rejected from real escrow preparation.

Devnet readiness does not imply mainnet readiness. Mainnet remains blocked on
Collector Crypt approval, supported recipient and asset standards, canonical
valuation proof, legal/compliance sign-off, production persistence, independent
escrow audit, governed upgrade authority, and incident controls.
