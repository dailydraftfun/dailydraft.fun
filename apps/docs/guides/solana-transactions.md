# Solana transaction model

OpenPacks Duel uses a non-custodial transaction-preparation model.

The API may construct a transaction for `fund`, provider result commitment,
`settle`, or `refund`, but the
participant wallet must:

1. decode the base64 transaction;
2. verify the program ID, accounts, mint, stake, fee configuration, and expiry;
3. sign locally;
4. submit through a trusted Solana RPC;
5. wait for the confirmation level required by the application.

Prepared transactions expire with their recent blockhash. Request a new one
instead of rewriting an expired transaction.

After the wallet broadcasts a transaction, its authenticated wallet session (or
a trusted integration) binds the first transaction signature to the durable prepared intent with
`POST /duels/{duelId}/transactions/{transactionId}/submissions`. The server-side
reconciler checks Solana devnet without depending on the browser. `confirmed`
is progress only; the duel advances only at `finalized`, after the recorded
signer and recent blockhash match and exactly one target instruction matches the
escrow program, encoded-data hash, and exact ordered account signer/write
constraints returned by `getTransaction`. Expected accounts appearing elsewhere
in the transaction are not sufficient.

Escrow v2 funding uses two transactions. The creator and opponent each finalize
one fee deposit. The first valid deposit remains `committing`; the second distinct
participant completes the quorum and advances `funded` atomically. Duplicate
wallet deposits never satisfy quorum and enter refund recovery.

The reconciliation worker is idempotent, bounded to 100 records per run, and
available at `GET|POST /internal/reconciliation/solana`. Vercel Cron uses
`Authorization: Bearer $CRON_SECRET`; a manual worker can also use an integration
key. Missing signatures are retried until blockheight proves expiry. RPC errors
are not copied into public duel responses.

Provider result, settlement, and refund preparation creates a durable intent
before returning unsigned bytes. After broadcast, bind its `intentId` through
the same submission endpoint. Card deposits remain an explicit operator-proof
boundary: their response has `intentId: null` and does not advance duel state.
Real-card preparation fails closed unless Collector Crypt evidence, canonical
insured values, legacy SPL mint metadata, and escrow vault custody all match.
The monitor never reconstructs or trusts an intent from an arbitrary submitted signature.

## Lost submission recovery

The reconciliation worker also covers one narrow failure window: a wallet can
broadcast the exact prepared transaction successfully and then lose the HTTP
request that binds its signature to the API intent. Recovery starts from
persisted `PREPARED` funding intents only. For each bounded intent it queries
recent finalized signatures for that intent's recorded escrow PDA—not general
wallet history—and then fetches each candidate transaction.

A candidate is bound only when the transaction's complete unsigned-message
hash, recent blockhash, expected participant signer, escrow v2 program,
instruction-data hash, and exact ordered signer/write account constraints all
match the persisted intent. Merely mentioning the wallet or escrow PDA is never
enough. Malformed, expired-retention, non-funding, already bound, or wrong-program
intents are not eligible. If an exact finalized funding message is found after
the duel became stale or cancelled, the worker records a durable public/admin
custody alert and atomically moves recoverable states into `refunding`; it never
silently advances the duel as funded. Payment-refund preparation remains
permissionless and requires only devnet plus the audited escrow program config,
while card/result operations retain provider and asset-standard gates. Recovery is idempotent and a
successful binding is recorded as `rpc-recovery` in the admin timeline and
public receipt; private preparation metadata remains private.

Recovery retains prepared intents for 24 hours by default
(`SOLANA_RECOVERY_RETENTION_MS`, bounded from one hour to seven days) and reads
at most 10 finalized escrow-PDA signatures per intent
(`SOLANA_RECOVERY_SIGNATURE_LIMIT`, bounded from 1 to 100). The configured RPC
or indexing provider must preserve `getSignaturesForAddress` and
`getTransaction` history for at least that retention window. The default
devnet RPC offers no durability SLA, so production operations require a paid
RPC/indexer with documented transaction-history retention. Missing indexed
history leaves the intent prepared for operator investigation; it never causes
the service to widen the scan to participant wallets or unrelated addresses.

Each run scans at most 20 due intents and fetches at most 50 candidate
transactions globally (`SOLANA_RECOVERY_INTENT_BUDGET` and
`SOLANA_RECOVERY_CANDIDATE_BUDGET`). Persisted exponential backoff rotates old
intents instead of repeatedly selecting the same rows. Discovery failures are
isolated per intent and do not prevent normal bound-signature reconciliation.

An API `duelId` is not an escrow address. Use `escrowAddress` and
`transactionSignature` from the duel representation when verifying on-chain
state.
