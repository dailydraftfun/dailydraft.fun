# Deterministic duel journeys

The browser harness runs only when Playwright starts the app with
`NEXT_PUBLIC_E2E_FIXTURES=1`. It installs a seed-bound Wallet Standard wallet and
routes the app's RPC and API requests to in-process fixtures. The fixture never
uses a private key, repository secret, live RPC, or provider endpoint.

`DuelJourneyFixture` owns all mutable state. Each test receives a new instance,
and teardown resets it. Future journeys can select a stable seed with:

```ts
test.use({ journeySeed: 'desktop-happy-path' });
```

Unimplemented or incomplete fixture requests return a targeted setup error
instead of falling through to a live service or waiting for a timeout.

The keyboard journey uses only Tab, Shift+Tab, arrows, Enter, and Escape after
page load. It covers roving mode tabs, both modal focus traps, cancellation,
transaction disclosure, receipt access, result sharing, and rematch. The paired
reduced-motion journey asserts the same committed pulls and result while the
browser reports zero reveal animation and transition durations.

The same Playwright gate audits the public marketing, product, receipt, docs,
and MCP onboarding surfaces for serious or critical axe violations. Test-only
receipt routes are available only while `NEXT_PUBLIC_E2E_FIXTURES=1`; they let
the browser crawl canonical, status-specific metadata without contacting a live
API or exposing wallet and transaction identifiers.
