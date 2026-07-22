import { describe, expect, test } from 'bun:test';

import {
  createPublicSurfaceReceipt,
  privateFixtureEscrowAddress,
  privateFixtureOpponentWallet,
  privateFixtureSignature,
  privateFixtureWallet,
  publicSurfaceStatuses,
} from './public-duel-receipt';

describe('public surface journey receipt', () => {
  test.each(publicSurfaceStatuses)('builds the canonical %s fixture state', (status) => {
    const duelId = `duel_public_${status}`;
    const receipt = createPublicSurfaceReceipt(duelId);

    expect(receipt?.duel).toEqual(expect.objectContaining({ id: duelId, status }));
    expect(receipt?.availability.complete).toBe(status === 'settled');
    if (status === 'waiting') {
      expect(receipt?.participants.opponent).toBeNull();
    } else {
      expect(receipt?.participants.opponent).toEqual(
        expect.objectContaining({ address: privateFixtureOpponentWallet }),
      );
    }
    expect(receipt?.result === null).toBe(status !== 'settled');
  });

  test('keeps every privacy sentinel in the receipt used by metadata leak checks', () => {
    const serialized = JSON.stringify(createPublicSurfaceReceipt('duel_public_settled'));

    expect(serialized).toContain(privateFixtureEscrowAddress);
    expect(serialized).toContain(privateFixtureOpponentWallet);
    expect(serialized).toContain(privateFixtureSignature);
    expect(serialized).toContain(privateFixtureWallet);
  });

  test('supports the generic fixture fallback and rejects unrelated duel IDs', () => {
    expect(createPublicSurfaceReceipt('duel_fixture_custom')?.duel.status).toBe('settled');
    expect(createPublicSurfaceReceipt('duel_unknown')).toBeNull();
  });
});
