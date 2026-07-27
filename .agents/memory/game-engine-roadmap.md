---
last_verified: 2026-07-26
---

# Game engine & casino-feel roadmap — durable decisions

Source epics: #205 (reveal choreography), #206 (PixiJS SDK), #207 (DailyDraft Engine RGS). Architecture decisions recorded as comments on #206 and #207.

## Rarity (canonical)

- `PullRarity = 'common' | 'uncommon' | 'rare' | 'chase'`, derived from committed `insuredValue` (minor units + decimals) at floors $10 / $50 / $150; missing or non-positive value fails closed to `common`.
- **Presentation-only invariant**: rarity never participates in the result hash, odds, valuation, or settlement. The single canonical module is `packages/contracts/src/pull-rarity.ts` (PR #223). PR #203 deleted the branch-local `apps/app/app/duel/pull-rarity.ts` rather than turning it into a re-export — there is no app-side copy, and call sites import from contracts directly.
- **Import path matters.** Client components must import from the `@dailydraft/contracts/pull-rarity` subpath, never the package root: the root barrel imports `node:crypto`, which must not reach a browser bundle. `pull-rarity.ts` deliberately has zero imports so the subpath stays leaf-clean.

## Repo placement

- Engine and theme packs are built **inside this monorepo** (`packages/engine`, `packages/themes`). Do not create a separate engine repo or publish a package yet.
- **Extraction trigger** (pre-committed): first external consumer — a third-party studio or a second first-party product. Then: public SDK repo publishing `@dailydraft/engine` (MIT-leaning), while the RGS remains a hosted service deployed from this monorepo.
- **Never** a second monorepo with its own games API. If the RGS needs isolation/scale, it becomes `apps/rgs` here — deployment boundary, not repo boundary.

## Tech stack ruling

- Tier 1 (now): DOM-level juice — Motion, CSS holographic cards (pokemon-cards-css technique), canvas-confetti, howler, `navigator.vibrate`. No WebGL.
- Tier 2: PixiJS v8 rendering SDK (industry standard for HTML5 casino; Stake Engine's web SDK is Pixi). Three.js/R3F only for cinematic set pieces.
- **Authored animation: Rive, not Spine** (settled by spike #215, PR #229 — full memo `docs/spikes/pixi-rive-spine-spike.md`). Rive owns the pack shell, logo, masks, and state-driven reveal beats; Pixi/app code keeps scene orchestration, particles, card data, sound, haptics, and degradation policy. Start on Rive `canvas-lite`, keeping text/layout/audio in Pixi or DOM so the smallest runtime stays viable.
- **Ship Pixi on WebGL first.** WebGPU stays behind a capability/telemetry cohort until the real-device matrix is green — Pixi's own guide still recommends WebGL for production. Note `autoDetectRenderer`'s default is `['webgl','webgpu','canvas']`, so a WebGPU-first attempt requires passing the `preference` array explicitly; omitting it silently yields WebGL.
- **Lazy-load the renderer** only when a tier-2 reveal is entered: a named Pixi import inside the dynamic scene cost 179.6 KiB gzip in a real `apps/app` build; a full namespace import cost 227.6 KiB.
- Rive's runtime is **MIT**, which is why it survives the `@dailydraft/engine` extraction trigger above. Spine's runtime is source-available with an editor-license obligation that travels with any redistributed SDK — adopting Spine later means accepting that for anything externally consumable. Reversal conditions for the Rive call are recorded in the memo's Decision section.
- Tier 3: RGS — one versioned `session → commit → play → reveal → settle` contract that all modes register math configs against; `dailydraft.rgs-proof.v1` envelope (configHash, rulesHash, serverSeedHash/serverSeed, clientSeed, resultHash), Solana anchoring Merkle-batched at commit and settle. Full design memo: `docs/competitor-audit/stake-engine-audit.md`.

## Shared choreography module (tier 1, shipped)

- `packages/engine/src/choreography.ts` is the canonical reveal substrate: beats `idle → anticipation → hold → reveal → celebrate → settled`, per-beat cubic-bezier easings, `PullRarity`-keyed celebration timing/intensity. The app's `choreography-motion.ts` is a compatibility re-export so the DOM and Pixi paths cannot drift.
- **Structural invariant**: the canonical choreography module is pure — no React, DOM, or Pixi imports. Motion binding lives only in the app's `choreography.tsx`.
- Interrupt, fast-forward, and settle all converge on a deep-equal terminal state; reduced-motion dispatches `fast-forward` at the state-machine level rather than merely zeroing CSS durations, so information is never withheld. Any new beat must preserve both properties.
- Builds on `holo-card/` (PR #224), the fail-closed tier-1 baseline and the bottom rung of the degradation ladder.
- Consumers pending: #211 (duel migration onto this module), #212 (rarity-scaled particles — deliberately not implemented here), #213 (audio/haptics), #214 (e2e proof).

## Gotchas

- CI enforces **changed-code coverage ≥80% lines and branches per workspace** (`scripts/changed-coverage/run.ts`); pure-module tests alone won't cover React components — use server-render contract tests (no DOM-testing library in this repo by design).
- `apps/api/src/production-contract/runtime-image.test.ts` asserts every `workspace:*` dep of the API is copied into the Docker runner stage — adding a workspace dep to `apps/api` requires a matching `COPY` in `apps/api/Dockerfile`.
- `apps/docs/public/openapi.yaml` response schemas use `additionalProperties: false`: any new response field must be added to the spec or it ships as a contract violation (no CI check catches response-body shape yet).
