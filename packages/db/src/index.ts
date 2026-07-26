import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/client.js';

export type { Prisma } from '../generated/client.js';
export {
  DuelMode,
  DuelProviderOperationStatus,
  DuelSide,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  FantasyMatchResultStatus,
  FantasyPosition,
  FantasySport,
  FantasyTournamentStatus,
  FlipInventoryExclusionReason,
  GachaInventoryExclusionReason,
  GachaRipPaymentStatus,
  GachaRipStatus,
  GachaSport,
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
  MatchmakingTicketRole,
  MatchmakingTicketStatus,
  OperatorAction,
  OperatorActorClass,
  OperatorReasonCode,
  ProductEventName,
  ProductEventSource,
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
      maxWait: 5_000,
      timeout: 10_000,
    },
  });
}
