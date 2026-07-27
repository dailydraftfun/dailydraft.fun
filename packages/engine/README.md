# `@dailydraft/engine`

Private workspace package for DailyDraft's tier-2 PixiJS scenes.

- Import choreography, fallback contracts, and quality policy from
  `@dailydraft/engine`.
- Import Pixi-specific lifecycle and effects from `@dailydraft/engine/pixi`.
- Import the client-only, lazy renderer binding from
  `@dailydraft/engine/react`.

Every scene must declare informative DOM equivalents for reduced-motion and
renderer-unavailable paths. The React binding renders that fallback during SSR,
keeps it available to assistive technology after the canvas mounts, and imports
both the scene and Pixi runtime only after the client has opted into the canvas
path. Keep `loadScene` module-scoped and stable; use `sceneKey` when a new input
must recreate the scene.

Theme packs are pure data imported from `@dailydraft/themes`. Call
`resolveThemePack` before passing a resolved theme to `applyThemeToScene`;
a mounted scene can swap bundled packs through `SceneMount.applyTheme` without
scene-code changes. Collector Crypt has no client-side ready path and stays
unavailable until #165 adds a partner adapter that passes the existing
`PackProvider.verifyOpenedSnapshot` gate. Theme resolution does not alter the
DOM or reduced-motion fallback path.
