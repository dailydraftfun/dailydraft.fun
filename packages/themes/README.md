# `@dailydraft/themes`

Versioned, data-only theme packs consumed by `@dailydraft/engine`.

- `devnetDemoThemePack` is self-contained and available for demo/devnet scenes.
- `collectorCryptThemePack` contains opaque provider keys only. Its art and card
  metadata remain unavailable until the existing gated pack-provider adapter
  supplies a matching normalized asset snapshot.

Theme packs do not change scene logic or the DOM/reduced-motion fallback path.
