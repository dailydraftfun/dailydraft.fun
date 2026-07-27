import { describe, expect, test } from 'bun:test';
import { type CelebrationCanvasContext, createCelebrationCanvasLoop } from './celebration-canvas';
import { celebrationEffectProfileFor } from './celebration-effects';

describe('celebration canvas loop', () => {
  test('draws a capped chase burst and stops on its wall-clock budget', () => {
    const harness = createHarness();
    let completed = 0;
    const loop = createCelebrationCanvasLoop({
      canvas: harness.canvas,
      onComplete: () => {
        completed += 1;
      },
      pixelRatio: 1.5,
      profile: celebrationEffectProfileFor('chase'),
      random: () => 0.5,
      scheduler: harness.scheduler,
    });

    loop.start();
    loop.start();
    expect(harness.pending()).toBe(1);

    harness.flush(0);
    expect(harness.context.fillRects.length).toBeGreaterThan(0);
    expect(harness.context.arcs.length).toBeGreaterThan(0);
    expect(harness.context.arcs[0]?.[2]).toBe(8.25);
    harness.flush(600);

    expect(harness.pending()).toBe(0);
    expect(completed).toBe(1);
    expect(harness.context.clearCount).toBeGreaterThanOrEqual(3);
  });

  test('draws edge accents, skips common accents, and cancels pending work', () => {
    const edge = createHarness();
    const edgeLoop = createCelebrationCanvasLoop({
      canvas: edge.canvas,
      profile: celebrationEffectProfileFor('rare'),
      scheduler: edge.scheduler,
    });
    edgeLoop.start();
    edge.flush(0);
    expect(edge.context.fillRects).toHaveLength(4);
    edgeLoop.stop();
    expect(edge.canceled).toHaveLength(1);
    edgeLoop.start();
    edge.flush(1_000);
    expect(edge.pending()).toBe(1);
    edgeLoop.stop();

    const common = createHarness();
    createCelebrationCanvasLoop({
      canvas: common.canvas,
      profile: celebrationEffectProfileFor('common'),
      scheduler: common.scheduler,
    }).start();
    common.flush(0);
    expect(common.context.fillRects).toHaveLength(0);
  });

  test('safely no-ops when a 2d context is unavailable', () => {
    const harness = createHarness();
    const loop = createCelebrationCanvasLoop({
      canvas: { ...harness.canvas, getContext: () => null },
      profile: celebrationEffectProfileFor('common'),
      scheduler: harness.scheduler,
    });

    loop.start();
    loop.stop();
    expect(harness.pending()).toBe(0);
  });
});

function createHarness() {
  const callbacks = new Map<number, (timestamp: number) => void>();
  const canceled: number[] = [];
  let nextFrame = 0;
  const context = {
    arcs: [] as number[][],
    clearCount: 0,
    fillRects: [] as number[][],
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    arc(...values: number[]) {
      this.arcs.push(values);
    },
    beginPath() {},
    clearRect() {
      this.clearCount += 1;
    },
    fill() {},
    fillRect(...values: number[]) {
      this.fillRects.push(values);
    },
  } satisfies CelebrationCanvasContext & {
    arcs: number[][];
    clearCount: number;
    fillRects: number[][];
  };
  const scheduler = {
    cancel(frameId: number) {
      canceled.push(frameId);
      callbacks.delete(frameId);
    },
    request(callback: (timestamp: number) => void) {
      nextFrame += 1;
      callbacks.set(nextFrame, callback);
      return nextFrame;
    },
  };

  return {
    canceled,
    canvas: {
      getContext: () => context,
      height: 480,
      width: 320,
    },
    context,
    flush(timestamp: number) {
      const entry = callbacks.entries().next().value as
        | [number, (frameTimestamp: number) => void]
        | undefined;
      if (!entry) throw new Error('Expected a pending animation frame');
      callbacks.delete(entry[0]);
      entry[1](timestamp);
    },
    pending: () => callbacks.size,
    scheduler,
  };
}
