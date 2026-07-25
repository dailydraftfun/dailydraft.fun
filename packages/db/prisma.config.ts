import { defineConfig } from 'prisma/config';

// Client generation does not require a live database. Runtime startup still fails
// closed in createDatabaseClient when DATABASE_URL is absent.
const generationUrl =
  process.env.DATABASE_URL ??
  'postgresql://dailydraft:dailydraft@localhost:5432/dailydraft?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: generationUrl },
});
