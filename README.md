# openpacksduel

Generated with `@shipshitdev/v0`.

## Start

```bash
bun install
bun run dev:app
```

## Workspace

- `apps/web` - public landing page
- `apps/app` - interactive duel product
- `apps/api` - contract-first NestJS HTTP API
- `apps/docs` - static developer reference and OpenAPI contract
- `apps/mcp` - read-only-first MCP server for agent integrations
- [`openpacksduel/escrow`](https://github.com/openpacksduel/escrow) - public Solana escrow program
- [`openpacksduel/skills`](https://github.com/openpacksduel/skills) - public agent skills

## App Scripts

- `bun run dev:web` - starts the public landing page at http://localhost:3000
- `bun run dev:app` - starts the product web app at http://localhost:3001
- `bun run dev:docs` - starts the developer reference at http://localhost:3002
- `bun run dev:api` - starts the NestJS API at http://localhost:3003/v1
- `bun run dev:mcp` - starts the MCP server over stdio

## Vercel

Deploy the interactive MVP with the Vercel root directory set to `apps/app`. Deploy the developer reference separately with the root directory set to `apps/docs`. The `apps/web` surface is an optional public landing page; `apps/api` and `apps/mcp` remain Bun services rather than static Vercel projects.

The product UI connects Solana wallets and requests signatures only when the API supplies a serialized devnet transaction. Without one, the review remains an explicit simulation and moves no funds. Persistent provider inventory, escrow proof, and production settlement remain implementation milestones.

## Devnet

The public product preview is available at
[openpacksduel.vercel.app](https://openpacksduel.vercel.app). The isolated Solana
devnet environment, program identity, environment contract, deployment order,
and promotion gates are documented in [`docs/devnet-runbook.md`](docs/devnet-runbook.md).

## Update Dependencies

```bash
bun run deps:update
```

## Agent Workspace

- `.agents/skills` - source of truth for selected dev workflow skills
- `.agents/memory` - source of truth for project memory
- `.claude/skills` and `.claude/memory` - relative symlinks into `.agents`
- `.codex/skills` and `.codex/memory` - relative symlinks into `.agents`
- `skills` - selected repo workflow skills for PRDs, planning, execution, review, and verification
- `DESIGN.md` - machine-readable design system spec ([google-labs-code/design.md](https://github.com/google-labs-code/design.md)); validate with `bun run lint:design`

## Scope

Solana Pokémon pack duel workspace with a frontend MVP, preview API, integration docs, and agent tooling.
