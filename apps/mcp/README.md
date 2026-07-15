# OpenPacks Duel MCP

Read-only-first Model Context Protocol server for OpenPacks Duel integrations.

The server wraps the public v1 API contract with agent-safe tools for pack
discovery, open-duel discovery, duel status, and canonical social-card URLs. It
does not sign Solana transactions, accept seed phrases, or settle duels.

> [!IMPORTANT]
> The backing API contract is preview-only. The server is ready for local
> integration work against `apps/api`. Production availability still depends on
> the persistent datastore, authentication, and Solana integration milestones.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_packs` | List duel-eligible pack definitions |
| `get_pack` | Read one pack definition |
| `list_duels` | Discover open or wallet-related duels |
| `get_duel` | Read canonical duel status and chain references |
| `get_duel_social_card` | Get canonical page, image, and share text |

All tools declare `readOnlyHint: true`. Transaction preparation and mutation
tools will not be added until API authentication, wallet confirmation, and the
escrow settlement contract are production-ready.

## Run over stdio

```bash
bun install
OPENPACKSDUEL_API_URL=http://localhost:3003/v1 bun run start
```

Example client configuration for a local checkout:

```json
{
  "mcpServers": {
    "openpacksduel": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/openpacksduel/app/apps/mcp/src/index.ts"],
      "env": {
        "OPENPACKSDUEL_API_URL": "http://localhost:3003/v1"
      }
    }
  }
}
```

`OPENPACKSDUEL_API_KEY` is optional for public reads and is never logged.

## Development

```bash
bun run lint
bun run typecheck
bun test
```

The MCP v1 SDK is intentionally used while the official v2 SDK remains
pre-release. See the canonical API contract in
[`apps/docs`](https://github.com/openpacksduel/app/tree/main/apps/docs).

## License

[MIT](LICENSE)
