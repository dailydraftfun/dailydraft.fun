# DailyDraft API

NestJS 11 API implementing the devnet contract in `apps/docs/openapi.yaml`.

The devnet foundation provides health, pack discovery, durable PostgreSQL-backed
duel intents, direct invitations, open matchmaking, disclosed house opponents,
auditable state events, transaction reconciliation records, deterministic timeout
cancellation, and social-card metadata. Transaction preparation returns
`501 Not Implemented` until the Solana escrow integration constructs verifiable
unsigned transactions.

Submitted escrow signatures are bound idempotently to a previously prepared
intent and receive one opportunistic finality check in the submission request.
Either authenticated duel participant can continue the bounded check at
`POST /v1/duels/{duelId}/transactions/reconciliation`; the browser polls this
route while a known transaction remains active. The server validates the RPC
cluster genesis hash, follows `confirmed` progress, requires `finalized` before
advancing a duel, and re-verifies the transaction signature, recent blockhash,
signer, and one uniquely matching target instruction. That instruction must
match the escrow program, encoded-data hash, and exact ordered account signer/write
constraints recorded by the prepared intent. An on-host cron.d timer calls
`GET /v1/internal/reconciliation/solana` daily at 03:00 UTC with `CRON_SECRET`;
operators can run the same global batch with `POST` and either the cron secret
or an integration key. Normal finality does not wait for that recovery pass.

An authenticated signer can explicitly record a wallet rejection at
`POST /v1/duels/{duelId}/transactions/{transactionId}/rejections` only when the
wallet confirms that no signature or broadcast occurred. The exact prepared
funding intent is expired idempotently so a fresh intent can be prepared
immediately. Ambiguous wallet, RPC, and transport failures remain on the
reconciliation path and never use this endpoint.

Funding reconciliation follows Duel v4's two-sided fee-deposit protocol. A
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

Before any provider request, the opening orchestrator commits one immutable
operation per duel side with the exact provider pack, escrow recipient, and
stable generate/open idempotency keys. An ambiguous request enters
`RECOVERY_REQUIRED`; retries poll the committed provider reference first and
reuse the same keys rather than issuing a second logical open. Reveal readiness
is emitted only after both card identifiers, normalized result hashes, bounded
raw response payloads, and provider-verified signatures are durable.

The deterministic mock response signature is fixture-only and remains restricted
to devnet tests and previews. The DailyDraft devnet provider signs the same
evidence envelope with its server-only provider key. Collector Crypt operations
remain fail-closed until the partner contract, credentials, alternate-recipient
behavior, and response-signature verification are approved; this evidence
contract does not promote or enable that integration.

## Local development

```bash
cp .env.example .env
bun --filter @dailydraft/db db:deploy
bun run dev
```

The local API listens on `http://localhost:3003/v1`; the production container
listens on port 3000. Browser players authenticate by
signing a five-minute, domain/URI/chain-bound Wallet Standard message. The API
stores the nonce in PostgreSQL, consumes it once, and returns a 15-minute opaque
session whose SHA-256 hash is the only token material persisted server-side.
That wallet session can create, join, or cancel only for its own address.

Server integrations can still use a bearer key listed in
`DAILYDRAFT_API_KEYS`. Integration keys retain access to operator event and
transaction routes and must never be shipped to browser code.

`DATABASE_URL` is mandatory. The hosted demo uses
`DAILYDRAFT_PROVIDER_MODE=dailydraft-devnet`; every duel is explicitly labeled
`solana-devnet`, and the API is not mainnet-ready. `mock` remains limited to tests
and local previews.

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

The queue fails closed until `DAILYDRAFT_MATCHMAKING_REGION_SEGMENT` and
`DAILYDRAFT_MATCHMAKING_RISK_SEGMENT` are provided by an upstream verified policy;
the API does not infer geolocation from user input. House fallback is a separate,
explicit endpoint, includes disclosure in the session response, and remains disabled
by default through `DAILYDRAFT_HOUSE_ENABLED=false`. It is never an automatic queue
conversion. Wallet-level limits do not prevent coordinated multi-wallet abuse, which
still requires upstream identity/risk controls before mainnet.

## Real-value policy admission

Every authenticated HTTP boundary that can create exposure records an immutable
`RealValuePolicyDecision` before the operation runs. The guarded capabilities are
direct, open, and House duel creation; direct join; public matchmaking and House
fallback; funding preparation; pack opening; and provider escrow preparation.
Cancellation, wallet rejection, settlement/refund recovery, and reconciliation
remain outside the admission gate so a policy denial cannot trap existing funds.

