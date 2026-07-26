import { describe, expect, test } from 'bun:test';
import {
  createHoloCardSpringState,
  holoCardMotionPolicy,
  isHoloCardSpringSettled,
  neutralHoloCardMotion,
  pointerToHoloCardMotion,
  stepHoloCardSpring,
} from './holo-card-motion';

const bounds = { height: 350, left: 20, top: 10, width: 250 };

describe('holo card motion', () => {
  test('maps pointer position to bounded tilt, sheen, and glare values', () => {
    expect(pointerToHoloCardMotion(145, 185, bounds)).toEqual(neutralHoloCardMotion);
    expect(pointerToHoloCardMotion(20, 10, bounds)).toEqual({
      glare: 1,
      sheenX: 0,
      sheenY: 0,
      tiltX: 12,
      tiltY: -12,
    });
    expect(pointerToHoloCardMotion(1_000, 1_000, bounds)).toEqual({
      glare: 1,
      sheenX: 100,
      sheenY: 100,
      tiltX: -12,
      tiltY: 12,
    });
  });

  test('fails safely to the neutral state for collapsed card bounds', () => {
    expect(pointerToHoloCardMotion(40, 80, { ...bounds, width: 0 })).toEqual(neutralHoloCardMotion);
  });

  test('spring-settles every visual channel back to neutral', () => {
    let spring = createHoloCardSpringState(pointerToHoloCardMotion(250, 40, bounds));

    for (let frame = 0; frame < 240 && !isHoloCardSpringSettled(spring); frame += 1) {
      spring = stepHoloCardSpring(spring, 1 / 60);
    }

    expect(isHoloCardSpringSettled(spring)).toBe(true);
    expect(spring.motion.tiltX).toBeCloseTo(0, 1);
    expect(spring.motion.tiltY).toBeCloseTo(0, 1);
    expect(spring.motion.sheenX).toBeCloseTo(50, 1);
    expect(spring.motion.sheenY).toBeCloseTo(50, 1);
    expect(spring.motion.glare).toBeCloseTo(0, 1);
  });

  test('reduced motion disables tilt and replaces spring release with an immediate reset', () => {
    expect(holoCardMotionPolicy(true)).toEqual({
      pointerTilt: false,
      release: 'immediate',
    });
    expect(holoCardMotionPolicy(false)).toEqual({
      pointerTilt: true,
      release: 'spring',
    });
  });
});
