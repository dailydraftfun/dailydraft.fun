import type { PullRarity } from '@dailydraft/contracts/pull-rarity';

export const choreographyBeats = [
  'idle',
  'anticipation',
  'hold',
  'reveal',
  'celebrate',
  'settled',
] as const;

export type ChoreographyBeat = (typeof choreographyBeats)[number];
export type ChoreographyEasing = readonly [number, number, number, number];

export type ChoreographyState = Readonly<{
  beat: ChoreographyBeat;
  rarity: PullRarity;
  revealed: boolean;
  settled: boolean;
}>;

export type ChoreographyEvent =
  | { rarity?: PullRarity; type: 'start' }
  | { from?: ChoreographyBeat; type: 'advance' }
  | { rarity?: PullRarity; type: 'interrupt' | 'fast-forward' | 'settle' }
  | { rarity?: PullRarity; type: 'reset' };

export type ChoreographyTiming = Readonly<{
  durationMs: number;
  easing: ChoreographyEasing;
  intensity: number;
}>;

export type ChoreographyTimelineEntry = ChoreographyTiming &
  Readonly<{
    beat: Exclude<ChoreographyBeat, 'idle' | 'settled'>;
    endsAtMs: number;
    startsAtMs: number;
  }>;

const linearEasing = [0, 0, 1, 1] as const satisfies ChoreographyEasing;

const beatTimings: Record<ChoreographyBeat, ChoreographyTiming> = {
  anticipation: {
    durationMs: 340,
    easing: [0.2, 0.9, 0.3, 1],
    intensity: 0.46,
  },
  celebrate: {
    durationMs: 320,
    easing: [0.16, 1, 0.3, 1],
    intensity: 0.35,
  },
  hold: {
    durationMs: 180,
    easing: [0.4, 0, 0.6, 1],
    intensity: 0.58,
  },
  idle: { durationMs: 0, easing: linearEasing, intensity: 0 },
  reveal: {
    durationMs: 480,
    easing: [0.22, 1, 0.36, 1],
    intensity: 0.72,
  },
  settled: { durationMs: 0, easing: linearEasing, intensity: 0 },
};

const celebrationByRarity: Record<
  PullRarity,
  Pick<ChoreographyTiming, 'durationMs' | 'intensity'>
> = {
  chase: { durationMs: 620, intensity: 1 },
  common: { durationMs: 320, intensity: 0.35 },
  rare: { durationMs: 500, intensity: 0.78 },
  uncommon: { durationMs: 400, intensity: 0.55 },
};

const nextBeat: Record<ChoreographyBeat, ChoreographyBeat> = {
  anticipation: 'hold',
  celebrate: 'settled',
  hold: 'reveal',
  idle: 'idle',
  reveal: 'celebrate',
  settled: 'settled',
};

const animatedBeats = [
  'anticipation',
  'hold',
  'reveal',
  'celebrate',
] as const satisfies readonly Exclude<ChoreographyBeat, 'idle' | 'settled'>[];

export function createChoreographyState(
  rarity: PullRarity,
  beat: 'idle' | 'settled' = 'idle',
): ChoreographyState {
  return {
    beat,
    rarity,
    revealed: beat === 'settled',
    settled: beat === 'settled',
  };
}

export function choreographyReducer(
  state: ChoreographyState,
  event: ChoreographyEvent,
): ChoreographyState {
  switch (event.type) {
    case 'start':
      return {
        beat: 'anticipation',
        rarity: event.rarity ?? state.rarity,
        revealed: false,
        settled: false,
      };
    case 'advance': {
      if (event.from && event.from !== state.beat) return state;
      const beat = nextBeat[state.beat];
      return {
        ...state,
        beat,
        revealed: beat === 'reveal' || beat === 'celebrate' || beat === 'settled',
        settled: beat === 'settled',
      };
    }
    case 'interrupt':
    case 'fast-forward':
    case 'settle':
      return settledChoreographyState(event.rarity ?? state.rarity);
    case 'reset':
      return createChoreographyState(event.rarity ?? state.rarity);
  }
}

