import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProductCapabilities } from '../solana/duel-client';
import {
  activateRulesHashTarget,
  GameRulesOverview,
  resolveDuelRulesReadiness,
} from './game-rules-overview';

const houseAdmission: ProductCapabilities['modes']['house']['admission'] = {
  approvalStatus: 'devnet-preview-no-legal-or-live-provider-approval',
  currency: 'USDC',
  decimals: 6,
  limits: {
    dailyLossAmount: '100000000',
    maxActivePerWallet: 1,
    maxConcurrentPerTier: 2,
    maxTotalExposureAmount: '200000000',
    minimumLiquidityAmount: '50000000',
  },
  network: 'solana-devnet',
  opponent: { label: 'DailyDraft House', wallet: null },
  preFundingRecheck: 'immediately-before-duel-creation',
  valuation: {
    comparisonMetric: 'insured-value',
    policyHash: 'policy-hash',
    policyVersion: 'policy-v1',
    tieRule: 'return-original-assets-and-refund-platform-fees',
  },
};

const capabilities: ProductCapabilities = {
  modes: {
    direct: { enabled: true, reason: null },
    house: { admission: houseAdmission, enabled: false, reason: 'House is unavailable.' },
    open: { enabled: true, reason: null },
  },
  network: 'solana-devnet',
  packs: [
    {
      enabled: true,
      id: 'pokemon_50',
      name: 'Pokémon $50 Pack',
      reason: null,
      tier: 50,
    },
  ],
  provider: { mode: 'dailydraft-devnet', ready: true },
};

