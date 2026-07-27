export const qualityTiers = ['low', 'medium', 'high'] as const;

export type QualityTier = (typeof qualityTiers)[number];

export type QualityBudget = Readonly<{
  bloomStrength: number;
  blurQuality: number;
  glowStrength: number;
  maxFps: number;
  maxParticles: number;
  resolutionScale: number;
}>;

export const QUALITY_BUDGETS = {
  high: {
    bloomStrength: 10,
    blurQuality: 3,
    glowStrength: 12,
    maxFps: 60,
    maxParticles: 96,
    resolutionScale: 2,
  },
  low: {
    bloomStrength: 0,
    blurQuality: 0,
    glowStrength: 0,
    maxFps: 30,
    maxParticles: 16,
    resolutionScale: 1,
  },
  medium: {
    bloomStrength: 6,
    blurQuality: 2,
    glowStrength: 7,
    maxFps: 45,
    maxParticles: 48,
    resolutionScale: 1.5,
  },
} as const satisfies Record<QualityTier, QualityBudget>;

export type FrameBudgetMonitorOptions = Readonly<{
  initialTier?: QualityTier;
  sampleSize?: number;
  slowFrameRatio?: number;
  tolerance?: number;
}>;

export class FrameBudgetMonitor {
  private readonly sampleSize: number;
  private readonly samples: number[] = [];
  private readonly slowFrameRatio: number;
  private readonly tolerance: number;
  private currentTier: QualityTier;

  constructor(options: FrameBudgetMonitorOptions = {}) {
    this.currentTier = options.initialTier ?? 'high';
    this.sampleSize = positiveInteger(options.sampleSize, 30);
    this.slowFrameRatio = unitInterval(options.slowFrameRatio, 0.4);
    this.tolerance = positiveNumber(options.tolerance, 1.25);
  }

  get tier(): QualityTier {
    return this.currentTier;
  }

  recordFrame(elapsedMs: number): QualityTier {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || this.currentTier === 'low') {
      return this.currentTier;
    }

    this.samples.push(elapsedMs);
    if (this.samples.length < this.sampleSize) return this.currentTier;

    const frameBudgetMs = 1_000 / QUALITY_BUDGETS[this.currentTier].maxFps;
    const slowFrames = this.samples.filter(
      (sample) => sample > frameBudgetMs * this.tolerance,
    ).length;
    this.samples.length = 0;

    if (slowFrames / this.sampleSize >= this.slowFrameRatio) {
      this.currentTier = lowerQualityTier(this.currentTier);
    }

    return this.currentTier;
  }
}

export function lowerQualityTier(tier: QualityTier): QualityTier {
  switch (tier) {
    case 'high':
      return 'medium';
    case 'medium':
    case 'low':
      return 'low';
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? value : fallback;
}

function unitInterval(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}
