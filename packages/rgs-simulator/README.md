# DailyDraft RGS simulator

Pure, deterministic simulation and evidence primitives for versioned RGS math
configs. The package accepts no network, database, provider, wallet, custody, or
settlement target.

The checked-in Sports Pack Gacha regression uses the exact fixture inventory,
stake, versioned odds bands, `configHash`, and `rulesHash`. Its report records:

The simulator consumes the canonical math bands (`base`, `plus`, `premium`,
and `chase`) directly. It deliberately does not import or derive presentation
`PullRarity`; rarity labels remain display-only and cannot influence odds,
selection, settlement, or evidence.

- declared and realized RTP in parts per million;
- declared and realized payout variance in PPM-squared;
- declared and realized hit rate for every math tier;
- the maximum payout/net-exposure profile and observed hit count;
- explicit absolute/relative tolerances and per-metric pass/fail checks.

Run a deterministic report:

```bash
bun run rgs:simulate --rounds 100000 --seed dailydraft.gacha-sports-pack-fixture-simulation.v1
```

Regenerate the checked-in report and its exact manifest:

```bash
bun run rgs:simulate --rounds 100000 --seed dailydraft.gacha-sports-pack-fixture-simulation.v1 --report evidence/rgs-simulation/gacha-sports-pack-fixture-v1.json
```

Verify the checked-in report and manifest reproduce exactly:

```bash
bun run rgs:verify
```

A passing simulation report is evidence for one promotion gate only. The
promotion evaluator always returns `promotionAuthorized: false` and preserves
`realValueGate: hitl-required`; it cannot approve mainnet, custody, economics,
oracle, payout, or jurisdiction policy.
