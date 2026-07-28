import { afterEach, describe, expect, test } from 'bun:test';
import { PublicKey } from '@solana/web3.js';

import type { PokemonTcgCardSnapshot, PokemonTcgClient } from '../providers/pokemon-tcg.client.js';
import { DEVNET_DEMO_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import type { DevnetDemoSignerService } from '../transactions/devnet-demo-signer.service.js';
import {
  DevnetSportsPackGachaProvider,
  devnetMachineKey,
  machineCardIds,
} from './devnet-sports-pack-gacha.provider.js';

const SIGNER_PUBLIC_KEY = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const HOUSE_TOKEN_ACCOUNT = 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const ORIGINAL_ENV = {
  mint: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT,
  network: process.env.DAILYDRAFT_NETWORK,
  providerMode: process.env.DAILYDRAFT_PROVIDER_MODE,
  tokenAccount: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_MINT', ORIGINAL_ENV.mint);
  restoreEnvironment('DAILYDRAFT_NETWORK', ORIGINAL_ENV.network);
  restoreEnvironment('DAILYDRAFT_PROVIDER_MODE', ORIGINAL_ENV.providerMode);
  restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT', ORIGINAL_ENV.tokenAccount);
});

describe('Devnet Sports Pack Gacha provider', () => {
  test('derives a stable machine key per sport and tier', () => {
    expect(devnetMachineKey('football', '10000')).toBe('dailydraft-devnet-football-10000');
    expect(devnetMachineKey('basketball', '1000000')).toBe('dailydraft-devnet-basketball-1000000');
  });

  test('gives each machine its own committed window and wraps at the pool edge', () => {
    expect(machineCardIds(0)).toEqual(['base1-1', 'base1-2', 'base1-3', 'base1-4']);
    expect(machineCardIds(1)).toEqual(['base1-2', 'base1-3', 'base1-4', 'base1-5']);
    expect(machineCardIds(4)).toEqual(['base1-5', 'base1-6', 'base1-7', 'base1-17']);
    // Machine 14 runs off the end of the sixteen-card pool and wraps.
    expect(machineCardIds(14)).toEqual(['base1-15', 'base1-16', 'base1-1', 'base1-2']);
  });

  test('serves twelve machines with real valuations only in devnet provider mode', async () => {
    const provider = buildProvider();
    enableDevnet();

    const machines = await provider.listMachines();
    expect(machines).toHaveLength(12);
    expect(
      [...new Set(machines.map((machine) => machine.tierPriceMinor))].sort(
        (left, right) => Number(left) - Number(right),
      ),
    ).toEqual(['10000', '100000', '1000000']);

    const machine = machines[0];
    if (!machine) throw new Error('Expected a devnet machine');
    expect(machine.committedPoolSize).toBe(4);

    const cards = await provider.getEligibleCards(machine.machineKey);
    expect(cards).toHaveLength(machine.committedPoolSize);

    const card = cards[0];
    if (!card) throw new Error('Expected a devnet card');
    // A single ungraded or unvaulted candidate fails the whole seal, because
    // `minimumEligibleItems` equals the committed pool size.
    expect(card.graded).toBe(true);
    expect(card.vaulted).toBe(true);
    expect(card.poolOpen).toBe(true);
    expect(card.tierEnabled).toBe(true);
    expect(card.graderReference).toContain(SIGNER_PUBLIC_KEY);
    expect(card.insuredValue?.currency).toBe('USDC');
    expect(card.insuredValue?.amount).toBe('4200000');
    // The pinned policy hash rides in the valuation source reference because
    // `SportsPackGachaCard` has no dedicated field for it.
    expect(card.valuationSourceReference).toContain(DEVNET_DEMO_VALUATION_POLICY_HASH);
    expect(card.providerCardReference).toContain(machine.machineKey);
    expect(card.assetReference).toContain(machine.machineKey);

    // Machine-scoped references keep the sliding windows from colliding even
    // where two machines commit to the same underlying card.
    const neighbour = machines[1];
    if (!neighbour) throw new Error('Expected a second devnet machine');
    const neighbourCards = await provider.getEligibleCards(neighbour.machineKey);
    const shared = neighbourCards.find((candidate) =>
      candidate.providerCardReference.endsWith(':base1-2'),
    );
    expect(shared?.assetReference).not.toBe(
      cards.find((candidate) => candidate.providerCardReference.endsWith(':base1-2'))
        ?.assetReference,
    );
  });

  test('coalesces all machine inventory reads into one upstream set request', async () => {
    enableDevnet();
    let requests = 0;
    const pokemon = {
      async getCards(cardIds: readonly string[]): Promise<readonly PokemonTcgCardSnapshot[]> {
        requests += 1;
        return cardIds.map(cardSnapshot);
      },
    } as unknown as PokemonTcgClient;
    const provider = new DevnetSportsPackGachaProvider(pokemon, stubSigner());
    const machines = await provider.listMachines();

    await Promise.all(machines.map((machine) => provider.getEligibleCards(machine.machineKey)));

    expect(requests).toBe(1);
  });

  test('evicts a failed upstream set request so readiness can recover', async () => {
    enableDevnet();
    let requests = 0;
    const pokemon = {
      async getCards(cardIds: readonly string[]): Promise<readonly PokemonTcgCardSnapshot[]> {
        requests += 1;
        if (requests === 1) throw new Error('temporary catalog failure');
        return cardIds.map(cardSnapshot);
      },
    } as unknown as PokemonTcgClient;
    const provider = new DevnetSportsPackGachaProvider(pokemon, stubSigner());
    const [machine] = await provider.listMachines();
    if (!machine) throw new Error('Expected a devnet machine');

    await expect(provider.getEligibleCards(machine.machineKey)).rejects.toThrow(
      'temporary catalog failure',
    );
    await expect(provider.getEligibleCards(machine.machineKey)).resolves.toHaveLength(4);
    expect(requests).toBe(2);
  });

  test('fails closed when the upstream batch omits a configured pool card', async () => {
    enableDevnet();
    const pokemon = {
      async getCards(cardIds: readonly string[]): Promise<readonly PokemonTcgCardSnapshot[]> {
        return cardIds.slice(1).map(cardSnapshot);
      },
    } as unknown as PokemonTcgClient;
    const provider = new DevnetSportsPackGachaProvider(pokemon, stubSigner());
    const [machine] = await provider.listMachines();
    if (!machine) throw new Error('Expected a devnet machine');

    await expect(provider.getEligibleCards(machine.machineKey)).rejects.toThrow(
      'Gacha devnet card base1-1 is unavailable',
    );
  });

  test('rejects an unknown machine key', async () => {
    const provider = buildProvider();
    enableDevnet();

    await expect(provider.getEligibleCards('dailydraft-devnet-football-1')).rejects.toThrow(
      'Gacha devnet machine was not found',
    );
  });

  test('stays closed outside devnet provider mode', async () => {
    const provider = buildProvider();
    enableDevnet();
    process.env.DAILYDRAFT_PROVIDER_MODE = 'mock';

    const disabled = 'disabled outside dailydraft-devnet provider mode';
    await expect(provider.listMachines()).rejects.toThrow(disabled);
    await expect(provider.getEligibleCards('dailydraft-devnet-football-10000')).rejects.toThrow(
      disabled,
    );
    await expect(
      provider.acquireCard({
        assetReference: 'devnet:sports-pack:x',
        recipientWallet: SIGNER_PUBLIC_KEY,
        ripId: 'gacharip_1',
      }),
    ).rejects.toThrow(disabled);
    await expect(
      provider.settleRip({ acquisitionReference: 'solana-devnet:x', ripId: 'gacharip_1' }),
    ).rejects.toThrow(disabled);

    expect(provider.capabilities).toEqual({
      acquisition: false,
      odds: false,
      provider: false,
      settlement: false,
    });
  });

  test('attests custody with signer-derived acquisition and settlement references', async () => {
    const provider = buildProvider();
    enableDevnet();

    const acquired = await provider.acquireCard({
      assetReference: 'devnet:sports-pack:dailydraft-devnet-football-10000:base1-1:mac',
      recipientWallet: SIGNER_PUBLIC_KEY,
      ripId: 'gacharip_1',
    });
    expect(acquired.status).toBe('acquired');
    expect(acquired.acquisitionReference).toStartWith(
      `solana-devnet:${SIGNER_PUBLIC_KEY}:sports-pack-vault-v1:card-acquisition:`,
    );

    // A different rip must never reuse another rip's custody attestation.
    const other = await provider.acquireCard({
      assetReference: 'devnet:sports-pack:dailydraft-devnet-football-10000:base1-1:mac',
      recipientWallet: SIGNER_PUBLIC_KEY,
      ripId: 'gacharip_2',
    });
    expect(other.acquisitionReference).not.toBe(acquired.acquisitionReference);

    const settled = await provider.settleRip({
      acquisitionReference: acquired.acquisitionReference,
      ripId: 'gacharip_1',
    });
    expect(settled.status).toBe('settled');
    expect(settled.settlementReference).toStartWith(
      `solana-devnet:${SIGNER_PUBLIC_KEY}:sports-pack-vault-v1:rip-settlement:`,
    );
  });

  test('reports the devnet mode and computes capabilities without touching the signer', () => {
    const provider = new DevnetSportsPackGachaProvider(
      stubPokemon(),
      // A missing keypair makes `publicKey` throw; `capabilities` is a plain
      // synchronous getter that must survive that.
      {
        get publicKey(): PublicKey {
          throw new Error('No devnet keypair configured');
        },
      } as unknown as DevnetDemoSignerService,
    );
    enableDevnet();

    expect(provider.mode).toBe('dailydraft-devnet');
    expect(provider.capabilities).toEqual({
      acquisition: true,
      odds: true,
      provider: true,
      settlement: true,
    });
  });
});

