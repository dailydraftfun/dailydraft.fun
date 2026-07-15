# Solana transaction model

OpenPacks Duel uses a non-custodial transaction-preparation model.

The API may construct a transaction for `fund`, `cancel`, or `refund`, but the
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

Transaction preparation is intentionally unavailable until the deployed escrow
IDL, devnet asset mints, and Collector Crypt transaction builders are known.
The monitor never reconstructs or trusts an intent from an arbitrary submitted
signature.

An API `duelId` is not an escrow address. Use `escrowAddress` and
`transactionSignature` from the duel representation when verifying on-chain
state.