Fixture and Solana devnet operations use the hash-pinned
`dailydraft.non-production-policy.v1` contract. They remain testable while every
decision explicitly records `productionEnabled: false` and retains no production
approval evidence. A malformed policy document still fails closed even in
non-production, preventing a broken deployment from being mistaken for approval.

Real-value mode is deny-by-default. Production admission requires all three:

- `DAILYDRAFT_REAL_VALUE_MODE=true`
- `DAILYDRAFT_REAL_VALUE_PRODUCTION_ENABLED=true`
- a strict `DAILYDRAFT_REAL_VALUE_POLICY_JSON` document using schema
  `dailydraft.real-value-policy.v1`

The document binds one policy version, explicit capabilities, and stable evidence
references for legal, jurisdiction, age, limits, sanctions, disclosure, and
production approval. Missing or malformed inputs return
`REAL_VALUE_POLICY_DENIED` with a stable machine-readable reason. The exact
canonical document hash and evidence are retained for each attempt; the database
rejects updates or deletes to those records. No legal decision, jurisdiction,
threshold, vendor, credential, or production approval is committed in this
repository.

## Privacy-safe observability

`POST /v1/analytics/events` accepts only allowlisted names and bounded
duel/status/tier/mode fields under a random per-tab `anon_*` session. The schema
has no wallet, signature, bearer-token, private-key, metadata, or free-form error
field. The public allowlist contains UI intent only; lifecycle transitions and
operational failures are recorded server-side. Payloads are capped at 20 events
and each anonymous session is capped at 120 events per five minutes. Those caps
are defense-in-depth, not abuse resistance: session churn bypasses them. A public
production deployment must configure upstream or host-level IP rate limiting
while the API continues not to persist network identifiers.

`GET /v1/analytics/funnel` requires an integration key and returns only
aggregates: funnel conversion, match/provider latency percentiles, abandonment,
refund and settlement-failure rates, provider/RPC error totals, duel-status
counts, and the stuck-funded alert configured by
`DAILYDRAFT_STUCK_FUNDED_MINUTES`.
Canonical funnel transitions and operational alerts use `SERVER` rows only;
client UI errors are reported separately under `experience`.

## Admin and emergency controls

All `/v1/admin/*` routes require an integration key and return `no-store`
responses. Operators can paginate stuck/failed duels, inspect complete duel,
transaction, provider, valuation, and custody timelines, view risk/configuration
readiness, and pause or resume new exposure. The pause blocks create, join,
funding preparation, direct-duel pack opening, and house entry while reads,
cancellation, refund/settlement recovery, reconciliation, and already-funded
house progression remain available.

Pause changes append an immutable database audit record containing only the
fixed `integration-key` actor class and a bounded reason code; raw API keys are
never persisted. Configure allowed tiers, wallet exposure, tier concurrency,
and house availability with the `DAILYDRAFT_ALLOWED_TIERS`,
`DAILYDRAFT_MAX_ACTIVE_DUELS_PER_WALLET`,
`DAILYDRAFT_MAX_CONCURRENT_DUELS_PER_TIER`, and
`DAILYDRAFT_HOUSE_ENABLED` environment variables. Conservative defaults are
`50`, `3`, `20`, and `false` respectively.

House mode has a second, stricter treasury gate. A serializable, advisory-locked
reservation must exist before either participant can prepare funding. Reservations
use integer micro-USDC only and require a recent finalized devnet token-account
snapshot, per-player and per-tier concurrency headroom, total-exposure headroom,
daily-loss headroom including unresolved worst-case exposure, and the configured
liquidity floor. Missing configuration disables the tier. The finalized USDC token
account must be owned by the separate cold withdrawal authority and delegate only a
bounded amount to the hot funding signer. The delegate allowance may not exceed the
configured total-exposure ceiling. House entry remains off unless
`DAILYDRAFT_HOUSE_ENABLED` is explicitly `true`.

Shared treasury and tier-limit failures persist the affected tier's stable reason and
deterministic re-enable boundary. A later successful reservation clears that state;
wallet-specific exposure failures never disable an otherwise healthy tier. Emergency
pause is rechecked under the reservation lock, so no new house match can race past an
operator pause. Already-funded house duels may still open, settle, refund, and reconcile;
the pause continues to block new matches and funding preparation.