function buildProvider(): DevnetSportsPackGachaProvider {
  return new DevnetSportsPackGachaProvider(stubPokemon(), stubSigner());
}

function enableDevnet(): void {
  process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';
  process.env.DAILYDRAFT_NETWORK = 'solana-devnet';
  process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT = HOUSE_TOKEN_ACCOUNT;
  process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT = USDC_MINT;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function stubPokemon(): PokemonTcgClient {
  return {
    async getCards(cardIds: readonly string[]): Promise<readonly PokemonTcgCardSnapshot[]> {
      return cardIds.map(cardSnapshot);
    },
  } as unknown as PokemonTcgClient;
}

function cardSnapshot(cardId: string): PokemonTcgCardSnapshot {
  return {
    cardId,
    displayName: `Card ${cardId}`,
    imageUrl: `https://images.pokemontcg.io/${cardId}.png`,
    marketValueMicroUsdc: '4200000',
    priceUpdatedAt: '2026/07/20',
    priceVariant: 'holofoil',
    sourceTimestamp: new Date('2026-07-20T00:00:00.000Z'),
  };
}

function stubSigner(): DevnetDemoSignerService {
  return {
    async assertReady(): Promise<void> {},
    publicKey: new PublicKey(SIGNER_PUBLIC_KEY),
    referenceMac(payload: string): string {
      // Deterministic and injective enough for reference-shape assertions; the
      // real HMAC is covered by `devnet-demo-signer.service.test.ts`.
      return Buffer.from(payload).toString('hex').slice(0, 64).padEnd(64, '0');
    },
  } as unknown as DevnetDemoSignerService;
}
