import { describe, expect, test } from 'bun:test';
import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import { audioHapticsCueFor, resolveInitialAudioHapticsPreference } from './audio-haptics-cues';

const rarities: PullRarity[] = ['common', 'uncommon', 'rare', 'chase'];

describe('audio and haptics cue policy', () => {
  test('maps every audible choreography beat and scales gain by canonical rarity', () => {
    const anticipation = rarities.map((rarity) => audioHapticsCueFor('anticipation', rarity));
    const reveal = rarities.map((rarity) => audioHapticsCueFor('reveal', rarity));
    const celebration = rarities.map((rarity) => audioHapticsCueFor('celebrate', rarity));

    expect(anticipation.map((cue) => cue?.id)).toEqual([
      'anticipation',
      'anticipation',
      'anticipation',
      'anticipation',
    ]);
    expect(reveal.map((cue) => cue?.gain)).toEqual([0.34, 0.42, 0.5, 0.58]);
    expect(celebration.map((cue) => cue?.gain)).toEqual([0.42, 0.52, 0.62, 0.72]);
    expect(celebration.map((cue) => cue?.id)).toEqual([
      'celebration',
      'celebration',
      'celebration',
      'celebration',
    ]);
  });

  test('limits haptics to reveal and celebration moments with rarity-scaled patterns', () => {
    expect(audioHapticsCueFor('anticipation', 'chase')?.hapticPattern).toEqual([]);
    expect(audioHapticsCueFor('reveal', 'common')?.hapticPattern).toEqual([12]);
    expect(audioHapticsCueFor('reveal', 'chase')?.hapticPattern).toEqual([28, 20, 36]);
    expect(audioHapticsCueFor('celebrate', 'common')?.hapticPattern).toEqual([18]);
    expect(audioHapticsCueFor('celebrate', 'chase')?.hapticPattern).toEqual([40, 28, 50, 28, 60]);
  });

  test('leaves non-cue beats silent without changing choreography semantics', () => {
    expect(audioHapticsCueFor('idle', 'rare')).toBeNull();
    expect(audioHapticsCueFor('hold', 'rare')).toBeNull();
    expect(audioHapticsCueFor('settled', 'rare')).toBeNull();
  });

  test('requires an explicit stored opt-in and records the reduced-motion default reason', () => {
    expect(resolveInitialAudioHapticsPreference('enabled', true)).toEqual({
      enabled: true,
      source: 'explicit-opt-in',
    });
    expect(resolveInitialAudioHapticsPreference('muted', false)).toEqual({
      enabled: false,
      source: 'explicit-mute',
    });
    expect(resolveInitialAudioHapticsPreference(null, true)).toEqual({
      enabled: false,
      source: 'reduced-motion-default',
    });
    expect(resolveInitialAudioHapticsPreference('invalid', false)).toEqual({
      enabled: false,
      source: 'muted-default',
    });
  });
});
