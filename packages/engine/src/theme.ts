import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import {
  THEME_ART_SLOTS,
  THEME_PROVIDER_ASSET_SCHEMA_VERSION,
  type ThemeArtReferences,
  type ThemePack,
  type ThemeProviderAssetSnapshot,
  type ThemeRarityTreatment,
  validateThemePack,
} from '@dailydraft/contracts/theme-pack';

export type ResolvedThemePack = Readonly<{
  art: ThemeArtReferences;
  audio: ThemePack['audio'];
  id: string;
  metadata: Readonly<Record<string, string>>;
  name: string;
  rarity: ThemePack['rarity'];
  version: string;
}>;

export type ThemeResolution =
  | Readonly<{
      reason:
        | 'invalid-provider-snapshot'
        | 'invalid-theme-pack'
        | 'provider-assets-incomplete'
        | 'provider-gate-closed'
        | 'provider-snapshot-mismatch';
      status: 'unavailable';
    }>
  | Readonly<{
      status: 'ready';
      theme: ResolvedThemePack;
    }>;

export type SceneThemeStyle = Readonly<{
  art: ThemeArtReferences;
  audio: ThemePack['audio'];
  metadata: Readonly<Record<string, string>>;
  rarity: PullRarity;
  themeId: string;
  treatment: ThemeRarityTreatment;
}>;

export type SceneThemeAdapter = Readonly<{
  applyTheme(style: SceneThemeStyle): void;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isProviderSnapshot(value: unknown): value is ThemeProviderAssetSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === THEME_PROVIDER_ASSET_SCHEMA_VERSION &&
    value.provider === 'collector-crypt' &&
    value.providerMode === 'collector-crypt-sandbox' &&
    typeof value.themeId === 'string' &&
    typeof value.themeVersion === 'string' &&
    isStringRecord(value.assets) &&
    isStringRecord(value.metadata)
  );
}

function resolvedTheme(
  pack: ThemePack,
  art: ThemeArtReferences,
  metadata: Readonly<Record<string, string>>,
): ResolvedThemePack {
  return {
    art,
    audio: pack.audio,
    id: pack.id,
    metadata,
    name: pack.name,
    rarity: pack.rarity,
    version: pack.version,
  };
}

export function resolveThemePack(pack: unknown, providerSnapshot?: unknown): ThemeResolution {
  const validation = validateThemePack(pack);
  if (!validation.ok) return { reason: 'invalid-theme-pack', status: 'unavailable' };

  const validPack = validation.value;
  if (validPack.source.kind === 'bundled') {
    return {
      status: 'ready',
      theme: resolvedTheme(validPack, validPack.art, {}),
    };
  }

  if (providerSnapshot === undefined) {
    return { reason: 'provider-gate-closed', status: 'unavailable' };
  }
  if (!isProviderSnapshot(providerSnapshot)) {
    return { reason: 'invalid-provider-snapshot', status: 'unavailable' };
  }
  if (
    providerSnapshot.provider !== validPack.source.provider ||
    providerSnapshot.providerMode !== validPack.source.mode ||
    providerSnapshot.themeId !== validPack.id ||
    providerSnapshot.themeVersion !== validPack.version
  ) {
    return { reason: 'provider-snapshot-mismatch', status: 'unavailable' };
  }

  const resolvedArt = {} as Record<(typeof THEME_ART_SLOTS)[number], string>;
  for (const slot of THEME_ART_SLOTS) {
    const asset = providerSnapshot.assets[validPack.art[slot]];
    if (typeof asset !== 'string' || asset.length === 0) {
      return { reason: 'provider-assets-incomplete', status: 'unavailable' };
    }
    resolvedArt[slot] = asset;
  }

  return {
    status: 'ready',
    theme: resolvedTheme(validPack, resolvedArt, providerSnapshot.metadata),
  };
}

export function applyThemeToScene(
  scene: SceneThemeAdapter,
  theme: ResolvedThemePack,
  rarity: PullRarity,
): void {
  scene.applyTheme({
    art: theme.art,
    audio: theme.audio,
    metadata: theme.metadata,
    rarity,
    themeId: theme.id,
    treatment: theme.rarity[rarity],
  });
}
