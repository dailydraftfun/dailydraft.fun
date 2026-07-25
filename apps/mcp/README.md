# DailyDraft MCP

Authenticated Model Context Protocol server for non-custodial DailyDraft
integrations. It supports local stdio and stateless Streamable HTTP at `/mcp`.
The production endpoint is `https://dailydraft-mcp.vercel.app/mcp`.

The server wraps the public v1 API contract with agent-safe tools for pack
discovery, duel status, proof references, and canonical social-card URLs. Its
prepare tools return off-chain intents or unsigned devnet transactions only. It
never signs, submits, accepts wallet secrets, holds keys, or settles duels.

The deployment root is a public connection guide. `/health` exposes readiness
without secrets, while `/config` returns the public transport, tool, and safety
configuration for automated setup.

> [!IMPORTANT]
> The backing API and Solana transaction builder are devnet-preview contracts.
> Mock card outcomes are valueless. A prepared intent is not proof of funding or
> settlement.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_packs` | List duel-eligible pack definitions |
| `get_pack` | Read one pack definition |
| `list_duels` | Discover open or wallet-related duels |
| `get_duel` | Read canonical duel status and chain references |
| `get_duel_proof` | Read result commitments and Solana proof references |
| `get_duel_social_card` | Get canonical page, image, and share text |
| `prepare_create_duel` | Validate an off-chain creation intent without creating it |
| `prepare_fund_duel` | Request an unsigned devnet funding transaction |

Prepare tools require the `prepare` MCP credential scope and always return
`walletConfirmation.required: true`. The transaction-preparation API is allowed
to return `501` until its escrow transaction builder is live; the MCP does not
substitute a mock transaction.

## Run over stdio

```bash
bun install
DAILYDRAFT_API_URL=http://localhost:3003/v1 bun run start
```

Example client configuration for a local checkout:

```json
{
  "mcpServers": {
    "dailydraft": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/dailydraft.fun/apps/mcp/src/index.ts"],
      "env": {
        "DAILYDRAFT_API_URL": "http://localhost:3003/v1"
      }
    }
  }
}
```

`DAILYDRAFT_API_KEY` is optional for public reads and is never returned or
logged. Local stdio is read-only unless the operator explicitly sets
`DAILYDRAFT_MCP_ENABLE_PREPARE=true`.

## Deploy Streamable HTTP on Vercel

Create a Vercel project with `apps/mcp` as its root, then configure the values
shown in `.env.example`. `DAILYDRAFT_MCP_KEYS` is a JSON array of scoped
credentials:

```json
[
  {
    "id": "agent-read",
    "token": "generate-a-random-secret-with-at-least-32-characters",
    "scopes": ["read"]
  },
  {
    "id": "agent-prepare",
    "token": "generate-a-different-random-secret-at-least-32-characters",
    "scopes": ["read", "prepare"]
  }
]
```

Generate tokens with `openssl rand -base64 32`. Call `POST /mcp` with
`Authorization: Bearer <token>`. Browser `Origin` values must exactly match the
comma-separated `DAILYDRAFT_MCP_ALLOWED_ORIGINS`; requests without an Origin
remain available to normal server-to-server MCP clients. Missing authentication
configuration fails closed with `503`.

The function enforces a per-instance, per-credential limit of 60 requests per
minute by default. Set `DAILYDRAFT_MCP_RATE_LIMIT` to change it, and configure
Vercel Firewall rate limiting for a deployment-wide limit across instances. The
in-memory limiter is best-effort defense in depth only; it does not coordinate
limits across serverless instances or cold starts.

The HTTP server creates a fresh stateless MCP server for each request and uses
JSON responses instead of long-lived SSE. It accepts authenticated `POST` plus
CORS `OPTIONS`; authenticated `GET` and `DELETE` are explicitly rejected with
`405`. It validates every supplied Origin before authentication.

`DAILYDRAFT_API_URL` has no production default and is required. Prepare scope
also fails closed unless the server has `DAILYDRAFT_API_KEY`; that upstream
credential is redacted from all tool errors and is never returned to clients.

## Development

```bash
bun run lint
bun run typecheck
bun test
```

CI owns tests, typechecking, and builds for this repository. See the canonical
API contract in [`apps/docs`](https://github.com/dailydraftfun/dailydraft.fun/tree/main/apps/docs).

## License

[MIT](LICENSE)