export function advanceChoreography(state: ChoreographyState): ChoreographyState {
  return choreographyReducer(state, { type: 'advance' });
}

export function interruptChoreography(state: ChoreographyState): ChoreographyState {
  return choreographyReducer(state, { type: 'interrupt' });
}

export function fastForwardChoreography(state: ChoreographyState): ChoreographyState {
  return choreographyReducer(state, { type: 'fast-forward' });
}

export function settleChoreography(state: ChoreographyState): ChoreographyState {
  return choreographyReducer(state, { type: 'settle' });
}

export function choreographyTimingFor(
  beat: ChoreographyBeat,
  rarity: PullRarity,
  reducedMotion = false,
): ChoreographyTiming {
  const timing =
    beat === 'celebrate'
      ? { ...beatTimings.celebrate, ...celebrationByRarity[rarity] }
      : beatTimings[beat];

  return reducedMotion ? { ...timing, durationMs: 0 } : { ...timing };
}

export function createChoreographyTimeline(
  rarity: PullRarity,
  reducedMotion = false,
): readonly ChoreographyTimelineEntry[] {
  let elapsedMs = 0;

  return animatedBeats.map((beat) => {
    const timing = choreographyTimingFor(beat, rarity, reducedMotion);
    const entry = {
      ...timing,
      beat,
      endsAtMs: elapsedMs + timing.durationMs,
      startsAtMs: elapsedMs,
    };
    elapsedMs = entry.endsAtMs;
    return entry;
  });
}

export function isAnimatedChoreographyBeat(
  beat: ChoreographyBeat,
): beat is Exclude<ChoreographyBeat, 'idle' | 'settled'> {
  return beat !== 'idle' && beat !== 'settled';
}

export class ChoreographyClock {
  private elapsedInBeatMs = 0;
  private currentState: ChoreographyState;

  constructor(
    rarity: PullRarity,
    private readonly reducedMotion = false,
  ) {
    this.currentState = createChoreographyState(rarity);
  }

  get state(): ChoreographyState {
    return this.currentState;
  }

  start(rarity = this.currentState.rarity): ChoreographyState {
    this.elapsedInBeatMs = 0;
    this.currentState = choreographyReducer(this.currentState, { rarity, type: 'start' });
    if (this.reducedMotion) this.currentState = settledChoreographyState(rarity);
    return this.currentState;
  }

  tick(elapsedMs: number): ChoreographyState {
    if (
      !Number.isFinite(elapsedMs) ||
      elapsedMs <= 0 ||
      this.currentState.beat === 'idle' ||
      this.currentState.settled
    ) {
      return this.currentState;
    }

    this.elapsedInBeatMs += elapsedMs;
    let timing = choreographyTimingFor(
      this.currentState.beat,
      this.currentState.rarity,
      this.reducedMotion,
    );

    while (!this.currentState.settled && this.elapsedInBeatMs >= timing.durationMs) {
      this.elapsedInBeatMs -= timing.durationMs;
      this.currentState = choreographyReducer(this.currentState, {
        from: this.currentState.beat,
        type: 'advance',
      });
      timing = choreographyTimingFor(
        this.currentState.beat,
        this.currentState.rarity,
        this.reducedMotion,
      );
    }

    return this.currentState;
  }

  interrupt(): ChoreographyState {
    this.elapsedInBeatMs = 0;
    this.currentState = choreographyReducer(this.currentState, { type: 'interrupt' });
    return this.currentState;
  }

  settle(): ChoreographyState {
    this.elapsedInBeatMs = 0;
    this.currentState = choreographyReducer(this.currentState, { type: 'settle' });
    return this.currentState;
  }
}

function settledChoreographyState(rarity: PullRarity): ChoreographyState {
  return {
    beat: 'settled',
    rarity,
    revealed: true,
    settled: true,
  };
}
