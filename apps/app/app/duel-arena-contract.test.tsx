import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
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

const { DuelArena, DuelCard } = await import('./duel-arena');

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
        pull={charizard}
        resolution="winner"
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
    expect(markup).toContain('class="pull-burst"');
    expect(markup).toContain('>Rare pull<');
    // The art replaces the text plate rather than stacking on top of it.
    expect(markup).not.toContain('VERIFIED PULL');
  });

  test('a revealed pull without art falls back to the text plate but keeps the payoff chrome', () => {
    const markup = renderToStaticMarkup(
      <DuelCard
        pull={artless}
        resolution="loser"
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
        pull={null}
        resolution={null}
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
        pull={charizard}
        resolution={null}
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
});
