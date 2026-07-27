# DailyDraft contract fixtures

Versioned request and response fixtures shared by the API, product app, and MCP
client compatibility tests. Changing a documented operation requires updating
the OpenAPI contract and these fixtures in the same pull request.

The contract gate compares the complete running NestJS route inventory with
`apps/docs/public/openapi.yaml`, then exercises client request, authentication,
error, and response-version expectations without live RPC, provider, wallet, or
database operations.

The browser-safe `@dailydraft/contracts/theme-pack` leaf export owns versioned
theme definitions, compatibility fixtures, and the gated provider-source
envelope. Collector Crypt definitions may reference provider-owned art slots
only; they cannot embed a static art or rarity fallback.
