import {
  type CelebrationEffectProfile,
  type CelebrationParticle,
  particleOpacity,
  spawnCelebrationParticles,
  stepCelebrationParticle,
} from './celebration-effects';

export type CelebrationCanvasContext = {
  fillStyle: unknown;
  globalAlpha: number;
  globalCompositeOperation: string;
  beginPath(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fill(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
};

export type CelebrationCanvasSurface = {
  height: number;
  width: number;
  getContext(contextId: '2d'): CelebrationCanvasContext | null;
};

export type CelebrationFrameScheduler = {
  cancel(frameId: number): void;
  request(callback: (timestamp: number) => void): number;
};

export function createCelebrationCanvasLoop({
  canvas,
  onComplete,
  pixelRatio = 1,
  profile,
  random = Math.random,
  scheduler,
}: {
  canvas: CelebrationCanvasSurface;
  onComplete?: () => void;
  pixelRatio?: number;
  profile: CelebrationEffectProfile;
  random?: () => number;
  scheduler: CelebrationFrameScheduler;
}) {
  const context = canvas.getContext('2d');
  const particles = spawnCelebrationParticles(profile, random);
  let frameId: number | null = null;
  let previousTimestamp: number | null = null;
  let elapsedMs = 0;

  const clear = () => context?.clearRect(0, 0, canvas.width, canvas.height);

  const stop = () => {
    if (frameId !== null) scheduler.cancel(frameId);
    frameId = null;
    previousTimestamp = null;
    elapsedMs = 0;
    clear();
  };

  const frame = (timestamp: number) => {
    if (!context) return;
    const deltaMs = previousTimestamp === null ? 0 : Math.max(0, timestamp - previousTimestamp);
    previousTimestamp = timestamp;
    elapsedMs += deltaMs;
    clear();
    renderScreenAccent(context, canvas, profile, elapsedMs);

    for (const particle of particles) {
      stepCelebrationParticle(particle, deltaMs);
      renderParticle(context, canvas, particle, profile.durationMs, pixelRatio);
    }

    if (elapsedMs >= profile.durationMs) {
      frameId = null;
      clear();
      onComplete?.();
      return;
    }
    frameId = scheduler.request(frame);
  };

  return {
    start() {
      if (!context || frameId !== null) return;
      frameId = scheduler.request(frame);
    },
    stop,
  };
}

function renderScreenAccent(
  context: CelebrationCanvasContext,
  canvas: CelebrationCanvasSurface,
  profile: CelebrationEffectProfile,
  elapsedMs: number,
) {
  if (profile.screenAccent === 'none') return;
  const progress = Math.min(1, elapsedMs / profile.durationMs);
  context.globalCompositeOperation = 'lighter';
  context.globalAlpha = (1 - progress) * profile.glowIntensity * 0.12;
  context.fillStyle = profile.palette[0] ?? '#ffffff';

  if (profile.screenAccent === 'full') {
    context.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const edge = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.025));
  context.fillRect(0, 0, canvas.width, edge);
  context.fillRect(0, canvas.height - edge, canvas.width, edge);
  context.fillRect(0, 0, edge, canvas.height);
  context.fillRect(canvas.width - edge, 0, edge, canvas.height);
}

function renderParticle(
  context: CelebrationCanvasContext,
  canvas: CelebrationCanvasSurface,
  particle: CelebrationParticle,
  durationMs: number,
  pixelRatio: number,
) {
  const opacity = particleOpacity(particle, durationMs);
  if (opacity === 0) return;
  context.globalCompositeOperation = 'lighter';
  context.globalAlpha = opacity;
  context.fillStyle = particle.color;
  context.beginPath();
  context.arc(
    particle.x * canvas.width,
    particle.y * canvas.height,
    particle.sizePx * Math.max(1, pixelRatio),
    0,
    Math.PI * 2,
  );
  context.fill();
}
