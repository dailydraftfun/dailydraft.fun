# `@dailydraft/themes`

Versioned, renderer-neutral theme packs for `@dailydraft/engine`.

- `DEVNET_DEMO_THEME` is a bundled, valueless demo pack.
- `COLLECTOR_CRYPT_THEME` contains palettes and provider-owned art slots only. It has no static Collector Crypt art, metadata, or rarity fallback.
- `resolveThemePack` materializes Collector Crypt only from a validated `dailydraft.theme-provider-source.v1` envelope in `collector-crypt-production` mode. Until the #165 HITL promotion produces that server-gated envelope, resolution fails closed.
- `themeScenePresentation` maps either resolved theme into the same Pixi scene inputs. `themeCssVariables` exposes the matching palette and foil data to informative DOM and reduced-motion fallbacks.

Theme packs never participate in odds, valuation, result hashing, or settlement. Collector rarity is derived from the gated provider snapshot's insured value through `@dailydraft/contracts/pull-rarity`.