describe('browse-first game rules overview', () => {
  test('renders the canonical rules landmark and state ledger for every mode', () => {
    const rendered = [
      [
        'duel',
        <GameRulesOverview
          capabilityState={{ status: 'ready', value: capabilities }}
          key="duel"
          mode="duel"
        />,
      ],
      ['flip', <GameRulesOverview key="flip" mode="flip" />],
      ['crash', <GameRulesOverview key="crash" mode="crash" />],
    ] as const;
    for (const [mode, overview] of rendered) {
      const markup = renderToStaticMarkup(overview);

      expect(markup).toContain('id="rules"');
      expect(markup).toContain('tabindex="-1"');
      expect(markup).toContain(`data-game-rules="${mode}"`);
      expect(markup).toContain('Know the outcome path');
      expect(markup.match(/<h1\b/g)).toHaveLength(1);
      expect(markup).toContain('Wallet requirement.');
      expect(markup).toContain('State ledger');
      expect(markup).toContain('Committed');
      expect(markup).toContain('Owned');
      expect(markup).toContain('Final');
      expect(markup).toContain('Exact promotion gates');
    }
  });

  test('routes only the live Duel surface toward runtime options', () => {
    const duel = renderToStaticMarkup(
      <GameRulesOverview capabilityState={{ status: 'ready', value: capabilities }} mode="duel" />,
    );
    const flip = renderToStaticMarkup(<GameRulesOverview mode="flip" />);
    const crash = renderToStaticMarkup(<GameRulesOverview mode="crash" />);

    expect(duel).toContain('href="#duel-lobby"');
    expect(duel).toContain('Review verified options');
    for (const preview of [flip, crash]) {
      expect(preview).toContain('href="#preview-lab"');
      expect(preview).toContain('Run no-value fixture');
      expect(preview).not.toMatch(/>Connect wallet<|>Play now<|>Buy now</);
    }
  });

  test('supports active Duel semantics and a state-valid return action', () => {
    const active = renderToStaticMarkup(
      <GameRulesOverview
        actionDirection="up"
        actionHref="#duel-battle"
        actionLabel="Return to active duel"
        capabilityState={{ status: 'ready', value: capabilities }}
        headingLevel={2}
        mode="duel"
      />,
    );

    expect(active).toContain('href="#duel-battle"');
    expect(active).toContain('Return to active duel');
    expect(active).toContain('<h2');
    expect(active).not.toContain('<h1');
    expect(active).not.toContain('href="#duel-lobby"');
  });

  test('derives the Duel readiness docket from the existing capability state', () => {
    expect(resolveDuelRulesReadiness({ status: 'loading' })).toEqual(
      expect.objectContaining({ label: 'Checking current capability', state: 'checking' }),
    );
    expect(
      resolveDuelRulesReadiness({
        message: 'Capability endpoint unavailable.',
        retryable: true,
        status: 'error',
      }),
    ).toEqual(
      expect.objectContaining({
        detail: 'Capability endpoint unavailable.',
        state: 'unavailable',
      }),
    );
    expect(resolveDuelRulesReadiness({ status: 'ready', value: capabilities })).toEqual(
      expect.objectContaining({
        detail:
          'Enabled modes: direct challenge, public matchmaking. Enabled tiers: $50 demo pool.',
        label: 'Devnet options verified',
        state: 'enabled',
      }),
    );
    expect(
      resolveDuelRulesReadiness({
        status: 'ready',
        value: { ...capabilities, provider: { ...capabilities.provider, ready: false } },
      }),
    ).toEqual(expect.objectContaining({ label: 'Provider degraded', state: 'degraded' }));
    expect(
      resolveDuelRulesReadiness({
        status: 'ready',
        value: {
          ...capabilities,
          modes: {
            direct: { enabled: false, reason: 'Direct unavailable.' },
            house: { admission: houseAdmission, enabled: false, reason: 'House unavailable.' },
            open: { enabled: false, reason: 'Matchmaking unavailable.' },
          },
          packs: capabilities.packs.map((pack) => ({
            ...pack,
            enabled: false,
            reason: 'No tier available.',
          })),
        },
      }),
    ).toEqual(
      expect.objectContaining({
        detail: expect.stringContaining('Enabled modes: none. Enabled tiers: none.'),
        label: 'Duel unavailable',
        state: 'unavailable',
      }),
    );
    expect(
      resolveDuelRulesReadiness({
        status: 'ready',
        value: {
          ...capabilities,
          modes: {
            direct: { enabled: false, reason: null },
            house: { admission: houseAdmission, enabled: false, reason: null },
            open: { enabled: false, reason: null },
          },
          packs: capabilities.packs.map((pack) => ({
            ...pack,
            enabled: false,
            reason: null,
          })),
        },
      }).detail,
    ).toBe('Enabled modes: none. Enabled tiers: none.');
  });

  test('keeps a 390px-first layout, visible focus target, and reduced-motion fallback', () => {
    const styles = readFileSync(
      new URL('./game-rules-overview.module.css', import.meta.url),
      'utf8',
    );
    const baseStyles = styles.split('@media (min-width: 760px)')[0] ?? styles;

    expect(styles).toContain('min-height: 44px');
    expect(styles).toContain('scroll-margin-top: 11rem');
    expect(styles).toContain('.shell:focus');
    expect(styles).toContain('@media (min-width: 760px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none');
    expect(baseStyles).not.toMatch(/min-width:\s*(?:39[1-9]|[4-9]\d{2,})px/);

    const source = readFileSync(new URL('./game-rules-overview.tsx', import.meta.url), 'utf8');
    expect(source).toContain('hash: window.location.hash');
    expect(source).toContain("window.addEventListener('hashchange', focusRules)");
    expect(source).toContain('focus({ preventScroll: true })');
  });

  test('activates only the canonical rules hash without causing a second scroll', () => {
    const focusOptions: FocusOptions[] = [];
    const target = { focus: (options: FocusOptions) => focusOptions.push(options) };
    const frames: Array<() => void> = [];
    const requestFrame = (callback: () => void) => frames.push(callback);

    expect(activateRulesHashTarget({ hash: '', requestFrame, target })).toBe(false);
    expect(activateRulesHashTarget({ hash: '#rules', requestFrame, target: null })).toBe(false);
    expect(activateRulesHashTarget({ hash: '#rules', requestFrame, target })).toBe(true);
    expect(focusOptions).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(focusOptions).toEqual([{ preventScroll: true }]);
  });
});