`GET /v1/admin/treasury` exposes secret-free liquidity, exposure, loss, inventory,
and concentration summaries. Inventory disposition is an operator-recorded workflow;
the API does not call undocumented buyback or marketplace endpoints. The treasury
reconciler verifies the finalized devnet USDC token account and canonical legacy-SPL
inventory custody, while lifecycle reconciliation keeps already-funded sessions on
their refund or settlement path even during an emergency pause.
House-won inventory is single-writer by canonical asset reference and retains its
immutable source duel and outcome. Acquisition basis and insured, listing, buyback,
and displayed valuations are separate fields; unavailable quotes remain `null` and
are never substituted from another valuation source.
The DailyDraft devnet provider creates actual zero-decimal, single-supply legacy
SPL mints, revokes both authorities, and atomically deposits each demo card into
the canonical Duel v4 vault. A signed, replay-safe reference binds the duel,
side, and pack; the immutable database snapshot and result hash bind the selected
Pokémon TCG card, displayed market value, image, and deterministic mint. The provider keypair
is a sensitive server-only SSM SecureString and must match `ESCROW_PROVIDER_SIGNER`.
After both deposits, the API signs and monitors result commitment and settlement
transactions until finalized. These are valueless DailyDraft demo collectibles,
not Collector Crypt inventory.

The deterministic `mock` provider still refuses to run outside devnet, but it
never enters real settlement and must not be selected by the hosted demo.
All new duels snapshot the valuation policy for their provider before funding.
The hosted demo uses `dailydraft-pokemon-tcg-market-usdc-v1` and a persisted
Pokémon TCG `tcgplayer.prices.market` snapshot. The disabled Collector Crypt adapter
uses `collector-crypt-insured-value-usdc-v1`. Provider outcomes must match the
pre-funded SHA-256, use integer micro-USDC comparison values, share one pool version, and carry the
policy-specific authoritative source timestamp. Demo results bind the exact card,
selected price variant, value field, and upstream update timestamp. Equal values follow the normal result
commitment and settlement path, which returns each original card and refunds both
platform fees immediately without waiting for expiry or entering recovery.
Settlement atomically closes the emptied payment and card vaults after routing
both demo assets and the fee. Recorded result inputs are immutable; provider corrections require a dispute or
refund and never rewrite the winner. See the public valuation/proof guide and
`GET /v1/valuation-policies/current`.

