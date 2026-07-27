import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import {
  type ThemeArtReferences,
  type ThemePack,
  type ThemeRarityTreatment,
  validateThemePack,
} from '@dailydraft/contracts/theme-pack';

export type ResolvedThemePack = Readonly<{
  art: ThemeArtReferences;
  audio: ThemePack['audio'];
  id: string;
  name: string;
  rarity: ThemePack['rarity'];
  version: string;
}>;

export type ThemeResolution =
  | Readonly<{
      reason: 'invalid-theme-pack' | 'provider-gate-closed';
      status: 'unavailable';
    }>
  | Readonly<{
      status: 'ready';
      theme: ResolvedThemePack;
    }>;

export type SceneThemeStyle = Readonly<{
  art: ThemeArtReferences;
  audio: ThemePack['audio'];
  rarity: PullRarity;
  themeId: string;
  treatment: ThemeRarityTreatment;
}>;

export type SceneThemeAdapter = Readonly<{
  applyTheme(style: SceneThemeStyle): void;
}>;

function resolvedTheme(pack: ThemePack): ResolvedThemePack {
  return {
    art: pack.art,
    audio: pack.audio,
    id: pack.id,
    name: pack.name,
    rarity: pack.rarity,
    version: pack.version,
  };
}

export function resolveThemePack(pack: unknown): ThemeResolution {
  const validation = validateThemePack(pack);
  if (!validation.ok) return { reason: 'invalid-theme-pack', status: 'unavailable' };

  const validPack = validation.value;
  if (validPack.source.kind === 'provider') {
    // #165 owns the Collector Crypt partner adapter. Until that adapter can
    // call PackProvider.verifyOpenedSnapshot, provider themes have no ready
    // path here and cannot be unlocked by caller-supplied client data.
    return { reason: 'provider-gate-closed', status: 'unavailable' };
  }

  return {
    status: 'ready',
    theme: resolvedTheme(validPack),
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
    rarity,
    themeId: theme.id,
    treatment: theme.rarity[rarity],
  });
}
