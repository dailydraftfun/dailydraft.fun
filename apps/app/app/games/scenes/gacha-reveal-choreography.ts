import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import { type ChoreographyBeat, createChoreographyTimeline } from '@dailydraft/engine';

export type GachaRevealFrame = Readonly<{
  beat: ChoreographyBeat;
  cardAlpha: number;
  cardRotation: number;
  cardScale: number;
  glareProgress: number;
  packAlpha: number;
  packRotation: number;
  packScale: number;
  settled: boolean;
}>;

export type GachaRevealParticle = Readonly<{
  endScale: number;
  lifetimeMs: number;
  radius: number;
  startScale: number;
  velocityX: number;
  velocityY: number;
}>;

const BURST_COUNTS = {
  chase: 64,
  common: 14,
  rare: 42,
  uncommon: 26,
} as const satisfies Record<PullRarity, number>;

const GOLDEN_ANGLE_RADIANS = Math.PI * (3 - Math.sqrt(5));

/**
 * Maps the server-committed gacha bands onto the engine's canonical rarity
 * vocabulary. This is presentation-only: it cannot select or modify a pull.
 */
export function engineRarityForGachaBand(band: 'base' | 'chase' | 'plus' | 'premium'): PullRarity {
  switch (band) {
    case 'base':
      return 'common';
    case 'plus':
      return 'uncommon';
    case 'premium':
      return 'rare';
    case 'chase':
      return 'chase';
  }
}

export function particleBurstCount(rarity: PullRarity): number {
  return BURST_COUNTS[rarity];
}

/**
 * Produces a stable broadcast-style burst without Math.random. Particle motion
 * may decorate the settled result, but never becomes another source of game
 * state or outcome selection.
 */
export function gachaRevealParticle(
  index: number,
  count: number,
  rarity: PullRarity,
): GachaRevealParticle {
  const safeCount = Math.max(1, Math.trunc(count));
  const safeIndex = Math.max(0, Math.trunc(index));
  const angle = safeIndex * GOLDEN_ANGLE_RADIANS;
  const ring = (safeIndex % 7) / 6;
  const rarityVelocity = {
    chase: 152,
    common: 78,
    rare: 128,
    uncommon: 102,
  } satisfies Record<PullRarity, number>;
  const speed = rarityVelocity[rarity] * (0.72 + ring * 0.36);
  const sizeCycle = safeIndex % 5;

  return {
    endScale: 0.25,
    lifetimeMs: 620 + Math.round((safeIndex / safeCount) * 360),
    radius: 1.8 + sizeCycle * 0.55,
    startScale: 0.82 + sizeCycle * 0.07,
    velocityX: Math.cos(angle) * speed,
    velocityY: Math.sin(angle) * speed - 22,
  };
}

export function gachaRevealFrameAt(rarity: PullRarity, elapsedMs: number): GachaRevealFrame {
  const timeline = createChoreographyTimeline(rarity);
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const active = timeline.find((entry) => safeElapsed < entry.endsAtMs);

  if (!active) {
    return settledFrame();
  }

  const progress =
    active.durationMs === 0 ? 1 : clamp01((safeElapsed - active.startsAtMs) / active.durationMs);
  const eased = smoothstep(progress);

  switch (active.beat) {
    case 'anticipation':
      return {
        ...sealedFrame('anticipation'),
        packRotation: Math.sin(progress * Math.PI * 6) * 0.018 * active.intensity,
        packScale: 1 + eased * 0.035 * active.intensity,
      };
    case 'hold':
      return {
        ...sealedFrame('hold'),
        packRotation: Math.sin(progress * Math.PI * 8) * 0.03 * active.intensity,
        packScale: 1.02 + eased * 0.025,
      };
    case 'reveal':
      return {
        beat: 'reveal',
        cardAlpha: clamp01((progress - 0.12) / 0.46),
        cardRotation: (1 - eased) * 0.1,
        cardScale: 0.78 + eased * 0.22,
        glareProgress: clamp01((progress - 0.42) / 0.58),
        packAlpha: 1 - clamp01(progress / 0.48),
        packRotation: -eased * 0.08,
        packScale: 1.04 - eased * 0.18,
        settled: false,
      };
    case 'celebrate':
      return {
        beat: 'celebrate',
        cardAlpha: 1,
        cardRotation: Math.sin(progress * Math.PI) * 0.008 * active.intensity,
        cardScale: 1 + Math.sin(progress * Math.PI) * 0.045 * active.intensity,
        glareProgress: progress,
        packAlpha: 0,
        packRotation: -0.08,
        packScale: 0.86,
        settled: false,
      };
  }
}

export function gachaRevealDurationMs(rarity: PullRarity): number {
  return createChoreographyTimeline(rarity).at(-1)?.endsAtMs ?? 0;
}

function sealedFrame(beat: 'anticipation' | 'hold'): GachaRevealFrame {
  return {
    beat,
    cardAlpha: 0,
    cardRotation: 0.1,
    cardScale: 0.78,
    glareProgress: 0,
    packAlpha: 1,
    packRotation: 0,
    packScale: 1,
    settled: false,
  };
}

function settledFrame(): GachaRevealFrame {
  return {
    beat: 'settled',
    cardAlpha: 1,
    cardRotation: 0,
    cardScale: 1,
    glareProgress: 1,
    packAlpha: 0,
    packRotation: -0.08,
    packScale: 0.86,
    settled: true,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}
