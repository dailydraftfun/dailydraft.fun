import { type PullRarity, pullRarityFor } from '@dailydraft/contracts/pull-rarity';
import {
  assertThemePackDefinition,
  THEME_PROVIDER_SOURCE_SCHEMA_VERSION,
  type ThemeArtSlot,
  type ThemeAudioCue,
  type ThemePackDefinition,
  type ThemeProviderSource,
  type ThemeRarityPalette,
  themeArtSlots,
  themeAudioCues,
} from '@dailydraft/contracts/theme-pack';

export { COLLECTOR_CRYPT_THEME } from './collector-crypt';
export { DEVNET_DEMO_THEME } from './devnet-demo';

export type ThemeCardPresentation = Readonly<{
  displayName: string;
  providerReference: string | null;
  rarity: PullRarity;
  sourceTimestamp: string | null;
}>;

export type ResolvedThemePack = Readonly<{
  art: Readonly<Record<ThemeArtSlot, string>>;
  audio: Readonly<Record<ThemeAudioCue, string | null>>;
  card: ThemeCardPresentation;
  displayName: string;
  id: string;
  palette: ThemeRarityPalette;
}>;

export type ThemePackUnavailableReason =
  | 'invalid-provider-source'
  | 'provider-gate-closed'
  | 'source-kind-mismatch';

export type ThemePackResolution =
  | { reason: ThemePackUnavailableReason; status: 'unavailable' }
  | { status: 'resolved'; theme: ResolvedThemePack };

export type BundledThemeInput = Readonly<{
  displayName: string;
  kind: 'bundled';
  rarity: PullRarity;
}>;

export type GatedThemeInput = Readonly<{
  kind: 'gated-provider';
  source: unknown;
}>;

export type ThemePackInput = BundledThemeInput | GatedThemeInput;

export type ThemeScenePresentation = Readonly<{
  backgroundColor: number;
  backgroundImage: string;
  cardBackImage: string;
  cardFrameImage: string;
  cardImage: string;
  foil: ThemeRarityPalette['foil'];
  glowColor: number;
  packBackImage: string;
  packFrontImage: string;
  rarityAccentColor: number;
}>;

export function resolveThemePack(
  definition: ThemePackDefinition,
  input: ThemePackInput,
): ThemePackResolution {
  assertThemePackDefinition(definition);
  if (definition.source.kind === 'bundled') {
    if (input.kind !== 'bundled') {
      return { reason: 'source-kind-mismatch', status: 'unavailable' };
    }
    return {
      status: 'resolved',
      theme: resolvedTheme(definition, bundledArt(definition), {
        displayName: input.displayName,
        providerReference: null,
        rarity: input.rarity,
        sourceTimestamp: null,
      }),
    };
  }

  if (input.kind !== 'gated-provider') {
    return { reason: 'provider-gate-closed', status: 'unavailable' };
  }
  if (!isThemeProviderSource(input.source)) {
    return { reason: 'invalid-provider-source', status: 'unavailable' };
  }
  const source = input.source;
  if (
    source.provider !== definition.source.provider ||
    source.providerMode !== definition.source.providerMode
  ) {
    return { reason: 'provider-gate-closed', status: 'unavailable' };
  }

  const rarity = pullRarityFor(BigInt(source.insuredValue.amount), source.insuredValue.decimals);
  return {
    status: 'resolved',
    theme: resolvedTheme(definition, source.art, {
      displayName: source.displayName,
      providerReference: source.providerReference,
      rarity,
      sourceTimestamp: source.sourceTimestamp,
    }),
  };
}

export function themeScenePresentation(theme: ResolvedThemePack): ThemeScenePresentation {
  return {
    backgroundColor: hexColorToNumber(theme.palette.background),
    backgroundImage: theme.art.background,
    cardBackImage: theme.art.cardBack,
    cardFrameImage: theme.art.cardFrame,
    cardImage: theme.art.cardImage,
    foil: theme.palette.foil,
    glowColor: hexColorToNumber(theme.palette.glow),
    packBackImage: theme.art.packBack,
    packFrontImage: theme.art.packFront,
    rarityAccentColor: hexColorToNumber(theme.palette.accent),
  };
}

export function themeCssVariables(theme: ResolvedThemePack): Readonly<Record<string, string>> {
  return {
    '--theme-background': theme.palette.background,
    '--theme-foil-intensity': String(theme.palette.foil.intensity),
    '--theme-foil-refraction': String(theme.palette.foil.refraction),
    '--theme-foil-speed': String(theme.palette.foil.speed),
    '--theme-glow': theme.palette.glow,
    '--theme-rarity-accent': theme.palette.accent,
  };
}

function bundledArt(definition: ThemePackDefinition): Record<ThemeArtSlot, string> {
  return Object.fromEntries(
    themeArtSlots.map((slot) => {
      const asset = definition.art[slot];
      if (asset.kind !== 'bundled') {
        throw new Error(`Bundled theme ${definition.id} has unresolved provider art`);
      }
      return [slot, asset.uri];
    }),
  ) as Record<ThemeArtSlot, string>;
}

function resolvedTheme(
  definition: ThemePackDefinition,
  art: Readonly<Record<ThemeArtSlot, string>>,
  card: ThemeCardPresentation,
): ResolvedThemePack {
  return {
    art,
    audio: Object.fromEntries(
      themeAudioCues.map((cue) => [cue, definition.audio[cue]?.uri ?? null]),
    ) as Record<ThemeAudioCue, string | null>,
    card,
    displayName: definition.displayName,
    id: definition.id,
    palette: definition.rarities[card.rarity],
  };
}

function isThemeProviderSource(value: unknown): value is ThemeProviderSource {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== THEME_PROVIDER_SOURCE_SCHEMA_VERSION ||
    value.provider !== 'collector-crypt' ||
    value.providerMode !== 'collector-crypt-production' ||
    !isReference(value.approvalReference) ||
    !isReference(value.contractVersion) ||
    !isReference(value.policyVersion) ||
    !isHash(value.policyHash) ||
    !isReference(value.providerReference) ||
    !isReference(value.rollbackReference) ||
    !isNonEmpty(value.displayName) ||
    !isIsoTimestamp(value.sourceTimestamp)
  ) {
    return false;
  }
  const insuredValue = value.insuredValue;
  if (
    !isRecord(insuredValue) ||
    !/^[0-9]+$/.test(String(insuredValue.amount)) ||
    insuredValue.currency !== 'USDC' ||
    !Number.isInteger(insuredValue.decimals) ||
    Number(insuredValue.decimals) < 0 ||
    Number(insuredValue.decimals) > 18
  ) {
    return false;
  }
  const art = value.art;
  if (!isRecord(art)) return false;
  return themeArtSlots.every((slot) => isHttpsUrl(art[slot]));
}

function hexColorToNumber(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isReference(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/.test(value);
}
