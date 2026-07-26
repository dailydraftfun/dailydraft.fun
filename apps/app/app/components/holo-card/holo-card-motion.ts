export type HoloCardMotionState = {
  glare: number;
  sheenX: number;
  sheenY: number;
  tiltX: number;
  tiltY: number;
};

export type HoloCardSpringState = {
  motion: HoloCardMotionState;
  velocity: HoloCardMotionState;
};

export type PointerBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export const MAX_TILT_DEGREES = 12;

export const neutralHoloCardMotion: HoloCardMotionState = {
  glare: 0,
  sheenX: 50,
  sheenY: 50,
  tiltX: 0,
  tiltY: 0,
};

const zeroVelocity: HoloCardMotionState = {
  glare: 0,
  sheenX: 0,
  sheenY: 0,
  tiltX: 0,
  tiltY: 0,
};

export function pointerToHoloCardMotion(
  clientX: number,
  clientY: number,
  bounds: PointerBounds,
  maxTilt = MAX_TILT_DEGREES,
): HoloCardMotionState {
  if (bounds.width <= 0 || bounds.height <= 0) return { ...neutralHoloCardMotion };

  const normalizedX = clamp((clientX - bounds.left) / bounds.width, 0, 1);
  const normalizedY = clamp((clientY - bounds.top) / bounds.height, 0, 1);
  const tiltX = (0.5 - normalizedY) * maxTilt * 2;
  const tiltY = (normalizedX - 0.5) * maxTilt * 2;

  return {
    glare: clamp((Math.abs(tiltX) + Math.abs(tiltY)) / (maxTilt * 2), 0, 1),
    sheenX: normalizedX * 100,
    sheenY: normalizedY * 100,
    tiltX,
    tiltY,
  };
}

export function createHoloCardSpringState(motion: HoloCardMotionState): HoloCardSpringState {
  return {
    motion: { ...motion },
    velocity: { ...zeroVelocity },
  };
}

export function stepHoloCardSpring(
  state: HoloCardSpringState,
  deltaSeconds: number,
  target: HoloCardMotionState = neutralHoloCardMotion,
): HoloCardSpringState {
  const delta = clamp(deltaSeconds, 0, 1 / 30);
  const nextMotion = { ...state.motion };
  const nextVelocity = { ...state.velocity };

  for (const key of motionKeys) {
    const displacement = state.motion[key] - target[key];
    const acceleration = -SPRING_STIFFNESS * displacement - SPRING_DAMPING * state.velocity[key];
    nextVelocity[key] = state.velocity[key] + acceleration * delta;
    nextMotion[key] = state.motion[key] + nextVelocity[key] * delta;
  }

  return { motion: nextMotion, velocity: nextVelocity };
}

export function isHoloCardSpringSettled(
  state: HoloCardSpringState,
  target: HoloCardMotionState = neutralHoloCardMotion,
): boolean {
  return motionKeys.every(
    (key) =>
      Math.abs(state.motion[key] - target[key]) < SETTLE_POSITION_EPSILON &&
      Math.abs(state.velocity[key]) < SETTLE_VELOCITY_EPSILON,
  );
}

export function holoCardMotionPolicy(prefersReducedMotion: boolean) {
  return prefersReducedMotion
    ? ({ pointerTilt: false, release: 'immediate' } as const)
    : ({ pointerTilt: true, release: 'spring' } as const);
}

const motionKeys = ['glare', 'sheenX', 'sheenY', 'tiltX', 'tiltY'] as const;
const SPRING_STIFFNESS = 210;
const SPRING_DAMPING = 24;
const SETTLE_POSITION_EPSILON = 0.025;
const SETTLE_VELOCITY_EPSILON = 0.025;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
