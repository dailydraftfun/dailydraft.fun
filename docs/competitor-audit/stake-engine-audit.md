# Stake Engine competitive audit and RGS design memo

Captured 2026-07-26 from Stake Engine's public developer documentation and
GitHub organization (no operator account, no game submission, no funded play).
Primary sources are cited inline per section; anything that could not be
independently confirmed is marked **unverified**.

## Scope

This is a developer-platform teardown of Stake Engine — Stake.com's toolkit
and publishing pipeline for third-party slot/casino game studios — plus a gap
map against DailyDraft's existing Gacha, Duels, and valuation/commitment-hash
stack, a draft RGS (Remote Gaming Server) contract sketch, an explicit wedge
thesis, and an implementation-sizing memo. It follows the format of
[`collectorroll-audit.md`](./collectorroll-audit.md) in this directory:
component-by-component health notes, then a synthesis section, then explicit
evidence limits.

The user goal is to understand what a credible, developer-facing RGS looks
like — math config format, RGS API surface, fairness scheme, publishing
economics — then decide what DailyDraft's own RGS contract (issues #219, #220)
should copy, improve on, or deliberately not build.

## Component 1 — Math SDK (game math authoring)

**Health: mature, narrowly scoped to reel/paytable slot math.**

- Python-based (Python ≥ 3.12, optional Rust/Cargo for the bundled
  optimization algorithm). Developers define reels, paytables, lines/ways,
  cluster/tumble mechanics, and features in a declarative config, then run
  large-scale simulation to produce a lookup table.
- Each simulated round is one row in a CSV: simulation number, selection
  probability, payout amount. The published game's actual RTP is *exactly*
  computable from this table at publish time — this is compute-then-tabulate,
  not the compute-per-round math a live-dealer or provably-fair-seed system
  uses.
- Docs recommend 100k+ simulations per mode before a config is
  production-ready, and describe an optimization pass that reshapes the
  payout distribution toward a target RTP/volatility profile before the table
  is frozen.
