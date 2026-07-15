# Canonical valuation and public proof

OpenPacks Duel devnet compares exactly one field: the Collector Crypt Gacha
result insured value, mapped by the partner adapter as
`collector-crypt.gacha.result.insuredValue`. A marketplace listing, floor,
estimated resale value, buyback quote, and insured value are different data and
must never be substituted for one another.

The current policy is `collector-crypt-insured-value-usdc-v1`. Its canonical
JSON is returned by `GET /v1/valuation-policies/current` and its SHA-256 is:

```text
406b8f93087ba9910d74006cef30fb7872dcabd763e99215488f06f119b8d66b
```

The value is a canonical unsigned integer string in USDC minor units with
exactly six decimals (no leading zeros except the value `0`).
There is no floating-point conversion and no rounding. Higher wins. The result
must fit the escrow program's unsigned 64-bit integer representation. The result
source timestamp may be at most 300 seconds old at ingestion, with at most 30
seconds of future clock skew. Both outcomes must name the same immutable
provider `poolVersion`.

The policy hash is snapshotted on the pack, duel, exact matchmaking queue,
funding transaction, escrow account, each outcome, comparison result, and
receipt. It is committed in the creator's escrow initialization transaction
before either side's fee deposit can complete. Escrow v2 stores those exact 32
bytes and rejects any provider result whose policy hash differs; it never maps
or normalizes policy versions on-chain. An absent hash, an unsupported
policy version, different outcome hashes, conflicting pool versions, malformed
integer, or stale timestamp fails closed.

## Ties and corrections

Equal integer values have no winner. Each original card returns to its original
participant and both platform fees are refunded. A tie follows the same escrow
path as a win: both cards enter custody, the provider commits the tie result,
and permissionless settlement returns the original assets and fees immediately.
It does not wait for expiry or enter recovery. Ties are never silently broken by
card name, rarity, order, or another price field.

Provider results become immutable when the result hash is recorded. A later
provider correction does not rewrite history or change the winner. It opens a
dispute/refund workflow whose evidence retains both the committed snapshot and
the correction.

Representative fixtures are published at:

- `/fixtures/valuation/equal-value.json`
- `/fixtures/valuation/stale-value.json`
- `/fixtures/valuation/provider-correction.json`

## Reproducible result bundle

The public receipt exposes the two canonical outcome hashes, policy hash, pool
version, duel ID, participant wallets, escrow address, network, provider mode,
winner side, tie rule, and final result hash. The comparison hash is SHA-256 of
the stable, lexicographically key-sorted JSON object documented by
`openpacksduel.result-proof.v1`. Each outcome hash binds its side, provider
reference, asset reference, display name, insured value, provider opening time,
source timestamp, pool version, and valuation policy hash. Historical devnet
outcomes that predate these fields remain readable, but their result proof is
reported unavailable rather than reconstructed from invented snapshot data.

For a real Collector Crypt integration, the provider must sign an attestation
covering the complete outcome payload and escrow recipient. The API must verify
the signature against an allowlisted, versioned provider key before recording
the result. Devnet mock receipts explicitly mark provider attestation as
`mock-not-applicable`. Real provider operation remains disabled while the
partner field mapping, signature algorithm/key distribution, and correction
contract are unconfirmed; `not-recorded` is not treated as verification.
