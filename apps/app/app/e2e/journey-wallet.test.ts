import { afterEach, describe, expect, test } from 'bun:test';

import {
  createJourneyFixtureWallet,
  type JourneyFixtureBootstrap,
  journeyWalletTelemetryKey,
  readJourneyFixtureBootstrap,
} from './journey-wallet';

const originalFixturesFlag = process.env.NEXT_PUBLIC_E2E_FIXTURES;

// bun test runs without a DOM, so the browser surface this module reads from is
// stubbed per test rather than assumed to exist.
function installWindow(bootstrap?: JourneyFixtureBootstrap): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __DAILYDRAFT_JOURNEY__: bootstrap,
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    },
    writable: true,
  });
}

function bootstrapFixture(
  overrides: Partial<JourneyFixtureBootstrap> = {},
): JourneyFixtureBootstrap {
  return {
    failures: { walletTransactionRejections: 0 },
    seed: 'smoke',
    transactionSignature: Array.from({ length: 64 }, () => 7),
    version: 1,
    wallet: {
      address: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T',
      messageSignature: Array.from({ length: 64 }, () => 3),
      publicKey: Array.from({ length: 32 }, () => 1),
    },
    ...overrides,
  };
}

afterEach(() => {
  if (originalFixturesFlag === undefined) delete process.env.NEXT_PUBLIC_E2E_FIXTURES;
  else process.env.NEXT_PUBLIC_E2E_FIXTURES = originalFixturesFlag;
  Reflect.deleteProperty(globalThis, 'window');
});

describe('journey fixture bootstrap', () => {
  test('stays inert unless the fixture build flag is set', () => {
    delete process.env.NEXT_PUBLIC_E2E_FIXTURES;
    installWindow(bootstrapFixture());

    expect(readJourneyFixtureBootstrap()).toBeNull();
  });

  test('stays inert on the server even when the flag is set', () => {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = '1';

    expect(readJourneyFixtureBootstrap()).toBeNull();
  });

  test('fails loudly when the browser bootstrap was never injected', () => {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = '1';
    installWindow();

    expect(() => readJourneyFixtureBootstrap()).toThrow(
      'Journey fixture setup is missing its browser bootstrap.',
    );
  });

  test('returns the injected bootstrap once it validates', () => {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = '1';
    const bootstrap = bootstrapFixture({ seed: 'reveal-flow' });
    installWindow(bootstrap);

    expect(readJourneyFixtureBootstrap()).toEqual(bootstrap);
  });

  test('rejects a bootstrap that would silently produce a bogus wallet', () => {
    process.env.NEXT_PUBLIC_E2E_FIXTURES = '1';

    installWindow(bootstrapFixture({ seed: 'Invalid Seed' }));
    expect(() => readJourneyFixtureBootstrap()).toThrow('invalid seed');

    installWindow(bootstrapFixture({ wallet: { ...bootstrapFixture().wallet, address: '0OIl' } }));
    expect(() => readJourneyFixtureBootstrap()).toThrow('invalid wallet address');

    installWindow(bootstrapFixture({ failures: { walletTransactionRejections: -1 } }));
    expect(() => readJourneyFixtureBootstrap()).toThrow('invalid wallet rejection count');
  });
});

describe('journey fixture wallet', () => {
  test('advertises the rebranded fixture wallet to the wallet picker', () => {
    const wallet = createJourneyFixtureWallet(bootstrapFixture());

    expect(wallet.name).toBe('DailyDraft Journey Fixture');
    expect(wallet.name).not.toContain('Pack Duel');
  });

  test('namespaces wallet telemetry per seed under the rebranded prefix', () => {
    expect(journeyWalletTelemetryKey('smoke')).toBe('dailydraft:journey-wallet:smoke');
    expect(journeyWalletTelemetryKey('reveal-flow')).not.toBe(journeyWalletTelemetryKey('smoke'));
    expect(journeyWalletTelemetryKey('smoke')).not.toContain('openpacksduel');
  });
});
