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
    maxFps: 60,
    maxParticles: 48,
    resolutionScale: 1.5,
  },
} as const satisfies Record<QualityTier, QualityBudget>;

export type FrameBudgetMonitorOptions = Readonly<{
  initialTier?: QualityTier;
  minimumFps?: number;
  p95FrameMs?: number;
  requiredSlowWindows?: number;
  windowSize?: number;
}>;

export class FrameBudgetMonitor {
  private consecutiveSlowWindows = 0;
  private readonly minimumFps: number;
  private readonly p95FrameMs: number;
  private readonly requiredSlowWindows: number;
  private readonly samples: number[] = [];
  private readonly windowSize: number;
  private currentTier: QualityTier;

  constructor(options: FrameBudgetMonitorOptions = {}) {
    this.currentTier = options.initialTier ?? 'high';
    this.minimumFps = positiveNumber(options.minimumFps, 45);
    this.p95FrameMs = positiveNumber(options.p95FrameMs, 40);
    this.requiredSlowWindows = positiveInteger(options.requiredSlowWindows, 3);
    this.windowSize = positiveInteger(options.windowSize, 40);
  }

  get tier(): QualityTier {
    return this.currentTier;
  }

  recordFrame(elapsedMs: number): QualityTier {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || this.currentTier === 'low') {
      return this.currentTier;
    }

    this.samples.push(elapsedMs);
    if (this.samples.length < this.windowSize) return this.currentTier;

    const orderedSamples = [...this.samples].sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(orderedSamples.length * 0.95) - 1);
    const p95 = orderedSamples[p95Index] ?? 0;
    const averageFrameMs =
      this.samples.reduce((total, sample) => total + sample, 0) / this.samples.length;
    const averageFps = 1_000 / averageFrameMs;
    this.samples.length = 0;

    if (p95 > this.p95FrameMs || averageFps < this.minimumFps) {
      this.consecutiveSlowWindows += 1;
    } else {
      this.consecutiveSlowWindows = 0;
    }

    if (this.consecutiveSlowWindows >= this.requiredSlowWindows) {
      this.currentTier = lowerQualityTier(this.currentTier);
      this.consecutiveSlowWindows = 0;
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
