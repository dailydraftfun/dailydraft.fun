import { describe, expect, test } from 'bun:test';
import { DuelStatus } from '@openpacksduel/db';

import { ESCROW_V2_PROGRAM_ID } from '../contracts/openpacksduel-escrow-v2.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import { HouseTreasuryService } from '../treasury/house-treasury.service.js';
import { DuelFundingService } from './duel-funding.service.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const HOUSE = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const PROVIDER = '66KTY5YdSVAU5BofRgUcS5EHqSYoxLCFfBb4p1T96aQQ';

describe('house risk payment gate', () => {
  test('rejects funding before blockhash or payment-intent creation without a reservation', async () => {
    const calls = { blockHeight: 0, latestBlockhash: 0, paymentPersistence: 0 };
    const duel = {
      creatorWallet: CREATOR,
      expiresAt: new Date('2099-01-01T00:15:00.000Z'),
      houseOpponent: true,
      id: 'duel_house_risk_rejected',
      opponentWallet: HOUSE,
      status: DuelStatus.MATCHED,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    };
    const database = {
      duel: {
        findUnique: ({ select }: { select?: { houseOpponent: true } }) =>
          Promise.resolve(select ? { houseOpponent: true } : duel),
      },
      houseTreasuryReservation: { findUnique: () => Promise.resolve(null) },
      get duelTransaction() {
        calls.paymentPersistence += 1;
        throw new Error('Payment persistence must not be reached');
      },
    };
    const rpc = {
      assertDevnet: () => Promise.resolve(),
      getBlockHeight: () => {
        calls.blockHeight += 1;
        return Promise.resolve(1n);
      },
      getLatestBlockhash: () => {
        calls.latestBlockhash += 1;
        return Promise.resolve({ blockhash: HOUSE, lastValidBlockHeight: 2n });
      },
    };
    const admin = { assertNotPaused: () => Promise.resolve() };
    const treasury = new HouseTreasuryService(database as never, {} as never);
    const service = new DuelFundingService(
      database as never,
      rpc as never,
      admin as never,
      treasury,
    );

    await withFundingEnvironment(async () => {
      await expect(
        service.prepare({
          duelId: duel.id,
          idempotencyKey: 'house-risk-rejected-0001',
          wallet: CREATOR,
        }),
      ).rejects.toThrow('House funding is disabled: no active treasury reservation');
    });

    expect(calls).toEqual({ blockHeight: 0, latestBlockhash: 0, paymentPersistence: 0 });
  });
});

async function withFundingEnvironment(operation: () => Promise<void>): Promise<void> {
  const values = {
    ESCROW_FEE_RECIPIENT: HOUSE,
    ESCROW_PROGRAM_ID: ESCROW_V2_PROGRAM_ID.toBase58(),
    ESCROW_PROVIDER_SIGNER: PROVIDER,
    OPENPACKSDUEL_DEVNET_FEE_LAMPORTS: '1000000',
    OPENPACKSDUEL_NETWORK: 'solana-devnet',
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    await operation();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
