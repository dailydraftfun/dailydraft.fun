import { describe, expect, test } from 'bun:test';
import { THEME_PROVIDER_SOURCE_SCHEMA_VERSION } from '@dailydraft/contracts/theme-pack';

import { COLLECTOR_CRYPT_THEME } from './collector-crypt.js';
import { DEVNET_DEMO_THEME } from './devnet-demo.js';
import { resolveThemePack, themeCssVariables, themeScenePresentation } from './index.js';

describe('theme-pack pipeline', () => {
  test('restyles one scene by swapping data with no theme-specific scene branches', () => {
    const demo = resolveThemePack(DEVNET_DEMO_THEME, {
      displayName: 'Demo collectible',
      kind: 'bundled',
      rarity: 'rare',
    });
    const collector = resolveThemePack(COLLECTOR_CRYPT_THEME, {
      kind: 'gated-provider',
      source: collectorSource(),
    });

    expect(demo.status).toBe('resolved');
    expect(collector.status).toBe('resolved');
    if (demo.status !== 'resolved' || collector.status !== 'resolved') {
      throw new Error('Expected both test themes to resolve');
    }

    const renderScene = themeScenePresentation;
    expect(renderScene(demo.theme)).not.toEqual(renderScene(collector.theme));
    expect(renderScene(demo.theme)).toMatchObject({
      foil: DEVNET_DEMO_THEME.rarities.rare.foil,
      rarityAccentColor: 0x9f8cff,
    });
    expect(renderScene(collector.theme)).toMatchObject({
      foil: COLLECTOR_CRYPT_THEME.rarities.chase.foil,
      rarityAccentColor: 0xffd86b,
    });
    expect(themeCssVariables(demo.theme)).toEqual({
      '--theme-background': '#151C35',
      '--theme-foil-intensity': '0.66',
      '--theme-foil-refraction': '0.58',
      '--theme-foil-speed': '0.5',
      '--theme-glow': '#D1C8FF',
      '--theme-rarity-accent': '#9F8CFF',
    });
  });

  test('keeps the Collector Crypt theme unavailable without a gated source', () => {
    expect(
      resolveThemePack(COLLECTOR_CRYPT_THEME, {
        displayName: 'Forged collectible',
        kind: 'bundled',
        rarity: 'chase',
      }),
    ).toEqual({ reason: 'provider-gate-closed', status: 'unavailable' });
    expect(
      resolveThemePack(COLLECTOR_CRYPT_THEME, {
        kind: 'gated-provider',
        source: null,
      }),
    ).toEqual({ reason: 'invalid-provider-source', status: 'unavailable' });
  });

  test('rejects sandbox mode, malformed evidence, remote art gaps, and direct rarity input', () => {
    const valid = collectorSource();
    const candidates = [
      { ...valid, providerMode: 'collector-crypt-sandbox' },
      { ...valid, policyHash: 'not-a-hash' },
      { ...valid, art: { ...valid.art, cardImage: '/local-bypass.svg' } },
      {
        ...valid,
        insuredValue: { ...valid.insuredValue, amount: 'not-minor-units' },
        rarity: 'chase',
      },
    ];

    for (const source of candidates) {
      expect(resolveThemePack(COLLECTOR_CRYPT_THEME, { kind: 'gated-provider', source })).toEqual({
        reason: 'invalid-provider-source',
        status: 'unavailable',
      });
    }
  });

  test('derives Collector Crypt rarity only from the gated insured value', () => {
    const rare = resolveThemePack(COLLECTOR_CRYPT_THEME, {
      kind: 'gated-provider',
      source: {
        ...collectorSource(),
        insuredValue: { amount: '50000000', currency: 'USDC', decimals: 6 },
      },
    });

    expect(rare.status).toBe('resolved');
    if (rare.status !== 'resolved') throw new Error('Expected gated source to resolve');
    expect(rare.theme.card).toEqual({
      displayName: 'Provider-authenticated collectible',
      providerReference: 'collector-crypt:pack:fixture-001',
      rarity: 'rare',
      sourceTimestamp: '2026-07-27T10:00:00.000Z',
    });
  });

  test('rejects a gated source for the bundled devnet pack', () => {
    expect(
      resolveThemePack(DEVNET_DEMO_THEME, {
        kind: 'gated-provider',
        source: collectorSource(),
      }),
    ).toEqual({ reason: 'source-kind-mismatch', status: 'unavailable' });
  });
});

function collectorSource() {
  return {
    approvalReference: 'approval:collector-crypt:fixture-001',
    art: {
      background: 'https://provider.example.test/background.png',
      cardBack: 'https://provider.example.test/card-back.png',
      cardFrame: 'https://provider.example.test/card-frame.png',
      cardImage: 'https://provider.example.test/card.png',
      packBack: 'https://provider.example.test/pack-back.png',
      packFront: 'https://provider.example.test/pack-front.png',
    },
    contractVersion: 'collector-crypt.partner.v1',
    displayName: 'Provider-authenticated collectible',
    insuredValue: { amount: '150000000', currency: 'USDC', decimals: 6 },
    policyHash: 'a'.repeat(64),
    policyVersion: 'dailydraft.real-value-policy.fixture.v1',
    provider: 'collector-crypt',
    providerMode: 'collector-crypt-production',
    providerReference: 'collector-crypt:pack:fixture-001',
    rollbackReference: 'runbook:collector-crypt:rollback-v1',
    schemaVersion: THEME_PROVIDER_SOURCE_SCHEMA_VERSION,
    sourceTimestamp: '2026-07-27T10:00:00.000Z',
  } as const;
}
