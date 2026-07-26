---
last_verified: 2026-07-26
---

# Game engine & casino-feel roadmap — durable decisions

Source epics: #205 (reveal choreography), #206 (PixiJS SDK), #207 (DailyDraft Engine RGS). Architecture decisions recorded as comments on #206 and #207.

## Rarity (canonical)

- `PullRarity = 'common' | 'uncommon' | 'rare' | 'chase'`, derived from committed `insuredValue` (minor units + decimals) at floors $10 / $50 / $150; missing or non-positive value fails closed to `common`.
- **Presentation-only invariant**: rarity never participates in the result hash, odds, valuation, or settlement. Canonical module lives in `packages/contracts` (PR #223); `apps/app/app/duel/pull-rarity.ts` should re-export from contracts once PR #203 is merged.

## Repo placement

- Engine and theme packs are built **inside this monorepo** (`packages/engine`, `packages/themes`). Do not create a separate engine repo or publish a package yet.
- **Extraction trigger** (pre-committed): first external consumer — a third-party studio or a second first-party product. Then: public SDK repo publishing `@dailydraft/engine` (MIT-leaning), while the RGS remains a hosted service deployed from this monorepo.
- **Never** a second monorepo with its own games API. If the RGS needs isolation/scale, it becomes `apps/rgs` here — deployment boundary, not repo boundary.

## Tech stack ruling

- Tier 1 (now): DOM-level juice — Motion, CSS holographic cards (pokemon-cards-css technique), canvas-confetti, howler, `navigator.vibrate`. No WebGL.
- Tier 2: PixiJS v8 rendering SDK (industry standard for HTML5 casino; Stake Engine's web SDK is Pixi). Rive-vs-Spine decided by spike #215. Three.js/R3F only for cinematic set pieces.
- Tier 3: RGS — one versioned `session → commit → play → reveal → settle` contract that all modes register math configs against; `dailydraft.rgs-proof.v1` envelope (configHash, rulesHash, serverSeedHash/serverSeed, clientSeed, resultHash), Solana anchoring Merkle-batched at commit and settle. Full design memo: `docs/competitor-audit/stake-engine-audit.md`.

## Gotchas

- CI enforces **changed-code coverage ≥80% lines and branches per workspace** (`scripts/changed-coverage/run.ts`); pure-module tests alone won't cover React components — use server-render contract tests (no DOM-testing library in this repo by design).
- `apps/api/src/production-contract/runtime-image.test.ts` asserts every `workspace:*` dep of the API is copied into the Docker runner stage — adding a workspace dep to `apps/api` requires a matching `COPY` in `apps/api/Dockerfile`.
- `apps/docs/public/openapi.yaml` response schemas use `additionalProperties: false`: any new response field must be added to the spec or it ships as a contract violation (no CI check catches response-body shape yet).
