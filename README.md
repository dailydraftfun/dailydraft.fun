# openpacksduel

Generated with `@shipshitdev/v0`.

## Start

```bash
bun install
bun run dev:app
```

## App Scripts

- `bun run dev:web` - starts the public landing page at http://localhost:3000
- `bun run dev:app` - starts the product web app at http://localhost:3001

## Vercel

Deploy the interactive MVP with the Vercel root directory set to `apps/app`. It is self-contained and declares Bun as its package manager. The `apps/web` surface is an optional public landing page.

This is a frontend-only demo. Wallet connection, matchmaking, pack results, card values, escrow proof, and settlement are mocked; the UI never requests a real signature or transaction.

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

Frontend-only Solana Pokemon pack duel MVP with quick matchmaking, wallet challenges, synchronized reveals, and shareable outcomes
