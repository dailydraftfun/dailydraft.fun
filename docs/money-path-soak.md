# Money-path soak gate

The money-path soak workflow repeatedly executes the production policy and repository tests that
cover duel creation, funding, matching, opening, settlement, refund, treasury reservation, and
recovery. It runs on relevant pull requests, every day, and on manual dispatch.

## Safety boundary

The runner accepts only iteration, worker, timeout, latency-budget, and report controls. It has no
API, RPC, wallet, or database target argument. It requires deterministic fixture mode and
`solana-devnet`, and fails if a database URL, RPC URL, API URL, provider credential, or signer is
present. The workflow does not reference repository secrets or GitHub environments.

The suite cannot submit a transaction, call a provider, connect to PostgreSQL, or target mainnet.
Its concurrency and failure schedules are the bounded fakes already used by the production service
and repository tests.

## Evidence and budgets

Each iteration must produce named proof for all eight money-path operations. The report also counts
the test cases proving retries, conflicts and races, duplicate prevention, and recovery. A run fails
when:

- any test iteration fails or times out;
- an operation or invariant proof disappears;
- the configured iteration count is incomplete; or
- p95 iteration latency exceeds the explicit budget (45 seconds by default).

The workflow uploads `money-path-soak.json` for seven days. It contains configuration, per-category
counts, p50/p95/max latency, error and timeout totals, budget results, and bounded failure output.

Manual runs can raise or lower the bounded iteration and concurrency controls in the Actions UI.
The command used by CI is:

```bash
SOAK_FIXTURE_MODE=deterministic \
OPENPACKSDUEL_NETWORK=solana-devnet \
bun scripts/money-path-soak.ts \
  --iterations 24 \
  --concurrency 3 \
  --report artifacts/money-path-soak.json
```
