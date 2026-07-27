# `@dailydraft/engine`

Private workspace package for DailyDraft's tier-2 PixiJS scenes.

- Import choreography, fallback contracts, and quality policy from
  `@dailydraft/engine`.
- Import Pixi-specific lifecycle and effects from `@dailydraft/engine/pixi`.
- Import the client-only, lazy renderer binding from
  `@dailydraft/engine/react`.

Every scene must declare informative DOM equivalents for reduced-motion and
renderer-unavailable paths. The React binding renders that fallback during SSR
and imports Pixi only after the client has opted into the canvas path.
