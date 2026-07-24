# Games UX preview — design QA

## Comparison target

- Source visual truth:
  - `docs/competitor-audit/06-pack-duel-games-desktop.jpg`
  - `docs/competitor-audit/07-pack-duel-games-mobile.jpg`
- Rendered implementation:
  - `docs/design-qa/games-desktop-implementation.png`
  - `docs/design-qa/games-mobile-implementation.png`
  - `docs/design-qa/desktop-preview-contact-sheet.png`
  - `docs/design-qa/mobile-preview-contact-sheet.png`
- Combined comparison evidence:
  - `docs/design-qa/games-desktop-comparison.png`
  - `docs/design-qa/games-mobile-comparison.png`
- Routes:
  - `/games`
  - `/games/activity`
  - `/games/flip`
  - `/games/crash`
  - `/games/house`
- Theme and state: Pack Duel dark Devnet theme, disconnected wallet, fixture-safe preview.

## Viewport and density normalization

| Evidence | Source pixels | Implementation pixels | CSS viewport | Device scale factor |
| --- | ---: | ---: | ---: | ---: |
| Desktop game hub | 1272 × 716 | 1272 × 716 | 1272 × 716 | 1 |
| Mobile game hub | 382 × 827 | 382 × 827 | 382 × 827 | 1 |
| Desktop preview routes | n/a — design-system extension | 1272 × 900 each | 1272 × 900 | 1 |
| Mobile preview routes | n/a — design-system extension | 390 × 844 each | 390 × 844 | 1 |

The source and implementation game-hub captures were compared at equal pixel dimensions with no density conversion. The new preview routes extend the same shipped visual system and were checked as a desktop and mobile contact sheet.

## Full-view comparison evidence

- The implementation preserves the source header, Devnet disclosure, hero hierarchy, game-card density, max-width behavior, dark surfaces, lime accent, and responsive stacking.
- At 1272 px, the hero, environment panel, section divider, and three-column game-card row align with the source composition.
- At 382 px, the header wraps into the same two-row navigation, the disclosure remains legible, the hero wraps identically, and the environment panel retains the source spacing and width.
- The four preview routes use the same panel, border, label, type, spacing, icon, and action treatments as the game hub. No horizontal overflow was detected at the 390 px test viewport.

## Focused-region comparison evidence

- Header and Devnet disclosure: matching logo treatment, navigation density, wallet action, disclosure color, and responsive wrapping.
- Hero and environment card: matching type hierarchy, lime emphasis, paragraph width, border color, padding, and stacking.
- Game cards and mode panels: matching radii, low-contrast borders, icon weight, uppercase mono labels, and active lime treatment.
- Flip reveal: real Pokémon card imagery is sharp, correctly proportioned, and paired with explicit selection, ownership, and receipt finality.
- Crash decision panel: staged card imagery, hidden-state treatment, fixture pot hierarchy, and cash-out/bust receipts remain readable at both viewports.
- House admission: participant parity, precommitment IDs, admission gates, and the real-arena handoff are visibly distinct.
- Activity resilience states: ready, loading, degraded, and empty states share one stable footprint and use honest semantic status colors.

Focused regions were necessary because the decision controls, card imagery, and receipt copy are too small to validate from the full contact sheet alone. They were inspected directly in the browser during each interaction.

## Required fidelity surfaces

- Fonts and typography: existing Pack Duel sans and mono-label styles are reused. Display weight, line height, tracking, hierarchy, wrapping, and truncation match the source system.
- Spacing and layout rhythm: page gutters, section gaps, panels, grid tracks, radii, borders, and vertical rhythm remain consistent. Desktop and mobile screenshots show no clipped controls or horizontal overflow.
- Colors and visual tokens: existing background, elevated surface, border, lime, warning, violet, primary, secondary, and muted tokens are reused. Contrast and semantic state colors remain clear.
- Image quality and asset fidelity: Flip and Crash use real high-resolution Pokémon TCG card images at the correct card aspect ratio. No placeholder boxes, custom SVG art, emoji, or CSS-drawn card substitutes were introduced.
- Copy and content: every fixture action names itself as simulated, avoids fabricated live participation, and separates selection from purchase, transfer, custody, payout, and settlement finality.
- Icons: Phosphor icons match the existing product family, with consistent weight, size, alignment, and active-state coloring.
- Accessibility and behavior: semantic buttons, pressed states, headings, regions, status messages, labels, alt text, and practical mobile tap targets are present. Navigation remains active throughout `/games/*`.

## Primary interactions tested

- Activity: receipt-example filtering, fixture inclusion, and ready/loading/degraded/empty capability states.
- Flip: pool selection, rules/pool commitment, card reveal, and acquisition receipt.
- Crash: continue through stages, cash out, reset, and committed bust terminal receipt.
- House: disclosure acceptance, player/house path precommitment, admission readiness, and Duel arena handoff.
- Responsive navigation and every preview route at desktop and 390 px mobile widths.

## Findings

- No actionable P0, P1, or P2 visual findings remain.
- A non-blocking console performance warning identified above-the-fold card images without explicit eager loading. `CardImage` and revealed `StageCard` images now set the correct loading policy; a fresh-browser post-fix pass produced zero warnings or errors.

## Comparison history

1. Initial same-size desktop and mobile game-hub comparison: no P0/P1/P2 mismatch found.
2. Extended-route desktop/mobile pass: no P0/P1/P2 layout or fidelity issue found; no horizontal overflow on any preview route.
3. Post-fix browser pass: Flip reveal and Crash card imagery rendered with zero console warnings or errors. No visual regression was introduced.

## Residual test gaps

- These screens deliberately do not exercise provider purchase, wallet authorization, custody, transfer, treasury exposure, payout, or live settlement.
- Real data projection and value-bearing end-to-end coverage remain backend and integration work, not visual-preview blockers.

final result: passed
