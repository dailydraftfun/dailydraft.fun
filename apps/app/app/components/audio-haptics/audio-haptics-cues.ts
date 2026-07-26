import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import type { ChoreographyBeat } from '../choreography/choreography-motion';

export const audioHapticsStorageKey = 'dailydraft.audio-haptics.preference';

export const audioHapticsCueIds = ['anticipation', 'reveal', 'celebration'] as const;

export type AudioHapticsCueId = (typeof audioHapticsCueIds)[number];
export type StoredAudioHapticsPreference = 'enabled' | 'muted';

export type AudioHapticsCue = {
  gain: number;
  hapticPattern: readonly number[];
  id: AudioHapticsCueId;
};

export type InitialAudioHapticsPreference = {
  enabled: boolean;
  source: 'explicit-mute' | 'explicit-opt-in' | 'muted-default' | 'reduced-motion-default';
};

const gainByRarity: Record<PullRarity, number> = {
  chase: 1,
  common: 0.58,
  rare: 0.86,
  uncommon: 0.72,
};

const revealHaptics: Record<PullRarity, readonly number[]> = {
  chase: [28, 20, 36],
  common: [12],
  rare: [20, 18, 24],
  uncommon: [16],
};

const celebrationHaptics: Record<PullRarity, readonly number[]> = {
  chase: [40, 28, 50, 28, 60],
  common: [18],
  rare: [28, 24, 36],
  uncommon: [20, 20, 24],
};

export function audioHapticsCueFor(
  beat: ChoreographyBeat,
  rarity: PullRarity,
): AudioHapticsCue | null {
  switch (beat) {
    case 'anticipation':
      return cue('anticipation', 0.32, rarity, []);
    case 'reveal':
      return cue('reveal', 0.58, rarity, revealHaptics[rarity]);
    case 'celebrate':
      return cue('celebration', 0.72, rarity, celebrationHaptics[rarity]);
    case 'hold':
    case 'idle':
    case 'settled':
      return null;
  }
}

export function resolveInitialAudioHapticsPreference(
  storedPreference: string | null,
  prefersReducedMotion: boolean,
): InitialAudioHapticsPreference {
  if (storedPreference === 'enabled') {
    return { enabled: true, source: 'explicit-opt-in' };
  }
  if (storedPreference === 'muted') {
    return { enabled: false, source: 'explicit-mute' };
  }
  if (prefersReducedMotion) {
    return { enabled: false, source: 'reduced-motion-default' };
  }
  return { enabled: false, source: 'muted-default' };
}

function cue(
  id: AudioHapticsCueId,
  baseGain: number,
  rarity: PullRarity,
  hapticPattern: readonly number[],
): AudioHapticsCue {
  return {
    gain: Math.round(baseGain * gainByRarity[rarity] * 100) / 100,
    hapticPattern,
    id,
  };
}
