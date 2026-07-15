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

An API `duelId` is not an escrow address. Use `escrowAddress` and
`transactionSignature` from the duel representation when verifying on-chain
state.
