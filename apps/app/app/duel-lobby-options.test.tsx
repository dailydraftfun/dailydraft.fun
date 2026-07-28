import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DuelModeTabs,
  PackTierChoices,
  ProductCapabilityPanel,
  resolveLobbySelection,
} from './duel-lobby-options';
import { journeyTestIds } from './e2e/journey-test-ids';
import { type ProductCapabilities, parseProductCapabilities } from './solana/duel-client';

describe('duel lobby capability controls', () => {
  test('renders every server-supported mode and pack as playable', () => {
    const capabilities = capabilityFixture({
      houseEnabled: true,
      pack25Enabled: true,
      pack100Enabled: true,
    });
    const markup = renderToStaticMarkup(
      <>
        <DuelModeTabs
          capabilities={capabilities}
          disabled={false}
          mode="direct"
          onSelect={() => undefined}
        />
        <PackTierChoices
          capabilities={capabilities}
          locked={false}
          selectedTier={25}
          onSelect={() => undefined}
        />
      </>,
    );

    expect(markup).toContain('Challenge');
    expect(markup).toContain('Matchmake');
    expect(markup).toContain('Instant');
    expect(markup).not.toContain('Coming soon');
    expect(markup).toContain('Pokémon $25 Pack');
    expect(markup).toContain('Pokémon $100 Pack');
    expect(markup).toContain(`data-testid="${journeyTestIds.mode.direct}"`);
    expect(markup).toContain(`data-testid="${journeyTestIds.mode.matchmaking}"`);
    expect(markup).toContain(`data-testid="${journeyTestIds.mode.house}"`);
    expect(markup).toContain(`data-testid="${journeyTestIds.tier(25)}"`);
    expect(markup).toContain(`data-testid="${journeyTestIds.tier(100)}"`);
  });

  test('auto-selects the sole playable tier and labels unsupported choices coming soon', () => {
    const capabilities = capabilityFixture();
    const markup = renderToStaticMarkup(
      <>
        <DuelModeTabs
          capabilities={capabilities}
          disabled={false}
          mode="matchmaking"
          onSelect={() => undefined}
        />
        <PackTierChoices
          capabilities={capabilities}
          locked={false}
          selectedTier={50}
          onSelect={() => undefined}
        />
      </>,
    );

    expect(markup).toContain('Selected automatically');
    expect(markup).toContain('Playable now');
    expect(markup.match(/Coming soon/g)?.length).toBe(2);
    expect(markup).toContain('House play is not ready on Solana devnet.');
    const selectedButton = markup.match(/<button[^>]*tier-card-selected[^>]*>/)?.[0];
    expect(selectedButton).toContain('aria-pressed="true"');
    expect(selectedButton).toContain('disabled=""');
    expect(markup).not.toContain('Water Pack');
    expect(markup).not.toContain('tier-ev');
  });

  test('falls back from unsupported modes and shared tiers to the first playable combination', () => {
    const resolved = resolveLobbySelection(capabilityFixture(), { mode: 'house', tier: 25 });

    expect(resolved).toEqual({
      mode: 'direct',
      modeReason: 'House play is not ready on Solana devnet.',
      pack: expect.objectContaining({ enabled: true, id: 'pokemon_50', tier: 50 }),
      tier: 50,
    });
  });

  test('never auto-selects house play when it is the only enabled mode', () => {
    const capabilities = capabilityFixture({ coreEnabled: false, houseEnabled: true });
    capabilities.modes.house = { ...capabilities.modes.house, enabled: true, reason: null };
    const markup = renderToStaticMarkup(
      <DuelModeTabs
        capabilities={capabilities}
        disabled={false}
        mode="direct"
        onSelect={() => undefined}
      />,
    );

    expect(resolveLobbySelection(capabilities, { mode: 'direct', tier: 50 }).mode).toBe('direct');
    expect(markup.match(/<button[^>]*id="mode-tab-house"[^>]*>/)?.[0]).toContain('tabindex="0"');
    expect(markup).not.toContain('aria-selected="true"');
  });

  test('fails closed when the server reports no playable combination', () => {
    const markup = renderToStaticMarkup(
      <ProductCapabilityPanel
        state={{
          status: 'ready',
          value: capabilityFixture({ coreEnabled: false }),
        }}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Duel play unavailable');
    expect(markup).toContain('Duel play is not ready on Solana devnet.');
    expect(markup).toContain('Check availability again');
  });

  test('shows a retry action instead of playable-looking controls after a capability error', () => {
    const markup = renderToStaticMarkup(
      <ProductCapabilityPanel
        state={{
          message: 'Product capabilities are unavailable (503).',
          retryable: true,
          status: 'error',
        }}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain('Product capabilities are unavailable (503).');
    expect(markup).toContain('Check availability again');
    expect(markup).not.toContain('Create $50 challenge');
  });

  test('does not offer an impossible retry when the API is not configured', () => {
    const markup = renderToStaticMarkup(
      <ProductCapabilityPanel
        state={{
          message: 'The duel API is not configured.',
          retryable: false,
          status: 'error',
        }}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain('The duel API is not configured.');
    expect(markup).not.toContain('Check availability again');
  });

  test('rejects malformed capability responses before lobby rendering', () => {
    const valid = capabilityFixture();
    const malformedResponses: unknown[] = [
      null,
      'not-an-object',
      {
        modes: valid.modes,
        network: 'solana-devnet',
        provider: { mode: 'dailydraft-devnet', ready: true },
      },
      { ...valid, modes: { ...valid.modes, direct: { enabled: true } } },
      { ...valid, packs: {} },
      {
        ...valid,
        packs: valid.packs.map((pack, index) => (index === 0 ? { ...pack, tier: 75 } : pack)),
      },
      {
        ...valid,
        modes: { ...valid.modes, direct: { enabled: true, reason: 503 } },
      },
      {
        ...valid,
        modes: {
          ...valid.modes,
          house: { enabled: false, reason: 'Unavailable.' },
        },
      },
      { ...valid, network: 'solana-mainnet' },
      { ...valid, provider: { mode: 'dailydraft-devnet' } },
      {
        ...valid,
        packs: valid.packs.map((pack, index) => (index === 0 ? { ...pack, reason: 503 } : pack)),
      },
    ];

    for (const response of malformedResponses) {
      expect(() => parseProductCapabilities(response)).toThrow(
        'Product capabilities are unavailable (malformed response).',
      );
    }

    expect(parseProductCapabilities(valid)).toEqual(capabilityFixture());
  });
});

function capabilityFixture({
  coreEnabled = true,
  houseEnabled = false,
  pack25Enabled = false,
  pack100Enabled = false,
}: {
  coreEnabled?: boolean;
  houseEnabled?: boolean;
  pack25Enabled?: boolean;
  pack100Enabled?: boolean;
} = {}): ProductCapabilities {
  const coreReason = coreEnabled ? null : 'Duel play is not ready on Solana devnet.';
  return {
    modes: {
      direct: { enabled: coreEnabled, reason: coreReason },
      house: {
        admission: {
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
        },
        enabled: coreEnabled && houseEnabled,
        reason: coreEnabled && houseEnabled ? null : 'House play is not ready on Solana devnet.',
      },
      open: { enabled: coreEnabled, reason: coreReason },
    },
    network: 'solana-devnet',
    packs: [
      {
        enabled: coreEnabled && pack25Enabled,
        id: 'pokemon_25',
        name: 'Pokémon $25 Pack',
        reason:
          coreEnabled && pack25Enabled ? null : (coreReason ?? 'The $25 pack tier is coming soon.'),
        tier: 25,
      },
      {
        enabled: coreEnabled,
        id: 'pokemon_50',
        name: 'Pokémon $50 Pack',
        reason: coreReason,
        tier: 50,
      },
      {
        enabled: coreEnabled && pack100Enabled,
        id: 'pokemon_100',
        name: 'Pokémon $100 Pack',
        reason:
          coreEnabled && pack100Enabled
            ? null
            : (coreReason ?? 'The $100 pack tier is coming soon.'),
        tier: 100,
      },
    ],
    provider: { mode: 'dailydraft-devnet', ready: coreEnabled },
  };
}
