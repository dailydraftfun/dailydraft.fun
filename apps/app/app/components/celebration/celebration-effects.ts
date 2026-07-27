import {
  PULL_RARITY_FLOORS_USD,
  type PullRarity,
  pullRarityLabel,
} from '@dailydraft/contracts/pull-rarity';

export type CelebrationScreenAccent = 'none' | 'edge' | 'full';

export type CelebrationEffectProfile = {
  burstCount: number;
  durationMs: number;
  glowIntensity: number;
  palette: readonly string[];
  particleCount: number;
  particleSizePx: number;
  screenAccent: CelebrationScreenAccent;
  spread: number;
};

export type CelebrationParticle = {
  color: string;
  delayMs: number;
  lifeMs: number;
  rotation: number;
  sizePx: number;
  spin: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

const rarityProfiles: Record<PullRarity, CelebrationEffectProfile> = {
  chase: {
    burstCount: 2,
    durationMs: 600,
    glowIntensity: 1,
    palette: ['#dfff70', '#ffffff', '#73fbd3', '#ffda65'],
    particleCount: 84,
    particleSizePx: 5.5,
    screenAccent: 'full',
    spread: 1,
  },
  common: {
    burstCount: 1,
    durationMs: 280,
    glowIntensity: 0.18,
    palette: ['#dfff70', '#ffffff'],
    particleCount: 12,
    particleSizePx: 2.5,
    screenAccent: 'none',
    spread: 0.42,
  },
  rare: {
    burstCount: 1,
    durationMs: 470,
    glowIntensity: 0.72,
    palette: ['#dfff70', '#73fbd3', '#ffffff'],
    particleCount: 52,
    particleSizePx: 4.5,
    screenAccent: 'edge',
    spread: 0.82,
  },
  uncommon: {
    burstCount: 1,
    durationMs: 360,
    glowIntensity: 0.42,
    palette: ['#dfff70', '#ffffff', '#73fbd3'],
    particleCount: 28,
    particleSizePx: 3.5,
    screenAccent: 'edge',
    spread: 0.62,
  },
};

const rarityFloorUsd = new Map(
  PULL_RARITY_FLOORS_USD.map((floor) => [floor.rarity, floor.minUsd] as const),
);
const chaseFloorUsd = rarityFloorUsd.get('chase');
const rareFloorUsd = rarityFloorUsd.get('rare');
const uncommonFloorUsd = rarityFloorUsd.get('uncommon');

const rarityRanges: Record<PullRarity, readonly [number, number] | null> = {
  chase: chaseFloorUsd === undefined ? null : [chaseFloorUsd, chaseFloorUsd * 4],
  common: uncommonFloorUsd === undefined ? null : [0, uncommonFloorUsd],
  rare:
    rareFloorUsd === undefined || chaseFloorUsd === undefined
      ? null
      : [rareFloorUsd, chaseFloorUsd],
  uncommon:
    uncommonFloorUsd === undefined || rareFloorUsd === undefined
      ? null
      : [uncommonFloorUsd, rareFloorUsd],
};

export function celebrationEffectProfileFor(
  rarity: PullRarity,
  valueUsd?: number | null,
): CelebrationEffectProfile {
  const base = rarityProfiles[rarity];
  const valueProgress = celebrationValueProgress(rarity, valueUsd);
  const valueScale = 1 + valueProgress * 0.25;

  return {
    ...base,
    glowIntensity: round(base.glowIntensity * (1 + valueProgress * 0.12), 3),
    palette: [...base.palette],
    particleCount: Math.round(base.particleCount * valueScale),
    particleSizePx: round(base.particleSizePx * (1 + valueProgress * 0.1), 2),
  };
}

export function celebrationStaticLabel(rarity: PullRarity): string {
  return `${pullRarityLabel(rarity)} revealed`;
}

export function spawnCelebrationParticles(
  profile: CelebrationEffectProfile,
  random: () => number = Math.random,
): CelebrationParticle[] {
  return Array.from({ length: profile.particleCount }, (_, index) => {
    const burstIndex = index % profile.burstCount;
    const direction = random() * Math.PI * 2;
    const speed = (0.22 + random() * 0.34) * profile.spread;

    return {
      color:
        profile.palette[
          Math.min(profile.palette.length - 1, Math.floor(random() * profile.palette.length))
        ],
      delayMs: burstIndex * Math.min(150, profile.durationMs * 0.24),
      lifeMs: profile.durationMs * (0.72 + random() * 0.28),
      rotation: random() * Math.PI,
      sizePx: profile.particleSizePx * (0.65 + random() * 0.7),
      spin: (random() - 0.5) * 8,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed - 0.22,
      x: 0.5,
      y: 0.54,
    };
  });
}

export function stepCelebrationParticle(
  particle: CelebrationParticle,
  deltaMs: number,
): CelebrationParticle {
  const deltaSeconds = Math.max(0, Math.min(deltaMs, 32)) / 1_000;

  if (particle.delayMs > 0) {
    particle.delayMs = Math.max(0, particle.delayMs - Math.max(0, deltaMs));
    return particle;
  }

  particle.lifeMs -= Math.max(0, deltaMs);
  particle.x += particle.vx * deltaSeconds;
  particle.y += particle.vy * deltaSeconds;
  particle.vy += 0.72 * deltaSeconds;
  particle.rotation += particle.spin * deltaSeconds;
  return particle;
}

export function particleOpacity(particle: CelebrationParticle, durationMs: number): number {
  if (particle.delayMs > 0 || particle.lifeMs <= 0) return 0;
  return Math.max(0, Math.min(1, particle.lifeMs / Math.max(1, durationMs * 0.38)));
}

function celebrationValueProgress(rarity: PullRarity, valueUsd?: number | null): number {
  if (valueUsd == null || !Number.isFinite(valueUsd) || valueUsd < 0) return 0;
  const range = rarityRanges[rarity];
  if (!range) return 0;
  const [minimum, maximum] = range;
  return Math.max(0, Math.min(1, (valueUsd - minimum) / Math.max(1, maximum - minimum)));
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
