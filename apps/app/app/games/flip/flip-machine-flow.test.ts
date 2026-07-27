import { describe, expect, test } from 'bun:test';
import type {
  GachaCapability,
  GachaPaymentIntent,
  GachaRipResult,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import {
  createClientSeed,
  describeFlipStage,
  type FlipStage,
  getFlipCostSummary,
  getFlipFundingRequirement,
  getFlipStage,
} from './flip-machine-flow';

const OPEN: GachaCapability = {
  availability: 'playable',
  gates: { acquisition: true, odds: true, provider: true, settlement: true },
  providerMode: 'dailydraft-devnet',
  reason: 'Devnet machine is open',
};

const INTENT: GachaPaymentIntent = {
  amountCurrency: 'USDC',
  amountDecimals: 6,
  amountMinor: '50000000',
  destinationTokenAccount: 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS',
  expiresAt: '2026-07-26T00:15:00.000Z',
  intentId: `gachapay_${'a'.repeat(32)}`,
  machineKey: 'dailydraft-devnet-football-50000000',
  memoNonce: 'b'.repeat(32),
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  payerWallet: '9e5GLpBatYF8Utb9McZUxw96b17f22oJEtG72ZLUYqGV',
  resumed: false,
  signature: null,
  status: 'PENDING',
};

const PREPARED = { intentId: INTENT.intentId } as PreparedGachaPaymentTransaction;
const RESULT = { rip: { id: 'gacharip_1', status: 'SETTLED' } } as GachaRipResult;
const PROVIDER_FAILED_RESULT = {
  rip: { id: 'gacharip_failed', status: 'FAILED' },
} as GachaRipResult;

function stageInput(overrides: Partial<Parameters<typeof getFlipStage>[0]> = {}) {
  return {
    capability: OPEN,
    capabilityError: null,
    error: null,
    fundingPhase: 'idle' as const,
    pending: false,
    prepared: null,
    result: null,
    walletAddress: '9e5GLpBatYF8Utb9McZUxw96b17f22oJEtG72ZLUYqGV',
    ...overrides,
  };
}

describe('flip stage resolution', () => {
  test('blocks before anything else when the capability read fails or a gate is shut', () => {
    expect(getFlipStage(stageInput({ capabilityError: 'unreachable' }))).toBe('blocked');
    // Fails shut: the server's answer outranks the build-time mirror in
    // game-catalog.ts, so a closed gate can never reach a payment step.
    expect(
      getFlipStage(
        stageInput({ capability: { ...OPEN, gates: { ...OPEN.gates, settlement: false } } }),
      ),
    ).toBe('blocked');
    expect(getFlipStage(stageInput({ capability: { ...OPEN, availability: 'preview' } }))).toBe(
      'blocked',
    );
    expect(getFlipStage(stageInput({ capability: null }))).toBe('loading');
    // A blocked machine stays blocked even mid-flight.
    expect(
      getFlipStage(
        stageInput({ capabilityError: 'unreachable', fundingPhase: 'signing', result: RESULT }),
      ),
    ).toBe('blocked');
  });

  test('keeps a revealed rip on screen ahead of every in-flight phase', () => {
    for (const fundingPhase of [
      'confirming',
      'recovering',
      'ripping',
      'signing',
      'verifying',
    ] as const) {
      expect(getFlipStage(stageInput({ fundingPhase, result: RESULT }))).toBe('revealed');
    }
    // A late error must not pull the player away from a settled card.
    expect(getFlipStage(stageInput({ error: 'network failed', result: RESULT }))).toBe('revealed');
  });

  test('keeps a terminal provider failure out of the card reveal stage', () => {
    expect(getFlipStage(stageInput({ result: PROVIDER_FAILED_RESULT }))).toBe('delivery-failed');
    expect(
      getFlipStage(stageInput({ fundingPhase: 'ripping', result: PROVIDER_FAILED_RESULT })),
    ).toBe('delivery-failed');
  });

  test('maps each funding phase to its own stage', () => {
    const expected: Record<string, FlipStage> = {
      confirming: 'confirming',
      recovering: 'recovery',
      ripping: 'ripping',
      signing: 'funding-signature',
      verifying: 'verifying',
    };
    for (const [fundingPhase, stage] of Object.entries(expected)) {
      expect(
        getFlipStage(
          stageInput({
            fundingPhase: fundingPhase as 'signing',
            // A funding phase outranks a missing wallet: the transfer is
            // already in flight, so re-prompting to connect would be a lie.
            walletAddress: null,
          }),
        ),
      ).toBe(stage);
    }
  });

  test('asks for a wallet before it quotes a deposit', () => {
    expect(getFlipStage(stageInput({ prepared: PREPARED, walletAddress: null }))).toBe('connect');
    expect(getFlipStage(stageInput({ prepared: PREPARED }))).toBe('funding-review');
    expect(getFlipStage(stageInput({ pending: true }))).toBe('preparing');
    expect(getFlipStage(stageInput({ error: 'intent expired' }))).toBe('recovery');
    expect(getFlipStage(stageInput())).toBe('review');
  });
});

describe('flip stage copy', () => {
  test('describes every stage the resolver can return', () => {
    const stages: FlipStage[] = [
      'blocked',
      'confirming',
      'connect',
      'delivery-failed',
      'funding-review',
      'funding-signature',
      'loading',
      'preparing',
      'recovery',
      'revealed',
      'review',
      'ripping',
      'verifying',
    ];
    for (const stage of stages) {
      const described = describeFlipStage(stage);
      expect(described.label.length).toBeGreaterThan(0);
      expect(described.detail.length).toBeGreaterThan(0);
    }
    expect(describeFlipStage('funding-signature').detail).toContain('Nothing is charged');
  });
});

describe('flip cost disclosure', () => {
  test('quotes the tier as a preview until the server seals an intent', () => {
    expect(getFlipCostSummary('50000000', null)).toEqual({
      deposit: 'Quoted before you sign',
      networkFee: 'Solana network fee only, paid in SOL',
      packTier: '50 USDC',
      walletApproval: 'One transfer, shown in full before you approve',
    });
  });

  test('quotes the sealed intent once the server has priced the rip', () => {
    expect(getFlipCostSummary('50000000', INTENT)).toMatchObject({
      deposit: '50 USDC',
      walletApproval: 'One transfer of 50 USDC to the house treasury',
    });
  });

  test('never renders an unparseable amount as a number', () => {
    expect(getFlipCostSummary('not-minor', null).packTier).toBe('Quoted by the machine');
    expect(getFlipCostSummary('50000000', { ...INTENT, amountMinor: 'x' }).deposit).toBe(
      'Quoted before you sign',
    );
  });
});

describe('flip funding requirement', () => {
  test('requires USDC for the deposit and leaves the SOL side to the fee buffer', () => {
    expect(getFlipFundingRequirement(INTENT)).toEqual({
      lamports: '0',
      token: { amount: 50_000_000n, decimals: 6, symbol: 'USDC' },
    });
  });

  test('drops the token requirement rather than throwing on a malformed amount', () => {
    expect(getFlipFundingRequirement({ ...INTENT, amountMinor: 'x' })).toEqual({
      lamports: '0',
      token: null,
    });
  });
});

describe('client seed', () => {
  test('emits 64 lowercase hex characters, comfortably inside the 16-240 validator', () => {
    expect(createClientSeed((bytes) => bytes.fill(0xab))).toBe('ab'.repeat(32));
    expect(createClientSeed()).toMatch(/^[0-9a-f]{64}$/);
    expect(createClientSeed((bytes) => bytes.fill(0x00))).toBe('00'.repeat(32));
  });

  test('does not repeat itself across calls', () => {
    expect(createClientSeed()).not.toBe(createClientSeed());
  });
});
