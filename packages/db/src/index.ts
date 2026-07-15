import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/client.js';

export type { Prisma } from '../generated/client.js';
export {
  DuelMode,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  ProviderMode,
  SolanaNetwork,
} from '../generated/client.js';

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(connectionString = process.env.DATABASE_URL): DatabaseClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for durable duel state');
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    errorFormat: 'minimal',
    transactionOptions: {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    },
  });
}
