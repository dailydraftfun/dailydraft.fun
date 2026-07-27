import { BlurFilter, type BlurFilterOptions, type Container, type ContainerChild } from 'pixi.js';

import { QUALITY_BUDGETS, type QualityBudget, type QualityTier } from './quality.js';

export type ParticleSpawn<T extends ContainerChild> = Readonly<{
  display: T;
  endScale?: number;
  lifetimeMs: number;
  spinRadiansPerSecond?: number;
  startScale?: number;
  velocityX: number;
  velocityY: number;
}>;

export type ParticleFactory<T extends ContainerChild> = (
  index: number,
  tier: QualityTier,
) => ParticleSpawn<T>;

type ActiveParticle<T extends ContainerChild> = ParticleSpawn<T> & {
  ageMs: number;
};

export class ParticleEmitter<T extends ContainerChild> {
  private readonly particles: ActiveParticle<T>[] = [];
  private currentTier: QualityTier;

  constructor(
    private readonly container: Container<T>,
    tier: QualityTier = 'high',
  ) {
    this.currentTier = tier;
  }

  get activeCount(): number {
    return this.particles.length;
  }

  emitBurst(requestedCount: number, factory: ParticleFactory<T>): number {
    const budget = QUALITY_BUDGETS[this.currentTier];
    const available = Math.max(0, budget.maxParticles - this.particles.length);
    const count = Math.min(nonNegativeInteger(requestedCount), available);
    let emitted = 0;

    for (let index = 0; index < count; index += 1) {
      const spawn = factory(index, this.currentTier);
      if (!Number.isFinite(spawn.lifetimeMs) || spawn.lifetimeMs <= 0) continue;

      const startScale = spawn.startScale ?? 1;
      spawn.display.scale.set(startScale);
      this.container.addChild(spawn.display);
      this.particles.push({ ...spawn, ageMs: 0 });
      emitted += 1;
    }

    return emitted;
  }

  update(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;

    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (!particle) continue;

      particle.ageMs += elapsedMs;
      if (particle.ageMs >= particle.lifetimeMs) {
        this.removeAt(index);
        continue;
      }

      const progress = particle.ageMs / particle.lifetimeMs;
      const elapsedSeconds = elapsedMs / 1_000;
      particle.display.x += particle.velocityX * elapsedSeconds;
      particle.display.y += particle.velocityY * elapsedSeconds;
      particle.display.rotation += (particle.spinRadiansPerSecond ?? 0) * elapsedSeconds;
      particle.display.alpha = 1 - progress;
      const startScale = particle.startScale ?? 1;
      const endScale = particle.endScale ?? startScale;
      particle.display.scale.set(startScale + (endScale - startScale) * progress);
    }
  }

  setQuality(tier: QualityTier): void {
    this.currentTier = tier;
    const maxParticles = QUALITY_BUDGETS[tier].maxParticles;
    while (this.particles.length > maxParticles) this.removeAt(this.particles.length - 1);
  }

  clear(): void {
    while (this.particles.length > 0) this.removeAt(this.particles.length - 1);
  }

  private removeAt(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    if (!particle) return;
    this.container.removeChild(particle.display);
    particle.display.destroy({ children: true });
  }
}

export type BlurFilterFactory = (options: BlurFilterOptions) => BlurFilter;

const defaultBlurFilterFactory: BlurFilterFactory = (options) => new BlurFilter(options);

export function createGlowFilter(
  tier: QualityTier,
  createFilter: BlurFilterFactory = defaultBlurFilterFactory,
): BlurFilter | null {
  return createBudgetedBlur(QUALITY_BUDGETS[tier], 'glowStrength', createFilter);
}

export function createBloomFilter(
  tier: QualityTier,
  createFilter: BlurFilterFactory = defaultBlurFilterFactory,
): BlurFilter | null {
  return createBudgetedBlur(QUALITY_BUDGETS[tier], 'bloomStrength', createFilter);
}

function createBudgetedBlur(
  budget: QualityBudget,
  strength: 'bloomStrength' | 'glowStrength',
  createFilter: BlurFilterFactory,
): BlurFilter | null {
  if (budget.blurQuality === 0 || budget[strength] === 0) return null;
  return createFilter({
    kernelSize: budget.blurQuality >= 3 ? 9 : 5,
    quality: budget.blurQuality,
    strength: budget[strength],
  });
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
