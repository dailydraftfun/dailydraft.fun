import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { ChoreographyBeat, ChoreographyController } from './components/choreography';
import type { LivePull } from './duel/live-duel-state';
import { createPracticeDuel } from './duel/practice-duel';
import { journeyTestIds } from './e2e/journey-test-ids';
import type { DurableDuel, ProductCapabilities } from './solana/duel-client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Bun's module registry is process-wide, so this override reaches every later test file.
// Loading the real provider up front and spreading it keeps the rest of its surface
// intact — only the hook is swapped for a stub this file can drive. Pattern matches
// apps/app/app/duel/duel-entry-stepper.test.tsx.
const walletProvider = await import('./solana/wallet-provider');

const walletState = {
  account: null,
  address: null,
  canSignMessage: false,
  canSignTransaction: true,
  clearError: () => undefined,
  cluster: 'devnet' as const,
  connect: async () => true,
  disconnect: async () => undefined,
  error: null,
  networkStatus: 'online' as const,
  retryNetwork: async () => true,
  rpcUrl: 'https://api.devnet.solana.com',
  selectedWallet: null,
  shortAddress: null,
  signTransaction: async () => ({
    serializedTransaction: new Uint8Array(),
    signature: 'signature',
    signedTransactionBase64: '',
  }),
  signAndSendTransaction: async () => 'signature',
  signMessage: async () => new Uint8Array(),
  status: 'disconnected' as const,
  wallets: [],
};

const authenticationState = {
  challenge: null,
  clearError: () => undefined,
  error: null,
  sessionToken: null,
  signIn: async () => undefined,
  status: 'unauthenticated' as const,
};

mock.module('./solana/wallet-provider', () => ({
  ...walletProvider,
  useSolanaWallet: () => walletState,
}));

mock.module('./solana/wallet-auth-provider', () => ({
  useWalletAuth: () => authenticationState,
}));

const {
  DuelArena,
  DuelCard,
  duelPrimaryActionLabel,
  duelResolutionReady,
  duelWinnerCelebrationIntensity,
  practiceResultHeadline,
  practiceRevealHeadline,
  resultWinnerLabel,
} = await import('./duel-arena');

const charizard: LivePull = {
  id: 'outcome-you',
  image: 'https://images.pokemontcg.io/base1/4_hires.png',
  label: 'Base Set · Holo',
  name: 'Charizard fixture pull',
  provider: 'devnet-demo',
  rarity: 'rare',
  side: 'creator',
  value: '$72.5',
  valueMinor: 72_500_000n,
};

// Same pull minus the art: the provider commits an imageUrl per outcome, but it is
// optional, so the card has to degrade to the text plate rather than render an
// <Image> with an empty src.
const artless: LivePull = { ...charizard, image: undefined };

