import { describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';

import type { Duel } from '../domain.js';
import type { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
import type { DevnetDemoPackProvider } from './devnet-demo-pack.provider.js';
import type { MockPackProvider } from './mock-pack.provider.js';
import { PackProviderService } from './pack-provider.service.js';

type DuelRouting = Pick<Duel, 'environment' | 'providerMode'>;

const mock = { name: 'mock' } as unknown as MockPackProvider;
const collectorCrypt = { name: 'collector-crypt' } as unknown as CollectorCryptPackProvider;
const devnetDemo = { name: 'devnet-demo' } as unknown as DevnetDemoPackProvider;

// Duel.environment is the literal 'solana-devnet', so a mainnet duel can only reach the
// router through a record that has drifted past the type system — which is precisely the
// case the devnet-only guards exist to catch.
const MAINNET = 'solana-mainnet' as unknown as Duel['environment'];

describe('PackProviderService', () => {
  test('routes every provider mode to its provider', () => {
    const service = new PackProviderService(mock, collectorCrypt, devnetDemo);

    expect(service.forDuel(routing('mock'))).toBe(mock);
    expect(service.forDuel(routing('dailydraft-devnet'))).toBe(devnetDemo);
    expect(service.forDuel(routing('collector-crypt-sandbox'))).toBe(collectorCrypt);
  });

  test('keeps the devnet-only providers off mainnet', () => {
    const service = new PackProviderService(mock, collectorCrypt, devnetDemo);

    expectRejection(
      () => service.forDuel(routing('mock', MAINNET)),
      409,
      'mock pack provider is devnet-only',
    );
    expectRejection(
      () => service.forDuel(routing('dailydraft-devnet', MAINNET)),
      409,
      'DailyDraft demo provider is devnet-only',
    );
  });

  test('fails closed when the demo provider is not wired in', () => {
    const service = new PackProviderService(mock, collectorCrypt);

    expectRejection(
      () => service.forDuel(routing('dailydraft-devnet')),
      503,
      'DailyDraft demo provider is not configured',
    );
  });
});

function expectRejection(action: () => unknown, status: number, message: string): void {
  try {
    action();
    throw new Error('Expected the pack provider router to reject the duel');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as Error).message).toContain(message);
  }
}

function routing(
  providerMode: Duel['providerMode'],
  environment: Duel['environment'] = 'solana-devnet',
): DuelRouting {
  return { environment, providerMode };
}