The public duel receipt also projects partner-independent card action state after
an exact finalized settlement reference reconciles ownership. Each card is
independent, including both cards awarded to one winner. `keep` is an ownership
receipt only and creates no transaction. Marketplace listing, insured buyback,
and physical redemption remain explicitly unavailable and return `keep` as the
safe alternative; the API never fabricates a partner transaction. Mock results,
pending settlement, and winner/ownership mismatches return no card actions.
Collector Crypt authentication, marketplace builders, live buyback eligibility,
shipping fees, USDC payment, NFT burn, and shipment tracking remain open gates in
[issue #24](https://github.com/dailydraftfun/dailydraft.fun/issues/24).

Flip inventory preparation is a separate, immutable market-evidence path; it
does not write to the house inventory ledger or acquire assets. Each snapshot
stores every provider candidate in canonical listing order, including excluded
candidates and typed reasons, while keeping listing, insured, buyback, and
displayed values independent. Price-band and exposure eligibility use only the
explicit listing value and never substitute another value type. Exact replays
reuse the content-addressed revision; corrected provider evidence creates a new
sealed, append-only revision.

The snapshot service accepts provider fixtures only and has no HTTP controller
or live marketplace client. It also requires
`DAILYDRAFT_FLIP_FIXTURE_MODE=true` in tests, local development, or an
explicit non-production preview. Production remains fail-closed until the separate
reviewed rules, acquisition, legal, and promotion gates are complete.

`SOLANA_RPC_URL` defaults server-side to `https://api.devnet.solana.com`; every
worker validates the official devnet genesis hash before reading transaction
state. Funding preparation additionally requires `ESCROW_PROGRAM_ID`,
`ESCROW_PROVIDER_SIGNER`, `ESCROW_FEE_RECIPIENT`, and
`DAILYDRAFT_DEVNET_FEE_LAMPORTS`; it fails closed if any value is missing or invalid. Store a long
random `CRON_SECRET` in SSM under `/dailydraft/api/prod/CRON_SECRET`.

`collector-crypt-sandbox` is a fail-closed adapter stub: no undocumented HTTP
paths or response shapes are assumed. It remains unavailable until Collector
Crypt confirms partner authentication, sandbox access, pack identifiers,
generate/open/status schemas, idempotency, alternate-recipient custody, the
canonical insured-value field, and buyback eligibility. Any future provider
credential is server-only and must never use a `NEXT_PUBLIC_` variable.

The integration-only provider escrow preparation endpoint builds unsigned card
deposit, result commitment, settlement, and per-asset expiry-refund transactions.
It never signs or submits. Real-asset preparation remains disabled unless the
persisted outcomes are non-mock Collector Crypt or DailyDraft devnet evidence with canonical Solana
mint addresses, integer USDC insured values, one valuation policy, and
`DAILYDRAFT_PROVIDER_ASSET_STANDARD=legacy-spl-nft`. Finalized RPC reads must
also prove a zero-decimal/single-supply legacy mint and the exact card in each
escrow PDA vault before result or settlement preparation.

## Crash fixture calculators

Crash pot and bust calculations are pure, versioned contracts under
`src/crash/crash-calculators.ts`. They accept no default economics: callers must
supply a hash-committed `fixture-only` rule set with contiguous stages,
nondecreasing pot/risk limits, integer micro-USDC values, and an integer PPM bust
roll. Pot growth uses explicit floor rounding and returns the exact remainder;
both calculators return SHA-256 proof hashes over every result input.
This is deliberately a generic fixture interpreter rather than an allowlist of
approved economics. Any downstream fixture session must bind and persist both
`rulesVersion` and `rulesHash`; a version alone is not an approval boundary.

The contract rejects missing, malformed, live-activation, version-incompatible,
non-monotonic, hash-mismatched, out-of-range, and over-limit inputs. It has no
persistence, provider, wallet, entropy, clock, transaction, or production
activation path. Live Crash economics and custody remain disabled until their
separate HITL approval and promotion gate is complete.

## Crash fixture stage state

`src/crash/crash-stage-state.ts` is the durable fixture interpreter layered on
the pure calculators. Each `CrashRound` is bound to immutable architecture,
state-machine, calculator, and economic-rule references. Its append-only
`CrashTransition` ledger records the optimistic round version as its sequence,
plus every accepted decision, deadline, fixture payment, provider and custody
outcome, pot change, settlement receipt, and terminal reason. A service restart
resumes exclusively from those rows; no process-memory checkpoint is part of
the contract.

Every mutating decision carries a transition key and a hash of its complete
fixture evidence. Exact retries replay the durable result, changed retries are
rejected, and a stage/version compare-and-swap permits only one concurrent
transition. Expired stages apply their pre-disclosed synthetic `forfeit`
default once, with a deterministic zero-payout fixture receipt.

The authenticated player contract exposes `GET /v1/crash/rounds/:roundId` for a
canonical reconnect snapshot and `POST /v1/crash/rounds/:roundId/decisions` for
`continue` or `cash-out`. Decision writes require a 16–128 character
`Idempotency-Key` and the current `expectedStage` plus `expectedVersion`.
Responses disclose the current deadline, `forfeit` default, pot, and available
actions without exposing fixture wallet references or internal evidence.
Server-owned, deterministic provider/custody/payment/settlement fixtures keep
clients from supplying outcome evidence.

Both routes remain fail-closed unless `DAILYDRAFT_CRASH_FIXTURE_MODE=true` is
set in test, local development, or a non-production Vercel preview.
`DAILYDRAFT_CRASH_FIXTURE_RULES_JSON` must contain the complete hash-committed
`fixture-only` state and calculator rules already bound to the round.
Production Vercel explicitly rejects fixture mode, and the product capability
continues to report `playable: false`. Live architecture, economics, custody,
provider integration, and promotion remain separate HITL gates.

## AWS production runtime

The API runs as the long-lived `api-dailydraft-fun` Docker container on the shared
network attached to `shipshit-caddy`. Caddy terminates TLS and proxies the API
hostname to `api-dailydraft-fun:3000`. GitHub Actions builds the root-context image,
uploads an immutable archive to S3, and invokes
`/usr/local/bin/deploy-dailydraft` through AWS Systems Manager.

The host loads encrypted application values from
`/dailydraft/api/prod/`, applies committed Prisma migrations with
`DATABASE_URL`, starts a candidate, and cuts Caddy over only after
`GET /v1/health` reports database readiness. The 03:00 UTC Solana and 04:00 UTC
treasury recovery passes are cron.d timers on the same host.

Set `DAILYDRAFT_APP_URL` to the canonical HTTPS app origin and
`DAILYDRAFT_AUTH_DOMAIN` to its matching host. Only localhost may use HTTP.
The localhost URL fallback is available only when `NODE_ENV=development`; deployed
environments fail with `503 Service Unavailable` when the canonical app URL is missing or invalid.
Every signed message is hard-bound to `solana:devnet`; there is no mainnet
configuration switch.
