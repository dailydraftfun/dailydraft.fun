# Devnet MVP runbook

The OpenPacks Duel devnet environment is a public integration preview. It is
not a mainnet deployment and must not accept assets with real-world value.

## Public surfaces

| Surface | Address |
| --- | --- |
| Product app | <https://openpacksduel.vercel.app> |
| Marketing site | <https://openpacksduel-web.vercel.app> |
| Solana RPC fallback | `https://api.devnet.solana.com` |
| Escrow program | `Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS` |

The API project is provisioned as `openpacksduel-api` in Vercel. Its production
alias becomes canonical only after `GET /v1/health` passes the manual devnet
smoke workflow.

## Safety boundary

- Show a persistent `DEVNET` label anywhere a wallet or transaction is shown.
- Use mock provider inventory and valueless devnet token mints until Collector
  Crypt supplies approved partner credentials and confirms the custody flow.
- Support only the token standards explicitly implemented by the devnet escrow.
- Never accept a private key through the app, API, MCP server, issue, or log.
- Keep mainnet and real-value features disabled independently of deployment.
- Treat the public devnet RPC as a fallback. Set a dedicated RPC URL in hosted
  environments before load testing.

## Required environment

### Product app

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SOLANA_NETWORK` | Must be `devnet` for the MVP. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Optional RPC override; defaults to the public devnet endpoint. |
| `NEXT_PUBLIC_OPENPACKSDUEL_API_URL` | Public base URL of the deployed API. |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` | Published devnet escrow program address. |
| `NEXT_PUBLIC_PROVIDER_MODE` | Must be `mock` until partner onboarding is complete. |

### API

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Devnet-only PostgreSQL connection. |
| `SOLANA_NETWORK` | Must be `devnet`. |
| `SOLANA_RPC_URL` | Server-side RPC endpoint. |
| `ESCROW_PROGRAM_ID` | Published devnet escrow program address. |
| `PACK_PROVIDER` | Must be `mock` without Collector Crypt credentials. |
| `OPENPACKSDUEL_API_KEYS` | Server-to-server integration keys; never expose to the browser. |
| `OPENPACKSDUEL_APP_URL` | Canonical product URL. |
| `CORS_ORIGINS` | Explicit allowed browser origins. |

## Release order

1. Merge green escrow CI and publish the reviewed program ID.
2. Fund the isolated devnet deployment authority from a faucet. Never change
   the machine-wide Solana RPC configuration to accomplish this.
3. Deploy the escrow using explicit devnet RPC and keypair arguments.
4. Apply the devnet database migration and deploy `openpacksduel-api`.
5. Configure the product app variables and deploy `apps/app` to Vercel.
6. Run the `Devnet smoke` GitHub workflow with the final API URL.
7. Exercise direct challenge, public queue, disclosed house, cancellation,
   refund, reveal, settlement, social card, and rematch states with valueless
   test assets.

## Promotion gate

Devnet readiness does not imply mainnet readiness. Mainnet remains blocked on
Collector Crypt approval, supported recipient and asset standards, canonical
valuation proof, legal/compliance sign-off, production persistence, independent
escrow audit, governed upgrade authority, and incident controls.