describe('duel arena contract', () => {
  test('labels every capability-gated entry path as a demo pool, never a charge', () => {
    const label = (mode: 'direct' | 'house' | 'matchmaking', action?: 'accept' | 'rematch') =>
      duelPrimaryActionLabel({ action, intentPending: false, mode, tier: 50 });

    expect(duelPrimaryActionLabel({ intentPending: true, mode: 'direct', tier: 50 })).toBe(
      'Preparing payment review',
    );
    expect(label('direct', 'accept')).toBe('Accept challenge · $50 demo pool');
    expect(label('direct', 'rematch')).toBe('Review rematch · $50 demo pool');
    expect(label('direct')).toBe('Create challenge · $50 demo pool');
    expect(label('house', 'rematch')).toBe('Review house rematch · $50 demo pool');
    expect(label('house')).toBe('Play house · $50 demo pool');
    expect(
      duelPrimaryActionLabel({
        intentPending: false,
        mode: 'house',
        practiceBot: true,
        tier: 50,
      }),
    ).toBe('Play bot · $50 practice pool');
    expect(label('matchmaking')).toBe('Find rival · $50 demo pool');
  });

  test('renders the default lobby view with no active duel', () => {
    const markup = renderToStaticMarkup(<DuelArena />);

    expect(markup).toContain(`data-testid="${journeyTestIds.lobby}"`);
    expect(markup).toContain('Reveal together.');
    expect(markup).toContain('Receipt tells the truth.');
    expect(markup).toContain('Checking current capability');
    expect(markup).toContain('Solana devnet MVP');
  });

  test('plays instant practice rounds through win, loss, and draw without transaction claims', async () => {
    await withBrowser(async () => {
      const renderer = await renderClient(
        <DuelArena loadCapabilities={async () => practiceCapabilities()} />,
      );

      await clickTestId(renderer.root, journeyTestIds.mode.house);
      expect(textOf(renderer.root)).toContain('Play bot · $50 practice pool');
      expect(textOf(renderer.root)).toContain('Instant practice bot');

      await clickTestId(renderer.root, journeyTestIds.primaryAction);
      expect(textOf(renderer.root)).toContain('You beat the bot');
      expect(textOf(renderer.root)).toContain('No transaction');
      expect(textOf(renderer.root)).toContain('No-value practice');
      expect(textOf(renderer.root)).not.toContain('Verified receipt');

      await clickTestId(renderer.root, journeyTestIds.resultRematch);
      expect(textOf(renderer.root)).toContain('The bot wins this round');
      expect(textOf(renderer.root)).toContain('DailyDraft Bot');

      await clickTestId(renderer.root, journeyTestIds.resultRematch);
      expect(textOf(renderer.root)).toContain('Draw');

      await unmountClient(renderer);
    });
  });

  test('keeps settled devnet duels on the verified receipt and rematch path', async () => {
    await withBrowser(async () => {
      const renderer = await renderClient(
        <DuelArena
          initialDuel={settledDevnetDuel()}
          loadCapabilities={async () => liveHouseCapabilities()}
        />,
      );

      expect(textOf(renderer.root)).toContain('Devnet settlement');
      expect(textOf(renderer.root)).toContain('signatur…456789');
      expect(textOf(renderer.root)).toContain('Verified receipt');
      expect(textOf(renderer.root)).toContain('Share result');
      expect(textOf(renderer.root)).toContain('Run a rematch');
      expect(textOf(renderer.root)).not.toContain('No-value practice');

      await clickTestId(renderer.root, journeyTestIds.resultRematch);
      expect(textOf(renderer.root)).toContain('Rematch ready');
      expect(textOf(renderer.root)).toContain('Reveal together.');

      await unmountClient(renderer);
    });
  });

  test('names every practice reveal and result state without borrowing settlement language', () => {
    expect(practiceRevealHeadline('countdown', 2)).toBe('Bot picked. Reveal in 2…');
    expect(practiceRevealHeadline('countdown', null)).toBe('Bot picked. Reveal in 3…');
    expect(practiceRevealHeadline('first_reveal', null)).toBe('Your practice card is revealed');
    expect(practiceRevealHeadline('second_reveal', null)).toBe('The bot reveals its card');
    expect(practiceRevealHeadline('resolution', null)).toBe('Preparing the practice reveal…');

    expect(practiceResultHeadline('you')).toBe('You beat the bot');
    expect(practiceResultHeadline('opponent')).toBe('The bot wins this round');
    expect(practiceResultHeadline('tie')).toBe('Draw');
    expect(practiceResultHeadline(null)).toBe('Practice result');

    expect(resultWinnerLabel('you')).toBe('You');
    expect(resultWinnerLabel('opponent', true)).toBe('DailyDraft Bot');
    expect(resultWinnerLabel('opponent', false)).toBe('Opponent');
    expect(resultWinnerLabel('tie')).toBe('Tie');
    expect(resultWinnerLabel(null)).toBe('Pending');
  });

  test('keeps cancelled duel feedback inside the matchmaking card', () => {
    const source = readFileSync(new URL('./duel-arena.tsx', import.meta.url), 'utf8');
    const matchCard = source.indexOf('<Card className="match-card');
    const inlineAlert = source.indexOf('className="duel-inline-alert"', matchCard);
    const matchCardEnd = source.indexOf('</Card>', inlineAlert);

    expect(matchCard).toBeGreaterThanOrEqual(0);
    expect(inlineAlert).toBeGreaterThan(matchCard);
    expect(matchCardEnd).toBeGreaterThan(inlineAlert);
    expect(source).toContain('{persistedDuel && playerStatus && !cancelledPlayerStatus ? (');
    expect(source).toContain('{actionNotice && !cancelledPlayerStatus ? (');
  });

  test('prioritizes the active duel with one battle h1 and a state-valid rules return anchor', () => {
    const source = readFileSync(new URL('./duel-arena.tsx', import.meta.url), 'utf8');
    const activeStart = source.indexOf("if (phase !== 'lobby' && liveDuel && persistedDuel)");
    const lobbyStart = source.indexOf('<main className="lobby-shell"', activeStart);
    const activeView = source.slice(activeStart, lobbyStart);
    const battle = activeView.indexOf('<section className="battle-shell"');
    const rules = activeView.indexOf('<GameRulesOverview');

    expect(activeStart).toBeGreaterThanOrEqual(0);
    expect(lobbyStart).toBeGreaterThan(activeStart);
    expect(activeView).toContain('id="duel-battle"');
    expect(activeView).toContain('<h1 data-testid={journeyTestIds.duelHeadline}>');
    expect(activeView).not.toContain('<h2 data-testid={journeyTestIds.duelHeadline}>');
    expect(activeView).toContain('actionHref="#duel-battle"');
    expect(activeView).toContain('actionLabel="Return to active duel"');
    expect(activeView).toContain('headingLevel={2}');
    expect(battle).toBeGreaterThanOrEqual(0);
    expect(rules).toBeGreaterThan(battle);
  });

  test('starts each replacement confirmation scope before opening the wallet prompt', () => {
    const source = readFileSync(new URL('./duel-arena.tsx', import.meta.url), 'utf8');
    const approveStart = source.indexOf('async function approveIntent()');
    const approveEnd = source.indexOf('async function recoverRejectedFundingIntent', approveStart);
    const approveIntent = source.slice(approveStart, approveEnd);
    const begin = approveIntent.indexOf(
      'const confirmationSignal = confirmationScope.current.begin();',
    );
    const walletPrompt = approveIntent.indexOf(
      'await walletConnection.signAndSendTransaction(transaction)',
    );
    const tracker = approveIntent.indexOf('signal: confirmationSignal');

    expect(approveStart).toBeGreaterThanOrEqual(0);
    expect(approveEnd).toBeGreaterThan(approveStart);
    expect(begin).toBeGreaterThan(
      approveIntent.indexOf('if (!intent || !authentication.sessionToken)'),
    );
    expect(begin).toBeLessThan(walletPrompt);
    expect(tracker).toBeGreaterThan(walletPrompt);
    expect(approveIntent.match(/confirmationScope\.current\.begin\(\)/g)).toHaveLength(1);
  });

  test('rechecks House admission immediately before creation without blocking funded recovery', () => {
    const source = readFileSync(new URL('./duel-arena.tsx', import.meta.url), 'utf8');
    const reviewStart = source.indexOf('async function reviewDuel(');
    const reviewEnd = source.indexOf('async function reviewPersistedFunding', reviewStart);
    const reviewDuel = source.slice(reviewStart, reviewEnd);
    const houseCheck = reviewDuel.indexOf("if (nextMode === 'house')");
    const refresh = reviewDuel.indexOf('await loadCapabilities()', houseCheck);
    const create = reviewDuel.indexOf('await createDuel(', houseCheck);
    const recoveryStart = source.indexOf('async function reviewPersistedFunding');
    const recoveryEnd = source.indexOf('async function cancelPersistedDuel', recoveryStart);

    expect(houseCheck).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(houseCheck);
    expect(create).toBeGreaterThan(refresh);
    expect(reviewDuel).toContain('No duel was created or funded.');
    expect(source.slice(recoveryStart, recoveryEnd)).not.toContain('loadCapabilities');
  });
});

