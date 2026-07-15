# Integration quickstart

Run `bun run dev:api` from the monorepo root, then use
`http://localhost:3003/v1` as the local base URL.

## 1. Discover packs

Use `GET /v1/packs` to show the pack definitions currently eligible for duels.
Pack IDs are stable integration identifiers; inventory and prices are snapshots.

## 2. Create a duel intent

Use `POST /v1/duels` with either:

- `matchmakingMode: open` for first-wallet matchmaking; or
- `matchmakingMode: direct` plus `opponentWallet` for a challenge.

Send an `Idempotency-Key`. The response is an off-chain intent, not proof that
funds are escrowed.

## 3. Prepare and sign

Request a serialized Solana transaction from
`POST /v1/duels/{duelId}/transactions`. Decode and display its instructions,
have the participant wallet sign it, then submit it through the wallet or RPC.

Never send a private key, seed phrase, or partially signed transaction containing
someone else's signature to the API.

## 4. Observe finality

Poll `GET /v1/duels/{duelId}` or consume signed webhooks. Treat a duel status as
final only when its response includes an on-chain signature and the required
confirmation level.

## 5. Share

Use `GET /v1/duels/{duelId}/social-card` for canonical duel and image URLs. Do
not construct status URLs from an untrusted status string.
