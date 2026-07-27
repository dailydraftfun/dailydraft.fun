import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChoreographyBeat, ChoreographyController } from './components/choreography';
import type { LivePull } from './duel/live-duel-state';
import { journeyTestIds } from './e2e/journey-test-ids';

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

const { DuelArena, DuelCard, duelResolutionReady, duelWinnerCelebrationIntensity } = await import(
  './duel-arena'
);

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
  test('renders the default lobby view with no active duel', () => {
    const markup = renderToStaticMarkup(<DuelArena />);

    expect(markup).toContain(`data-testid="${journeyTestIds.lobby}"`);
    expect(markup).toContain('Rip together.');
    expect(markup).toContain('Winner takes all.');
    expect(markup).toContain('Solana devnet MVP');
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