describe('duel card stages', () => {
  test('a revealed pull with art renders the card image, sheen, burst and tier badge', () => {
    const markup = renderToStaticMarkup(
      <DuelCard
        choreography={controllerFor('settled', 'rare')}
        pull={charizard}
        reducedMotion={false}
        resolution="winner"
        rivalValueMinor={25_000_000n}
        side="you"
        stage="revealed"
        tier="$50.00"
        walletLabel="You"
      />,
    );

    expect(markup).toContain('data-rarity="rare"');
    expect(markup).toContain('class="pull-image"');
    expect(markup).toContain('alt="Charizard fixture pull"');
    expect(markup).toContain('class="pull-sheen"');
    expect(markup).toContain('class="pull-winner-celebration"');
    expect(markup).toContain('>Rare pull<');
    expect(markup).toContain('data-choreography-beat="settled"');
    expect(markup).toContain('data-choreography-settled="true"');
    expect(markup).toMatch(/data-celebration-intensity="0\.(?:9|8)\d+"/);
    // The art replaces the text plate rather than stacking on top of it.
    expect(markup).not.toContain('VERIFIED PULL');
  });

  test('a revealed pull without art falls back to the text plate but keeps the payoff chrome', () => {
    const markup = renderToStaticMarkup(
      <DuelCard
        choreography={controllerFor('celebrate', 'rare')}
        pull={artless}
        reducedMotion={false}
        resolution="loser"
        rivalValueMinor={charizard.valueMinor}
        side="opponent"
        stage="revealed"
        tier="$50.00"
        walletLabel="Opponent"
      />,
    );

    expect(markup).toContain('VERIFIED PULL');
    expect(markup).toContain('Base Set · Holo');
    expect(markup).not.toContain('class="pull-image"');
    expect(markup).toContain('class="pull-sheen"');
    expect(markup).toContain('class="pull-burst"');
    expect(markup).toContain('>Rare pull<');
  });

  test('an opening card shows the sealed pack with no pull chrome', () => {
    const markup = renderToStaticMarkup(
      <DuelCard
        choreography={controllerFor('anticipation')}
        pull={null}
        reducedMotion={false}
        resolution={null}
        rivalValueMinor={null}
        side="you"
        stage="opening"
        tier="$50.00"
        walletLabel="You"
      />,
    );

    expect(markup).toContain('card-stage-opening');
    expect(markup).toContain('Opening pack');
    expect(markup).toContain('class="pack-art"');
    expect(markup).toContain('>$50.00<');
    expect(markup).not.toContain('class="pull-image"');
    expect(markup).not.toContain('class="pull-sheen"');
    expect(markup).not.toContain('class="pull-burst"');
    expect(markup).not.toContain('class="pull-rarity"');
  });

  test('a committed pull stays hidden until the stage flips to revealed', () => {
    const markup = renderToStaticMarkup(
      <DuelCard
        choreography={controllerFor('idle', 'rare')}
        pull={charizard}
        reducedMotion={false}
        resolution={null}
        rivalValueMinor={null}
        side="you"
        stage="sealed"
        tier="$50.00"
        walletLabel="You"
      />,
    );

    // The outcome is already known client-side; the card must not leak it early.
    expect(markup).not.toContain('Charizard fixture pull');
    expect(markup).not.toContain('class="pull-burst"');
    expect(markup).toContain('Result pending');
  });

  test('binds every Duel card beat to the shared choreography driver', () => {
    for (const beat of ['anticipation', 'hold', 'reveal', 'celebrate', 'settled'] as const) {
      const markup = renderToStaticMarkup(
        <DuelCard
          choreography={controllerFor(beat, 'chase')}
          pull={charizard}
          reducedMotion={false}
          resolution={null}
          rivalValueMinor={25_000_000n}
          side="you"
          stage={beat === 'celebrate' ? 'opening' : 'revealed'}
          tier="$50.00"
          walletLabel="You"
        />,
      );

      expect(markup).toContain(`data-choreography-beat="${beat}"`);
      expect(markup).toContain(`data-choreography-settled="${beat === 'settled'}"`);
    }
  });

  test('holds resolution until both shared controllers settle', () => {
    expect(duelResolutionReady(false, true, true)).toBe(false);
    expect(duelResolutionReady(true, false, true)).toBe(false);
    expect(duelResolutionReady(true, true, false)).toBe(false);
    expect(duelResolutionReady(true, true, true)).toBe(true);
  });

  test('scales winner celebration by canonical rarity intensity and relative committed value', () => {
    expect(duelWinnerCelebrationIntensity(0.78, 72_500_000n, 25_000_000n)).toBeGreaterThan(0.78);
    expect(duelWinnerCelebrationIntensity(0.78, 72_500_000n, 72_500_000n)).toBe(0.78);
    expect(duelWinnerCelebrationIntensity(2, 100n, 0n)).toBe(1.35);
    expect(duelWinnerCelebrationIntensity(-1, 0n, 0n)).toBe(0);
    expect(duelWinnerCelebrationIntensity(0.5, 100n, -1n)).toBe(0.5);
  });

  test('removes the superseded CSS keyframes and keeps a static reduced-motion fallback', () => {
    const source = readFileSync(new URL('./duel-arena.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

    expect(source).toContain("from './components/choreography'");
    expect(source).toContain('<ChoreographyDriver');
    expect(source).toContain('<ChoreographyCelebration');
    expect(css).not.toMatch(
      /@keyframes (pack-rip|pack-seam-split|pull-sheen-sweep|pull-burst-ring|pull-value-pop|glint)/,
    );
    expect(css).not.toMatch(/card-stage-(?:opening|revealed)[^{]*\{[^}]*animation:/s);
    expect(css).toContain('.pull-winner-celebration');
    expect(css).toMatch(
      /prefers-reduced-motion:[\s\S]*\.pull-winner-celebration,[\s\S]*will-change: auto;/s,
    );
  });
});

function controllerFor(
  beat: ChoreographyBeat,
  rarity: ChoreographyController['rarity'] = 'common',
): ChoreographyController {
  const revealed = beat === 'reveal' || beat === 'celebrate' || beat === 'settled';
  return {
    advance: () => undefined,
    beat,
    fastForward: () => undefined,
    intensity: beat === 'celebrate' ? 0.78 : 0,
    rarity,
    revealed,
    settled: beat === 'settled',
    transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
  };
}

async function renderClient(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
  });
  if (!renderer) throw new Error('React renderer did not initialize.');
  return renderer;
}

async function unmountClient(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
}

async function clickTestId(root: ReactTestInstance, testId: string): Promise<void> {
  const target = root.find((node) => node.props['data-testid'] === testId);
  await act(async () => target.props.onClick());
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

async function withBrowser(run: () => Promise<void>): Promise<void> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDateNow = Date.now;
  const localStorage = storage();
  const sessionStorage = storage();
  let now = previousDateNow();

  Date.now = () => now;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => undefined,
      atob: globalThis.atob,
      clearInterval: globalThis.clearInterval.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      dispatchEvent: () => true,
      localStorage,
      location: {
        href: 'https://app.dailydraft.fun/games/duel',
        origin: 'https://app.dailydraft.fun',
      },
      matchMedia: () => ({
        addEventListener: () => undefined,
        matches: true,
        removeEventListener: () => undefined,
      }),
      open: () => null,
      removeEventListener: () => undefined,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      sessionStorage,
      setInterval: (callback: TimerHandler) => {
        now += 2_000;
        if (typeof callback === 'function') queueMicrotask(() => callback());
        return 1;
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    },
  });

  try {
    await run();
  } finally {
    Date.now = previousDateNow;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function practiceCapabilities(): ProductCapabilities {
  const unavailable = 'Treasury-backed House play is not ready on Solana devnet.';
  return {
    modes: {
      direct: { enabled: true, reason: null },
      house: {
        admission: {
          approvalStatus: 'devnet-preview-no-legal-or-live-provider-approval',
          currency: 'USDC',
          decimals: 6,
          limits: {
            dailyLossAmount: '0',
            maxActivePerWallet: 0,
            maxConcurrentPerTier: 0,
            maxTotalExposureAmount: '0',
            minimumLiquidityAmount: '0',
          },
          network: 'solana-devnet',
          opponent: { label: 'DailyDraft House', wallet: null },
          preFundingRecheck: 'immediately-before-duel-creation',
          valuation: {
            comparisonMetric: 'insured-value',
            policyHash: 'practice-policy',
            policyVersion: 'practice-v1',
            tieRule: 'no-value-practice-draw',
          },
        },
        enabled: false,
        reason: unavailable,
      },
      open: { enabled: true, reason: null },
    },
    network: 'solana-devnet',
    packs: [
      {
        enabled: false,
        id: 'pokemon_25',
        name: 'Pokémon $25 Pack',
        reason: 'Coming soon.',
        tier: 25,
      },
      {
        enabled: true,
        id: 'pokemon_50',
        name: 'Pokémon $50 Pack',
        reason: null,
        tier: 50,
      },
      {
        enabled: false,
        id: 'pokemon_100',
        name: 'Pokémon $100 Pack',
        reason: 'Coming soon.',
        tier: 100,
      },
    ],
    provider: { mode: 'dailydraft-devnet', ready: true },
  };
}

function liveHouseCapabilities(): ProductCapabilities {
  const capabilities = practiceCapabilities();
  return {
    ...capabilities,
    modes: {
      ...capabilities.modes,
      house: {
        ...capabilities.modes.house,
        enabled: true,
        reason: null,
      },
    },
  };
}

function settledDevnetDuel(): DurableDuel {
  const practice = createPracticeDuel({ round: 1, tier: 50 });
  return {
    ...practice,
    escrowAddress: 'escrow_fixture',
    id: 'duel_settled_fixture',
    pack: {
      ...practice.pack,
      provider: 'DailyDraft devnet',
    },
    providerMode: 'dailydraft-devnet',
    result: practice.result
      ? {
          ...practice.result,
          outcomes: practice.result.outcomes.map((outcome) => ({ ...outcome, isMock: false })),
          settlementReady: true,
        }
      : null,
    transactionSignature: 'signature_fixture_123456789',
  };
}