- At round time, "the RGS will consult the CSV/lookup table to select a
  simulation number, then return a JSON response from the game-logic file"
  ([Math-SDK overview](https://stakeengine.github.io/math-sdk/math_home/),
  accessed 2026-07-26). The runtime game outcome is therefore a table lookup
  against a pre-baked, pre-optimized distribution — the "randomness" is which
  row of the table a round lands on, not a fresh probability calculation.
- Scoped entirely to reel-based slot math (lines, ways, scatter, cluster,
  tumble). No documented support for asset-backed, inventory-depleting, or
  physical-collectible-linked outcome models — Gacha-style "pull from a
  finite, real-world-backed pool" is outside what this SDK was designed for.

Sources: [Math-SDK docs home](https://stakeengine.github.io/math-sdk/math_home/),
[Math-SDK GitHub](https://github.com/StakeEngine/math-sdk),
[Quickstart guide](https://stakeengine.github.io/math-sdk/math_docs/quickstart/)
(all accessed 2026-07-26).

## Component 2 — Web SDK (frontend rendering)

**Health: solid, opinionated, single-stack.**

- PixiJS 8 + Svelte 5, built as a Turborepo monorepo of local packages:
  `pixi-svelte` (Pixi/Svelte primitives, publishes to npm), `components-pixi`
  (reusable slot-game components), `utils-layout` (Pixi layout helpers).
- Declarative: developers compose scenes/animations from the math SDK's
  emitted "events" rather than hand-writing a render loop per game.
- Purpose-built for reel/symbol slot presentation (spins, wilds, cascades,
  free-spin transitions) — there is no documented pack-opening, card-reveal,
  or duel-versus-duel presentation primitive, because Stake Engine has no such
  game category.

Sources: [Frontend-SDK docs](https://stakeengine.github.io/math-sdk/fe_home/),
[web-sdk GitHub](https://github.com/StakeEngine/web-sdk),
[Frontend-SDK dependencies](https://stakeengine.github.io/math-sdk/fe_docs/dependencies/)
(accessed 2026-07-26).

## Component 3 — RGS API surface

**Health: functional wallet/session contract; no fairness surface.**

- Auth/session: `/wallet/authenticate` validates a `sessionID` with the
  operator and must be called before any other wallet endpoint; the response
  carries balance, bet-limit, and jurisdiction configuration. The RGS tracks
  "a currently active or the last completed round" per session, which is how
  a disconnected client resumes.
- Wallet endpoints: `/wallet/balance`, `/wallet/end-round` (finalizes the
  round and pays out).
- Gameplay endpoints: a play/bet request (debits stake, returns round state)
  and `/bet/event` (logs in-progress actions so a round can be resumed after
  disconnect).
- Monetary values are integers at 6 decimal places (`"1000000"` == $1) — the
  same minor-unit convention DailyDraft already uses for USDC amounts.
- Bet validation is `minBet ≤ amount ≤ maxBet`, divisible by `stepBet`.
- Documented error codes: `ERR_VAL` (invalid request), `ERR_IPB`
  (insufficient balance), `ERR_IS` (invalid/expired session), `ERR_GLE`
  (gambling-limit exceeded), `ERR_GEN` (general server failure),
  `ERR_MAINTENANCE`.
- **Notable gap:** nothing in the RGS technical-details page, the math SDK
  docs, or the frontend SDK docs describes a fairness proof, seed-commitment,
  RNG-verification, or cryptographic-attestation endpoint. The full published
  documentation tree (Math-SDK, Frontend-SDK, RGS technical details, RGS
  connection example) has no page on fairness, RNG seeding, certification, or
  compliance — the entire fairness question is out of scope for the
  developer-facing contract.

Sources: [RGS technical details](https://stakeengine.github.io/math-sdk/rgs_docs/RGS/),
[RGS connection example](https://stakeengine.github.io/math-sdk/simple_example/simple_example/),
[Stake Development Kits home / doc tree](https://stakeengine.github.io/math-sdk/)
(accessed 2026-07-26).

## Component 4 — Provable fairness

**Health: absent from the third-party developer contract; present, but
unconfirmed for Engine games, on the player-facing side.**

- Stake.com's own **Originals** (Dice, Limbo, Roulette, Mines, Plinko, Keno,
  Crash) use a documented, standard provably-fair scheme: a server seed is
  generated and its SHA-256 hash shown before play; a client seed and a
  per-bet incrementing nonce are combined with the server seed through
  HMAC-SHA256 to derive outcome bytes; the server seed is revealed (and
  therefore verifiable) only after the player rotates it. This is
  Stake-hosted, off-chain, and specific to the Originals catalog.
  ([Provably Fair Implementation](https://stake.com/provably-fair/implementation),
  [Provable Fairness — Help Center](https://help.stake.us/en/articles/7891166-provable-fairness),
  accessed 2026-07-26.)
- Whether third-party Stake Engine games get the same seed-reveal treatment
  is **unverified**. A third-party verification tool
  (`stakestats.net/stake/tools/stake-engine/verify`) references
  "Stake Engine" verification by server seed / client seed / nonce, but its
  page does not state whether this covers all Engine-published games,
  whether it is contractually guaranteed to studios, or whether it is
  server-side-only (it does not describe any on-chain component). Treat this
  as player-facing tooling of unknown coverage, not a documented developer
  contract.
- What is confirmed: the **developer-facing** RGS/Math-SDK/Frontend-SDK
  documentation tree that a studio actually builds against contains zero
  fairness, seed, or verification API. A studio publishing on Stake Engine
  has no documented obligation or mechanism to emit a fairness proof; if
  Stake wraps Engine rounds in the Originals-style seed scheme, that is a
  platform-side behavior invisible to (and unspecified for) the developer.
- No on-chain anchoring of any kind — seed hashes, reveals, and RTP tables
  all live in Stake's own systems.

## Component 5 — Publishing model and revenue economics

**Health: aggressive, developer-friendly terms; compliance detail is thin.**

- Flat **10% of gross gaming revenue (GGR)**, paid monthly, described as a
  perpetual royalty with "no hidden fees," no minimum guarantee, and no
  exclusivity lock — positioned as more generous than typical iGaming
  aggregator/platform deals.
- Distribution reach: publishing to Stake's stated **36 million+ registered
  users**; Stake Engine games are reported to have generated **$3.31 billion
  in turnover** over the trailing 12 months at time of the announcement.
- Target developers: explicitly "math developers and indie teams through to
  full-stack studios" — i.e., the pitch is lowering the barrier from
  traditional B2B iGaming supplier relationships (studio ↔ aggregator ↔
  operator, months of BD and integration) to a self-serve SDK-to-published
  pipeline.
- Named studios already distributing through it: Twist Gaming, Titan Gaming,
  Mirror Image Gaming, Paperclip Gaming, Massive Studios, and others
  (per Stake's announcement, republished by NEXT.io/iGaming Today).
- Publishing/review: games are submitted for a "final build review"; turnaround
  is claimed to sometimes be as fast as 24 hours, materially faster than
  traditional supplier certification timelines. Exact review criteria are not
  published.
- **Certification/compliance is the thinnest part of the public record.**
  No independent testing lab (GLI, iTech Labs, BMM, eCOGRA) is named anywhere
  in Stake's own Engine materials as certifying Engine-built games; coverage
  describes games as "audited, integrated, and monitored by the Stake
  platform" itself, with developers responsible for meeting "the technical
  and regulatory requirements of the operator" — i.e., Stake is both the
  platform and the auditor for its own Engine catalog, and no named
  jurisdiction, license, or third-party lab is disclosed for Engine titles
  specifically. This is a materially weaker independent-assurance story than
  the licensed-market norm (UKGC/MGA-class markets require GLI/BMM/iTech Labs
  certification; Stake itself operates offshore, primarily Curaçao-licensed
  for its casino business — **unverified** whether that license extends any
  formal RNG certification requirement onto Engine-built games specifically).

Sources: [Stake unveils Stake Engine — NEXT.io](https://next.io/news/b2b-news/stake-unveils-new-stake-engine-build-launch-earn-the-engine-is-yours/),
[Stake Engine: A Revolutionary Platform — SlotsLaunch](https://slotslaunch.com/blog/stake-engine),
[Stake Engine — Gambling Insider](https://www.gamblinginsider.com/news/29242/stake-introduces-stake-engine-for-game-developers)
(accessed 2026-07-26; `stake.com/blog/what-is-stake-engine` returned HTTP 403
to automated fetch and could not be read directly — the figures above are
corroborated across three independent republications of the same
announcement, but the primary post itself is unverified firsthand).

## Gap map — DailyDraft stack versus a full RGS

| RGS requirement | Stake Engine has it | DailyDraft today | Gap |
| --- | --- | --- | --- |
| Versioned math config format | Yes — Math-SDK config → CSV lookup table | Partial — `gacha-pull-odds.ts` defines a versioned, hashed rule set (`GACHA_PULL_ODDS_SCHEMA_VERSION`, banded probabilities in PPM, `rulesHash`) but only for one game (Sports Pack Gacha); Duels has no equivalent math-config abstraction, it computes `compareInsuredValues` directly against two provider results | Need a shared math-config schema that Duels, Gacha, and future modes (Flip, Crash) all register against, not a one-off per mode |
| Simulation / RTP tooling | Yes — 100k+ round simulation, optimization pass, CSV report | None | This is exactly issue #220's scope: no simulation harness exists today for any DailyDraft game math |
| RNG/outcome commitment | No documented scheme (table lookup only) | Yes, and stronger — `GachaRipService.createSeedCommitment` commits a server seed (SHA-256 hash) before play, `selectGachaOutcome` derives the outcome from `sha256(snapshotContentHash:rulesHash:serverSeed:clientSeed)`, and the seed is only revealed after settlement | DailyDraft already has a real commit-reveal scheme where Stake Engine has none for third-party games |
| Session/round lifecycle | Yes — authenticate → play → bet/event → end-round | Yes, independently per mode — Duels: `funded → opening → awaiting_assets/settling → settled`; Gacha rip: `SELECTED → REVEALED → ACQUIRED → SETTLED/FAILED`, both enforced via optimistic `updateMany` status-guarded transitions | Two incompatible state machines for the same conceptual round lifecycle; needs one versioned RGS lifecycle both flow through (this is issue #219) |
| Idempotency | Unverified in public docs | Yes, pervasively — idempotency keys on duel creation, opening (`{key}:opening`), settlement (`{key}:results`), and Gacha rip creation, all backed by unique-constraint-guarded writes | Already ahead |
| Fail-closed capability gating | Not documented | Yes — `resolveGachaCapability` returns `playable` only when `provider`, `odds`, `acquisition`, and `settlement` gates are all true, otherwise `preview` with a named missing-gate reason | Already ahead; this pattern should become part of the RGS contract's mode-registration surface |
| Result/settlement proof | Not documented as a developer-facing artifact | Yes — every provider result carries a `resultHash` (`sha256` over canonical asset/value/timestamp/policy fields), and duel comparisons carry their own derived `resultHash` over both sides' hashes plus context | Already ahead in depth, but currently bespoke to Duels' pack comparison — needs to become the RGS's generic "round proof" shape |
| Valuation/asset provenance | Out of scope (Stake Engine has no real-world asset link) | Yes — `valuationPolicyHash` pins a canonical valuation policy (currency, decimals, max value, staleness window) that every provider result must match, checked in `normalizeProviderResult` and re-verified in `compareInsuredValues` | This is DailyDraft's structural advantage: it has no analogue in Stake Engine because Stake Engine has no vaulted real-world assets to value |
| On-chain settlement anchoring | None | Partial — Solana escrow/transaction preparation exists in the duel flow (`packages/contracts` fixtures show `prepareDuelTransaction`, escrow addresses, devnet program ID) and devnet settlement finalization is wired (`DevnetDemoSettlementService.finalizeDuel`), but the *fairness proof itself* (seed reveal, rules hash, result hash) is not yet anchored on-chain — it lives only in Postgres | The RGS contract needs to define what proof artifact gets hashed/anchored on-chain and when (see contract sketch below) |
| Cross-mode contract surface / OpenAPI drift gate | Not applicable (closed platform) | Yes, but scoped to the wallet/duel HTTP API today — `packages/contracts` compares the live NestJS route inventory against `apps/docs/public/openapi.yaml` and pins versioned fixtures (`CONTRACT_FIXTURE_VERSION`); Gacha and an eventual generic RGS surface are not yet inside this gate | Extend the same drift-gate discipline to the new versioned RGS contract from issue #219 |

**Read of the gap map:** DailyDraft is *already* ahead of Stake Engine on the
things a closed-RNG platform structurally cannot offer (commit-reveal proofs,
asset-provenance hashing, fail-closed capability gating, idempotent
settlement) — but those primitives are duplicated per game mode instead of
expressed as one versioned contract, and there is no RTP/simulation tooling
and no on-chain anchoring of the proof artifacts yet. Issues #219 and #220
close exactly those two gaps.

## Draft RGS contract sketch: session → commit → play → reveal → settle

This is a design sketch, not an implementation. It generalizes the two
existing lifecycles (Gacha rip: `SELECTED → REVEALED → ACQUIRED → SETTLED`;
Duel opening: `funded → opening → awaiting_assets/settling → settled`) into
one versioned contract that a math config (Gacha, Duels, future Flip/Crash)
registers against, in the spirit of `packages/contracts`' existing
version-pinned fixture discipline.

```
1. session   — wallet-authenticated session, scoped to a machineKey/mode and a
               declared math-config version (mirrors gacha-capability's
               provider/odds/acquisition/settlement gates: a mode cannot open
               a session unless every gate for that config version is green).

2. commit    — server generates serverSeed, persists serverSeedHash
               (sha256(serverSeed)) and the frozen math-config hash
               (rulesHash, same shape as GachaPullOddsRuleSet today) BEFORE
               any client input is accepted. This step is already implemented
               for Gacha (createSeedCommitment) and needs to become the
               generic first step for every mode, including Duels.

3. play      — client submits clientSeed (or equivalent stake/action input)
               plus idempotencyKey. Server derives the outcome deterministically:
               outcome = f(sha256(configHash : rulesHash : serverSeed : clientSeed))
               — the exact derivation gacha-rip.service.ts already performs.
               Duels currently skips this (it delegates outcome to the pack
               provider), which is the biggest behavioral gap the RGS
               contract has to reconcile without changing game-visible
               behavior (issue #219's "no behavioral change, fixtures prove
               parity" constraint).

4. reveal    — server reveals serverSeed (now safe, since it is already
               consumed) alongside the full proof bundle:
                 { schemaVersion, configHash, rulesHash, serverSeed,
                   serverSeedHash, clientSeed, resultHash, outcomeRef }
               resultHash is the existing canonical-JSON sha256 pattern used
               by normalizeProviderResult/compareInsuredValues, generalized to
               any mode's outcome shape.

5. settle    — funds/assets move (existing devnet settlement / escrow
               finalization path), status transitions to a terminal state via
               the existing status-guarded updateMany pattern (prevents
               double-settlement under concurrent requests), and the full
               proof bundle from step 4 becomes independently verifiable:
               anyone can recompute resultHash from the revealed serverSeed,
               clientSeed, and the published configHash/rulesHash and confirm
               it matches what was settled.
```

**Fairness proof format:** a single versioned envelope
(`dailydraft.rgs-proof.v1`, matching the `dailydraft.gacha-pull-odds.v1`
naming convention already in use) containing `configHash`, `rulesHash`,
`serverSeedHash` (shown at commit time), `serverSeed` (shown only at reveal),
`clientSeed`, and `resultHash`. Verification is pure function: re-hash the
revealed inputs, compare against the published hashes — no trust in
DailyDraft's server required at verification time, which is the property
Stake Engine's documented developer contract does not offer at all.

**Where Solana anchoring fits:** anchor the proof envelope's hash (not the
raw seeds — seeds must stay off-chain until reveal, or committing them
on-chain before reveal would leak the outcome) at two points:

- At **commit**, anchor `serverSeedHash` (or a batched Merkle root of several
  concurrent commitments, to control per-round transaction cost) alongside
  the existing escrow/transaction-preparation flow already in
  `packages/contracts` (`prepareDuelTransaction`, `escrowAddress`,
  `programId`). This gives an on-chain, pre-outcome timestamp proving the
  commitment predates the reveal.
- At **settle**, anchor the final `resultHash` (or its Merkle root) as part
  of the same devnet/mainnet settlement transaction that already moves
  funds, so the proof and the payout are atomically linked on one Solana
  transaction rather than living only in Postgres. This directly closes the
  "proof lives only in Postgres" gap identified above.
- Batching via Merkle roots (commit at a cadence, not per round) keeps this
  affordable at Solana transaction-fee scale while still giving every
  individual round an on-chain-anchored, independently verifiable inclusion
  proof.

## Wedge thesis

Stake Engine's pitch to studios is speed and reach: a mature math/RTP
toolkit, a documented (if fairness-silent) RGS wallet contract, 10% GGR paid
monthly, and access to 36M+ registered users, published in as little as 24
hours. That is a genuinely strong developer-experience and distribution
offer, and DailyDraft should not pretend otherwise.

But it is a closed-RNG platform: every outcome is a lookup against a
pre-computed table inside Stake's own systems, with no documented seed
commitment, no independently verifiable fairness proof, and no named
third-party RNG certification body for Engine-built games specifically —
Stake is simultaneously the platform, the operator, and (per its own public
materials) the auditor of its own Engine catalog. Player trust rests on
"Stake says so," and even the player-facing seed/HMAC scheme that
Stake.com's own Originals ship with is not confirmed to extend to
third-party Engine titles.

DailyDraft's wedge is two things Stake Engine structurally cannot offer,
stacked together:

1. **Vaulted real-world collectibles.** DailyDraft's Gacha and Duels
   ultimately pull from and settle against real, insured trading-card
   inventory (the Collector Crypt provider integration, `valuationPolicyHash`
   pinning a canonical, staleness-checked valuation policy). A Stake Engine
   slot's "prize" is a paytable multiplier on a wagered credit; a DailyDraft
   pull or duel win is a specific, provenance-tracked physical asset with an
   insured value that both sides' outcomes are checked against before a
   winner is even declared. There is no analogue to this in Stake Engine's
   math-config model — it is not a feature gap, it is a category the
   platform was never built for.
2. **On-chain, independently verifiable outcomes.** DailyDraft already
   commits a server-seed hash before play and reveals the seed only after
   settlement (`GachaRipSeedCommitment`), already hashes every result
   (`resultHash`) over its exact canonical inputs, and already settles on
   Solana. What is missing — and what issues #219/#220 exist to build — is
   making that proof chain a first-class, versioned RGS contract with
   on-chain anchoring, so "verify this round" is a public, trustless
   function call against a Solana transaction, not a request to trust
   DailyDraft's database. Stake Engine cannot make the equivalent claim for
   any game published on it today, documented or otherwise.

The pitch to a studio choosing between the two is not "we pay a better
royalty" (DailyDraft should not try to out-bid a 10%-GGR, 36M-user platform
on raw economics yet). It is: *build a mode whose fairness is provable by
anyone, against assets that are real and insured, settled on a chain anyone
can audit* — a category Stake Engine's own developer documentation shows it
was not designed to serve.

## Implementation sizing

Slices below map directly onto the two follow-on issues so the spike
converts into shippable scope without re-litigating this memo.

### → #219 "Formalize commit-play-reveal-settle as a versioned RGS contract"

1. **Extract the shared lifecycle.** Define the versioned session/commit/
   play/reveal/settle state machine and proof envelope
   (`dailydraft.rgs-proof.v1`) described above as a package (mirrors how
   `gacha-pull-odds.ts` already versions its rule-set schema). Re-express
   Gacha's existing `SELECTED/REVEALED/ACQUIRED/SETTLED` states as the
   generic contract's states with no behavior change (existing tests as the
   parity fixtures).
2. **Re-express Duels through the same contract.** Duels' pack-opening flow
   doesn't currently have a commit/reveal step of its own (it delegates to
   the provider and only hashes the *result*); this slice has to add a
   session/commit stage in front of the existing provider call without
   changing the funded→opening→settled behavior duel clients already see.
   This is the highest-risk slice — it's the one gap where "no behavioral
   change" is a real constraint, not a formality.
3. **Register math configs, not endpoints.** Turn `GachaCapabilityGates` into
   the general per-mode readiness gate the RGS session step checks, so Flip
   and Crash (both currently roadmap-only per the CollectorRoll audit) get a
   registration path instead of bespoke controllers.
4. **Extend `packages/contracts` drift gate** to cover the new RGS routes/
   fixtures the same way it already covers the wallet/duel OpenAPI surface.
5. **Keep every real-value path behind existing HITL/fail-closed gates**
   (issue #156) — the RGS contract must not become a way to bypass those.

### → #220 "Ship odds and RTP simulation tooling for game math configs"

1. **Simulation harness** (CLI + CI-invokable) that runs a math config
   (starting with the existing `GachaPullOddsRuleSet` bands) through N
   deterministic-seed rounds and reproduces `gacha-pull-odds.ts`'s declared
   band probabilities — this is the explicit regression anchor called out in
   #220's acceptance criteria, and is checkable today against
   `createFixtureGachaPullOddsRuleSet`'s known band weights (62%/25%/10%/3%).
2. **Report format**: realized RTP/hit-rate/variance per band versus
   declared PPM values, with a tolerance band, output as a checked-in
   evidence artifact alongside the existing readiness-manifest discipline
   (#164) — same "evidence lives in the repo, not just in a dashboard"
   pattern the fixture/contract gates already use.
3. **Promotion gate**: a math config version cannot flip from
   `activation: 'fixture-only'` (the current hardcoded state in
   `gacha-pull-odds.ts`) to a live/production activation mode without a
   passing, checked-in simulation report referencing its exact `rulesHash`.
4. **Reuse for future modes**: once Flip/Crash math configs exist, this same
   tooling — not a bespoke spreadsheet — is what promotes them, which is the
   direct DailyDraft analogue of Stake Engine's "100k+ simulations before
   production" norm, but checked into CI instead of a one-time developer
   run.

Sequencing: #219 should land first (it defines the config/rules-hash shape
that #220 simulates against), but the #220 harness can be prototyped against
today's `gacha-pull-odds.ts` shape in parallel since that schema is already
stable and versioned.

## Evidence limits

- This audit used only Stake Engine's public documentation, its GitHub
  organization, and third-party republications of its own announcement; no
  operator account was created, no game was submitted, and no funded round
  was played on Stake.com or through Stake Engine.
- `stake.com/blog/what-is-stake-engine` — the primary announcement — returned
  HTTP 403 to automated fetch and was not read directly. Every revenue/reach
  figure in this memo is corroborated across at least two independent
  republications (NEXT.io, SlotsLaunch, Gambling Insider, ReadWrite), but
  none of them are Stake's own primary text, and exact contract terms
  (minimum term, termination, IP ownership of published game math) were not
  found in any public source and are **unverified**.
- Whether Stake Engine third-party games share Stake Originals' documented
  seed/HMAC provably-fair scheme is **unverified** — the one third-party
  verification tool referencing "Stake Engine" gave no coverage detail, and
  the developer-facing RGS/Math-SDK/Frontend-SDK documentation tree contains
  no fairness page at all. This memo treats the documented developer
  contract (silent on fairness) as authoritative for the wedge thesis, since
  that is what a competing studio actually builds against.
- Licensing/regulatory posture (which jurisdiction's license, if any, imposes
  RNG-certification requirements on Engine-built games specifically) could
  not be confirmed from public sources and is **unverified**.
- The DailyDraft side of the gap map reflects the code read for this spike
  (`apps/api/src/gacha/gacha-pull-odds.ts`, `gacha-rip.service.ts`,
  `apps/api/src/duels/duel-opening.service.ts`, `apps/api/src/providers/
  provider-result.ts`, `collector-crypt-pack.provider.ts`,
  `packages/contracts/src/index.ts`) as of this branch's base commit; it is a
  snapshot, not a guarantee that behavior described here is unchanged by the
  time #219/#220 start.
