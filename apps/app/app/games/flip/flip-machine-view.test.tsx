import { describe, expect, test } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WalletBalances } from '../../solana/balance';
import type {
  GachaCapability,
  GachaInventoryEntry,
  GachaInventorySnapshot,
  GachaOddsCommitment,
  GachaPaymentIntent,
  GachaRip,
  GachaRipResult,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import type { FlipMachineState } from './flip-machine-state';
import { INITIAL_FLIP_MACHINE_STATE } from './flip-machine-state';
import {
  FlipMachineView,
  type FlipMachineViewProps,
  formatChance,
  shorten,
} from './flip-machine-view';

const MACHINE_KEY = 'dailydraft-devnet-football-10000';
const MAC = 'a'.repeat(32);
const ASSET = `devnet:sports-pack:${MACHINE_KEY}:xy1-1:${MAC}`;

const CAPABILITY: GachaCapability = {
  availability: 'playable',
  gates: { acquisition: true, odds: true, provider: true, settlement: true },
  providerMode: 'dailydraft-devnet',
  reason: 'Every gate is open on devnet.',
};

const CLOSED_CAPABILITY: GachaCapability = {
  ...CAPABILITY,
  availability: 'preview',
  gates: { ...CAPABILITY.gates, acquisition: false },
  reason: 'Acquisition is closed on this cluster.',
};

const ODDS: GachaOddsCommitment = {
  bandMinimums: { base: '0', chase: '5000000', plus: '250000', premium: '1000000' },
  baseProbabilityPpm: 700_000,
  calculatorVersion: '1',
  chaseProbabilityPpm: 25_000,
  committedAt: '2026-07-26T00:00:00.000Z',
  id: 'gachaodds_1',
  machineKey: MACHINE_KEY,
  oddsKey: 'odds-key-that-is-long-enough-to-shorten',
  plusProbabilityPpm: 200_000,
  premiumProbabilityPpm: 75_000,
  probabilityScalePpm: 1_000_000,
  rulesHash: 'r'.repeat(64),
  schemaVersion: '1',
  sealedAt: '2026-07-26T00:00:00.000Z',
  snapshotContentHash: 'c'.repeat(64),
  version: 3,
};

const ENTRY: GachaInventoryEntry = {
  assetReference: ASSET,
  displayName: 'Charizard Holo',
  eligible: true,
  exclusionReasons: [],
  graded: true,
  graderReference: 'PSA-10',
  id: 'gachaentry_1',
  insuredValueCurrency: 'USDC',
  insuredValueDecimals: 6,
  insuredValueMinor: '1500000',
  insuredValueProviderReference: 'provider-1',
  inventorySourceTimestamp: '2026-07-26T00:00:00.000Z',
  ordinal: 0,
  poolOpen: true,
  providerCardReference: 'xy1-1',
  snapshotId: 'gachasnap_1',
  sport: 'FOOTBALL',
  tierEnabled: true,
  valuationSourceReference: 'valuation-1',
  valuationTimestamp: '2026-07-26T00:00:00.000Z',
};

const SNAPSHOT: GachaInventorySnapshot = {
  committedPoolSize: 12,
  contentHash: 'c'.repeat(64),
  eligibleCount: 11,
  eligibleValueMinor: '18000000',
  entries: [ENTRY],
  evaluatedAt: '2026-07-26T00:00:00.000Z',
  excludedCount: 1,
  id: 'gachasnap_1',
  machine: {
    active: true,
    committedPoolSize: 12,
    displayName: 'Football $0.01 Devnet Machine',
    id: 'gachamachine_1',
    machineKey: MACHINE_KEY,
    sport: 'FOOTBALL',
    tierPriceCurrency: 'USDC',
    tierPriceDecimals: 6,
    tierPriceMinor: '10000',
  },
  machineKey: MACHINE_KEY,
  policyHash: 'p'.repeat(64),
  policyVersion: '1',
  poolKey: 'pool-1',
  provider: 'dailydraft-devnet',
  revision: 2,
  schemaVersion: '1',
  sealedAt: '2026-07-26T00:00:00.000Z',
};

const INTENT: GachaPaymentIntent = {
  amountCurrency: 'USDC',
  amountDecimals: 6,
  amountMinor: '10000',
  destinationTokenAccount: 'HouseTreasuryTokenAccount1111111111111111111',
  expiresAt: '2026-07-26T00:05:00.000Z',
  intentId: 'gachaintent_1_long_enough_to_shorten',
  machineKey: MACHINE_KEY,
  memoNonce: 'nonce',
  mint: 'UsdcMint111111111111111111111111111111111111',
  payerWallet: 'Payer1111111111111111111111111111111111111',
  resumed: false,
  signature: null,
  status: 'PENDING',
};

const PREPARED: PreparedGachaPaymentTransaction = {
  amountMinor: '10000',
  expectedMessageHash: 'h'.repeat(64),
  expiresAt: '2026-07-26T00:05:00.000Z',
  intentId: INTENT.intentId,
  lastValidBlockHeight: '100',
  memoNonce: 'nonce',
  recentBlockhash: 'blockhash',
  serializedTransactionBase64: 'aGk=',
  sourceTokenAccount: 'PayerAta11111111111111111111111111111111111',
};

const RIP: GachaRip = {
  acquiredAt: '2026-07-26T00:01:00.000Z',
  acquisitionReference: 'acq-1',
  createdAt: '2026-07-26T00:00:30.000Z',
  failedAssetReference: null,
  failedAt: null,
  failureReason: null,
  id: 'gacharip_1_long_enough_to_shorten',
  idempotencyKey: null,
  insuredValueCurrency: 'USDC',
  insuredValueDecimals: 6,
  insuredValueMinor: '1500000',
  machineKey: MACHINE_KEY,
  oddsCommitmentId: 'gachaodds_1',
  oddsRulesHash: 'r'.repeat(64),
  revealedAt: '2026-07-26T00:01:00.000Z',
  seedCommitmentHash: 's'.repeat(64),
  selectedAssetReference: ASSET,
  selectedAt: '2026-07-26T00:00:45.000Z',
  settledAt: '2026-07-26T00:01:00.000Z',
  settlementReference: 'settle-1',
  snapshotContentHash: 'c'.repeat(64),
  status: 'SETTLED',
  updatedAt: '2026-07-26T00:01:00.000Z',
};

const RESULT: GachaRipResult = {
  oddsCommitment: {
    calculatorVersion: '1',
    committedAt: '2026-07-26T00:00:00.000Z',
    oddsKey: ODDS.oddsKey,
    rulesHash: ODDS.rulesHash,
    schemaVersion: '1',
    snapshotContentHash: ODDS.snapshotContentHash,
    version: 3,
  },
  rip: RIP,
  serverSeed: 'e'.repeat(64),
  serverSeedHash: 's'.repeat(64),
};

/** Enough devnet USDC for every reduced-price tier, so the preflight reads as sufficient. */
const FUNDED: WalletBalances = {
  lamports: 2_000_000_000n,
  token: { amount: 90_000_000n, decimals: 6 },
};

const BROKE: WalletBalances = { lamports: 2_000_000_000n, token: { amount: 1n, decimals: 6 } };

function state(overrides: Partial<FlipMachineState> = {}): FlipMachineState {
  return { ...INITIAL_FLIP_MACHINE_STATE, capability: CAPABILITY, ...overrides };
}

function viewProps(overrides: Partial<FlipMachineViewProps> = {}): FlipMachineViewProps {
  return {
    balanceStatus: 'ready',
    balances: FUNDED,
    onConfirm: () => {},
    onConnect: () => {},
    onPrepare: () => {},
    onReset: () => {},
    onResume: () => {},
    onSelect: () => {},
    state: state(),
    walletAuthenticated: true,
    walletAddress: 'Payer1111111111111111111111111111111111111',
    walletAuthenticationPending: false,
    walletCanSignTransaction: true,
    walletConnecting: false,
    wallets: [{ icon: 'data:image/svg+xml;base64,PHN2Zy8+', name: 'Phantom' }],
    ...overrides,
  };
}

function render(overrides: Partial<FlipMachineViewProps> = {}): string {
  return renderToStaticMarkup(<FlipMachineView {...viewProps(overrides)} />);
}

function buttonHandlers(node: ReactNode): Array<() => void> {
  if (Array.isArray(node)) return node.flatMap(buttonHandlers);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (typeof element.type === 'function') {
    const Component = element.type as (props: typeof element.props) => ReactNode;
    return buttonHandlers(Component(element.props));
  }
  const props = element.props;
  return [...(props.onClick ? [props.onClick] : []), ...buttonHandlers(props.children)];
}

describe('flip machine view stages', () => {
  test('renders the server reason when the rail is closed', () => {
    const html = render({ state: state({ capability: CLOSED_CAPABILITY }) });

    expect(html).toContain('data-stage="blocked"');
    expect(html).toContain('Acquisition is closed on this cluster.');
  });

  test('prefers a capability read failure over the capability reason', () => {
    const html = render({
      state: state({ capability: CLOSED_CAPABILITY, capabilityError: 'The rail is unreachable.' }),
    });

    expect(html).toContain('data-stage="blocked"');
    expect(html).toContain('The rail is unreachable.');
    expect(html).not.toContain('Acquisition is closed on this cluster.');
  });

  test('waits on the capability read before offering anything', () => {
    const html = render({ state: state({ capability: null }) });

    expect(html).toContain('data-stage="loading"');
  });

  test('offers the discovered wallets when no account is connected', () => {
    const html = render({ walletAddress: null });

    expect(html).toContain('data-stage="connect"');
    expect(html).toContain('Phantom');
  });

  test('binds sport, tier, and wallet buttons to their callbacks', () => {
    const selections: string[] = [];
    const review = FlipMachineView(
      viewProps({
        onSelect: (sport, tier) => selections.push(`${sport}:${tier}`),
        state: state({ odds: ODDS, snapshot: SNAPSHOT }),
      }),
    );
    for (const handler of buttonHandlers(review)) handler();
    expect(selections).toContain('football:10000');
    expect(selections).toContain('football:100000');

    const connections: string[] = [];
    const connect = FlipMachineView(
      viewProps({
        onConnect: (walletName) => connections.push(walletName),
        walletAddress: null,
      }),
    );
    for (const handler of buttonHandlers(connect)) handler();
    expect(connections).toEqual(['Phantom']);
  });

  test('explains the empty case rather than rendering a bare list', () => {
    const html = render({ walletAddress: null, wallets: [] });

    expect(html).toContain('wallet-empty-state');
    expect(html).not.toContain('Phantom');
  });

  test('shows the sealed odds and the committed pool size once priced', () => {
    const html = render({ state: state({ odds: ODDS, snapshot: SNAPSHOT }) });

    expect(html).toContain('data-stage="review"');
    expect(html).toContain('Odds &amp; fairness');
    // 25_000 / 1_000_000 → the chase band.
    expect(html).toContain('2.5%');
    expect(html).toContain('11</strong> possible cards');
    expect(html).toContain('Football $0.01');
  });

  test('keeps the game stage honest while odds and inventory are still loading', () => {
    const html = render();

    expect(html).toContain('data-stage="review"');
    expect(html).toContain('—</strong> possible cards');
    expect(html).toContain('—</strong> Chase');
    expect(html).not.toContain('Odds &amp; fairness');
    expect(html).toContain('disabled=""');
  });

  test('surfaces a pricing failure without leaving the review stage', () => {
    const html = render({ state: state({ error: 'No pool is open.', odds: ODDS }) });

    expect(html).toContain('data-stage="recovery"');
    expect(html).toContain('No pool is open.');
  });

  test('locks the price button while a prepare is in flight', () => {
    const html = render({ state: state({ odds: ODDS, pending: true }) });

    expect(html).toContain('data-stage="preparing"');
    expect(html).toContain('Sealing your pack…');
    expect(html).toContain('disabled=""');
  });

  test('itemises the deposit and the treasury before any signature', () => {
    const html = render({
      state: state({
        intent: INTENT,
        odds: ODDS,
        prepared: PREPARED,
        serverSeedHash: 's'.repeat(64),
      }),
    });

    expect(html).toContain('data-stage="funding-review"');
    expect(html).toContain('One approval, then the pack opens');
    expect(html).toContain('House treasury');
    expect(html).toContain('Funding token account');
    expect(html).toContain('Server seed commitment');
    expect(html).toContain('s'.repeat(64));
    expect(html).toContain('Approve 0.01 USDC');
    expect(html).not.toContain('disabled=""');
  });

  test('blocks the approval when the wallet cannot cover the deposit', () => {
    const html = render({
      balances: BROKE,
      state: state({ intent: INTENT, odds: ODDS, prepared: PREPARED }),
    });

    expect(html).toContain('data-stage="funding-review"');
    expect(html).toContain('disabled=""');
  });

  test('blocks the approval when the wallet only supports combined sign-and-send', () => {
    const html = render({
      state: state({ intent: INTENT, odds: ODDS, prepared: PREPARED }),
      walletCanSignTransaction: false,
    });

    expect(html).toContain('data-stage="funding-review"');
    expect(html).toContain('This wallet only supports combined sign-and-send.');
    expect(html).toContain('disabled=""');
  });

  test('omits the preflight line entirely until balances are read', () => {
    const html = render({
      balanceStatus: 'loading',
      balances: null,
      state: state({ intent: INTENT, odds: ODDS, prepared: PREPARED }),
    });

    // A missing balance is not an insufficient one, so the deposit stays live.
    expect(html).toContain('Approve 0.01 USDC');
    expect(html).not.toContain('disabled=""');
  });

  test('reports live cluster progress while the deposit confirms', () => {
    const html = render({
      state: state({
        confirmationPhase: 'confirmed',
        fundingPhase: 'confirming',
        intent: INTENT,
        odds: ODDS,
        prepared: PREPARED,
        signature: 'SignatureThatIsLongEnoughToShorten',
      }),
    });

    expect(html).toContain('data-stage="confirming"');
    expect(html).toContain('explorer.solana.com');
    expect(html).toContain('Signat…horten');
  });

  test.each([
    'signing',
    'verifying',
    'ripping',
  ] as const)('keeps the progress panel up during the %s phase', (fundingPhase) => {
    const html = render({
      state: state({ fundingPhase, intent: INTENT, odds: ODDS, prepared: PREPARED }),
    });

    expect(html).toContain('role="status"');
  });

  test('offers an explorer link and resumes without replacing a broadcast payment', () => {
    const html = render({
      state: state({
        error: 'The rip could not be completed.',
        fundingPhase: 'recovering',
        intent: INTENT,
        odds: ODDS,
        prepared: PREPARED,
        signature: 'SignatureThatIsLongEnoughToShorten',
      }),
    });

    expect(html).toContain('data-stage="recovery"');
    expect(html).toContain('Finishing your rip');
    expect(html).toContain('Track on Solana Explorer');
    expect(html).toContain('Try recovery now');
    expect(html).not.toContain('Start a new rip');
  });

  test('keeps a signed claim failure inside one recovery stage without fresh-pack controls', () => {
    const html = render({
      state: state({
        error: 'Signed transaction does not match the Gacha payment intent.',
        fundingPhase: 'recovering',
        odds: ODDS,
        recovery: {
          commitmentId: 'gachaseed_1',
          intentId: INTENT.intentId,
          machineKey: MACHINE_KEY,
          mint: INTENT.mint,
          oddsVersion: ODDS.version,
          payerWallet: INTENT.payerWallet,
          serverSeedHash: 's'.repeat(64),
          signature: 'S'.repeat(88),
          signedTransactionBase64: 'c2lnbmVk',
          sourceTokenAccount: PREPARED.sourceTokenAccount,
          status: 'signed-claim-pending',
          updatedAt: '2026-07-26T00:00:00.000Z',
          version: 3,
        },
        signature: 'S'.repeat(88),
      }),
    });

    expect(html).toContain('Securing your pack');
    expect(html).toContain('Your payment was not sent');
    expect(html).toContain('Try recovery now');
    expect(html).not.toContain('Rip Football');
    expect(html).not.toContain('<legend');
  });

  test('keeps corrupt recovery visibly fail-closed without exposing another payment', () => {
    const html = render({
      state: state({
        fundingPhase: 'recovering',
        recoveryInvalid: true,
      }),
    });

    expect(html).toContain('Your previous rip needs attention');
    expect(html).toContain('Do not approve another payment');
    expect(html).toContain('Your previous pack is protected');
    expect(html).not.toContain('Try recovery now');
    expect(html).not.toContain('Rip Football');
  });

  test('pauses signed recovery for auth restoration and the original wallet', () => {
    const recovery = {
      commitmentId: 'gachaseed_1',
      intentId: INTENT.intentId,
      machineKey: MACHINE_KEY,
      mint: INTENT.mint,
      oddsVersion: ODDS.version,
      payerWallet: INTENT.payerWallet,
      serverSeedHash: 's'.repeat(64),
      signature: 'S'.repeat(88),
      signedTransactionBase64: 'c2lnbmVk',
      sourceTokenAccount: PREPARED.sourceTokenAccount,
      status: 'signed-claim-pending' as const,
      updatedAt: '2026-07-26T00:00:00.000Z',
      version: 3 as const,
    };

    const restoring = render({
      state: state({ fundingPhase: 'recovering', recovery }),
      walletAuthenticationPending: true,
    });
    expect(restoring).toContain('Restoring your wallet session before recovery');

    const wrongWallet = render({
      state: state({ fundingPhase: 'recovering', recovery }),
      walletAddress: 'DifferentWallet11111111111111111111111111111111',
    });
    expect(wrongWallet).toContain('Reconnect the wallet that started this rip');
    expect(wrongWallet).not.toContain('Try recovery now');
  });

  test('blocks every retry control while a signature-less broadcast is unresolved', () => {
    const html = render({
      state: state({
        broadcastUnknown: true,
        error: 'This payment may have been broadcast.',
        fundingPhase: 'recovering',
        signature: null,
      }),
    });

    expect(html).toContain('checking the previous attempt');
    expect(html).not.toContain('Try recovery now');
    expect(html).not.toContain('Rip Football');
    expect(html).not.toContain('Approve 0.01 USDC');
  });

  test('keeps the pulled card sealed until hydration and renders the provably fair receipt', () => {
    const html = render({
      state: state({
        intent: INTENT,
        odds: ODDS,
        prepared: PREPARED,
        result: RESULT,
        snapshot: SNAPSHOT,
      }),
    });

    expect(html).toContain('data-stage="revealed"');
    expect(html).toContain('data-rarity="premium"');
    expect(html).toContain('data-pixi-scene="sports-pack-gacha-reveal"');
    expect(html).toContain('data-theme="dailydraft-demo@1.0.0"');
    expect(html).toContain('Sealed sports pack');
    expect(html).not.toContain('images.pokemontcg.io');
    expect(html).toContain('Charizard Holo');
    expect(html).toContain('1.5 USDC');
    expect(html).toContain('Provably fair receipt');
    expect(html).toContain('Client seed hash');
    expect(html).toContain('Server seed commitment');
    expect(html).toContain('Verified against the pre-payment commitment');
  });

  test('renders provider failure as refund reconciliation instead of a card reveal', () => {
    const failedResult: GachaRipResult = {
      ...RESULT,
      rip: {
        ...RIP,
        acquiredAt: null,
        acquisitionReference: null,
        failedAssetReference: ASSET,
        failedAt: '2026-07-26T00:01:00.000Z',
        failureReason: 'The provider did not deliver the selected card.',
        insuredValueMinor: '0',
        selectedAssetReference: null,
        settledAt: null,
        settlementReference: null,
        status: 'FAILED',
      },
    };
    const html = render({
      state: state({ odds: ODDS, result: failedResult, snapshot: SNAPSHOT }),
    });

    expect(html).toContain('data-stage="delivery-failed"');
    expect(html).toContain('Your deposit settled, but the card provider did not finish delivery');
    expect(html).toContain('operator reconciliation and refund review');
    expect(html).toContain('The provider did not deliver the selected card.');
    expect(html).toContain('Refund reconciliation');
    expect(html).not.toContain('You pulled');
    expect(html).not.toContain('Provably fair receipt');
  });

  test('uses safe receipt fallbacks when a provider failure has sparse evidence', () => {
    const html = render({
      state: state({
        odds: ODDS,
        result: {
          ...RESULT,
          rip: {
            ...RIP,
            failedAssetReference: null,
            failedAt: '2026-07-26T00:01:00.000Z',
            failureReason: null,
            selectedAssetReference: null,
            status: 'FAILED',
          },
          serverSeed: null,
        },
        snapshot: SNAPSHOT,
      }),
    });

    expect(html).toContain('Provider delivery failed');
    expect(html).toContain('Not recorded');
    expect(html).toContain('Unavailable');
  });

  test('does not borrow rarity evidence from a different machine after recovery', () => {
    const html = render({
      state: state({
        odds: { ...ODDS, machineKey: 'dailydraft-devnet-soccer-1000000' },
        result: RESULT,
        snapshot: { ...SNAPSHOT, machineKey: 'dailydraft-devnet-soccer-1000000' },
      }),
    });

    expect(html).toContain('data-stage="revealed"');
    expect(html).toContain('Rarity pending');
    expect(html).not.toContain('data-rarity="premium"');
  });

  test('falls back to the card name when the asset reference has no art', () => {
    const html = render({
      state: state({
        odds: ODDS,
        result: { ...RESULT, rip: { ...RIP, selectedAssetReference: 'opaque-reference' } },
        snapshot: SNAPSHOT,
      }),
    });

    expect(html).toContain('data-stage="revealed"');
    expect(html).not.toContain('images.pokemontcg.io');
    expect(html).toContain('Vaulted card');
  });

  test('shows the pending seed reveal rather than an empty receipt row', () => {
    const html = render({
      state: state({ odds: ODDS, result: { ...RESULT, serverSeed: null }, snapshot: SNAPSHOT }),
    });

    expect(html).toContain('Pending reveal');
  });

  test('labels a settled receipt whose commitment echo is unavailable', () => {
    const html = render({
      state: state({
        odds: ODDS,
        result: { ...RESULT, serverSeedHash: null },
        snapshot: SNAPSHOT,
      }),
    });

    expect(html).toContain('Missing proof');
  });

  test('renders a posted notice alongside whatever stage is active', () => {
    const html = render({ state: state({ notice: 'Deposit sent on Solana devnet.', odds: ODDS }) });

    expect(html).toContain('Deposit sent on Solana devnet.');
  });
});

describe('flip machine view helpers', () => {
  test('renders a probability as a percentage of the committed scale', () => {
    expect(formatChance(700_000, 1_000_000)).toBe('70.0%');
    // A missing or zero scale would divide by nothing and render `Infinity`.
    expect(formatChance(700_000, 0)).toBe('—');
    expect(formatChance(Number.NaN, 1_000_000)).toBe('—');
  });

  test('elides only values long enough to need it', () => {
    expect(shorten('short')).toBe('short');
    expect(shorten('a'.repeat(40))).toBe('aaaaaa…aaaaaa');
  });
});
