import { describe, expect, test } from 'bun:test';
import React, {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { HoloCard } from './holo-card';

type Effect = () => undefined | (() => void);

type HookDispatcher = {
  useEffect(effect: Effect): void;
  useRef<T>(initialValue: T): RefObject<T>;
};

type CardElementProps = {
  onBlur(): void;
  onFocus(): void;
  onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerEnter(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerLeave(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
  ref: RefObject<HTMLDivElement | null>;
};

type ReactClientInternals = {
  H: HookDispatcher | null;
};

const reactClientInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

describe('holo card interaction contract', () => {
  test('applies pointer custom properties and spring-settles on keyboard focus', () => {
    const browser = installBrowserHarness(false);

    try {
      const rendered = renderWithHookHarness({
        className: 'featured-card',
        imageAlt: 'Full-art card face',
        imageUrl: '/fixtures/card.png',
        name: 'Charizard · Base Set',
        rarity: 'chase',
        value: '$72.50',
      });
      const card = createCardElement();
      rendered.card.props.ref.current = card.element;
      const cleanup = rendered.effects[0]?.();

      rendered.card.props.onPointerEnter(pointerEvent('mouse', 1, card.element, 270, 10));
      rendered.card.props.onPointerMove(pointerEvent('mouse', 1, card.element, 270, 10));
      expect(browser.pendingFrames()).toBe(1);

      browser.flushNextFrame(0);
      expect(card.styles.get('--holo-pointer-tilt-x')).toBe('12.000deg');
      expect(card.styles.get('--holo-pointer-tilt-y')).toBe('12.000deg');
      expect(card.styles.get('--holo-pointer-sheen-x')).toBe('100.000%');
      expect(card.styles.get('--holo-pointer-sheen-y')).toBe('0.000%');
      expect(card.styles.get('--holo-pointer-glare')).toBe('1.000');

      rendered.card.props.onFocus();
      expect(card.attributes.get('data-settling')).toBe('true');
      browser.flushAllFrames();

      expect(card.attributes.has('data-settling')).toBe(false);
      expect(card.styles.get('--holo-pointer-tilt-x')).toBe('0.000deg');
      expect(card.styles.get('--holo-pointer-tilt-y')).toBe('0.000deg');
      expect(card.styles.get('--holo-pointer-sheen-x')).toBe('50.000%');
      expect(card.styles.get('--holo-pointer-sheen-y')).toBe('50.000%');
      expect(card.styles.get('--holo-pointer-glare')).toBe('0.000');

      rendered.card.props.onBlur();
      browser.flushNextFrame(1_000);

      rendered.card.props.onPointerMove(pointerEvent('mouse', 1, card.element, 20, 360));
      expect(browser.pendingFrames()).toBe(1);
      cleanup?.();
      expect(browser.canceledFrames.length).toBeGreaterThan(0);
      expect(browser.removedMediaListeners).toBe(1);
    } finally {
      browser.restore();
    }
  });

  test('resets immediately for reduced motion and enforces touch capture ownership', () => {
    const browser = installBrowserHarness(true);

    try {
      const rendered = renderWithHookHarness({
        imageUrl: '/fixtures/card.png',
        name: 'Mewtwo · Base Set',
        rarity: 'rare',
      });
      const cleanup = rendered.effects[0]?.();
      const card = createCardElement();
      rendered.card.props.ref.current = card.element;

      browser.dispatchMediaChange();
      expect(card.styles.get('--holo-pointer-tilt-x')).toBe('0.000deg');
      expect(card.styles.get('--holo-pointer-sheen-x')).toBe('50.000%');

      rendered.card.props.onPointerMove(pointerEvent('mouse', 1, card.element, 270, 10));
      rendered.card.props.onPointerDown(pointerEvent('touch', 7, card.element, 145, 185));
      expect(browser.pendingFrames()).toBe(0);

      rendered.card.props.onFocus();
      expect(card.attributes.has('data-settling')).toBe(false);

      browser.mediaQuery.matches = false;
      browser.dispatchMediaChange();
      rendered.card.props.onPointerDown(pointerEvent('mouse', 1, card.element, 145, 185));
      expect(card.capturedPointers).toEqual([]);

      rendered.card.props.onPointerMove(pointerEvent('touch', 8, card.element, 145, 185));
      expect(browser.pendingFrames()).toBe(0);

      rendered.card.props.onPointerDown(pointerEvent('touch', 7, card.element, 145, 185));
      expect(card.capturedPointers).toEqual([7]);
      expect(browser.pendingFrames()).toBe(1);

      rendered.card.props.onPointerUp(pointerEvent('touch', 8, card.element, 145, 185));
      expect(card.releasedPointers).toEqual([]);

      browser.flushNextFrame(0);
      rendered.card.props.onPointerUp(pointerEvent('touch', 7, card.element, 145, 185));
      expect(card.releasedPointers).toEqual([7]);
      browser.flushAllFrames();

      card.hasCapture = false;
      rendered.card.props.onPointerDown(pointerEvent('pen', 9, card.element, 270, 10));
      browser.flushNextFrame(2_000);
      rendered.card.props.onPointerCancel(pointerEvent('pen', 9, card.element, 270, 10));
      expect(card.releasedPointers).toEqual([7]);
      browser.flushAllFrames();

      rendered.card.props.onLostPointerCapture(pointerEvent('pen', 9, card.element, 270, 10));
      rendered.card.props.onPointerLeave(pointerEvent('touch', 9, card.element, 270, 10));
      rendered.card.props.onPointerLeave(pointerEvent('mouse', 1, card.element, 270, 10));
      browser.flushAllFrames();
      cleanup?.();
    } finally {
      browser.restore();
    }
  });
});

function renderWithHookHarness(props: Parameters<typeof HoloCard>[0]): {
  card: ReactElement<CardElementProps>;
  effects: Effect[];
} {
  const effects: Effect[] = [];
  const previousDispatcher = reactClientInternals.H;
  reactClientInternals.H = {
    useEffect(effect) {
      effects.push(effect);
    },
    useRef<T>(initialValue: T) {
      return { current: initialValue };
    },
  };

  try {
    const stage = HoloCard(props) as ReactElement<{ children: ReactElement<CardElementProps> }>;
    return { card: stage.props.children, effects };
  } finally {
    reactClientInternals.H = previousDispatcher;
  }
}

function createCardElement() {
  const attributes = new Map<string, string>();
  const styles = new Map<string, string>();
  const capturedPointers: number[] = [];
  const releasedPointers: number[] = [];
  const card = {
    attributes,
    capturedPointers,
    hasCapture: true,
    releasedPointers,
    styles,
  };
  const element = {
    getBoundingClientRect: () => ({
      bottom: 360,
      height: 350,
      left: 20,
      right: 270,
      top: 10,
      width: 250,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    }),
    hasPointerCapture: () => card.hasCapture,
    releasePointerCapture: (pointerId: number) => releasedPointers.push(pointerId),
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    setPointerCapture: (pointerId: number) => capturedPointers.push(pointerId),
    style: {
      setProperty: (name: string, value: string) => styles.set(name, value),
    },
  } as unknown as HTMLDivElement;

  return Object.assign(card, { element });
}

function pointerEvent(
  pointerType: 'mouse' | 'pen' | 'touch',
  pointerId: number,
  currentTarget: HTMLDivElement,
  clientX: number,
  clientY: number,
): ReactPointerEvent<HTMLDivElement> {
  return {
    clientX,
    clientY,
    currentTarget,
    pointerId,
    pointerType,
  } as ReactPointerEvent<HTMLDivElement>;
}

function installBrowserHarness(prefersReducedMotion: boolean) {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const frames = new Map<number, FrameRequestCallback>();
  const mediaListeners = new Set<() => void>();
  let frameId = 0;
  let removedMediaListeners = 0;
  const canceledFrames: number[] = [];
  const mediaQuery = {
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    matches: prefersReducedMotion,
    removeEventListener: (_type: string, listener: () => void) => {
      if (mediaListeners.delete(listener)) removedMediaListeners += 1;
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cancelAnimationFrame(id: number) {
        canceledFrames.push(id);
        frames.delete(id);
      },
      matchMedia: () => mediaQuery,
      requestAnimationFrame(callback: FrameRequestCallback) {
        frameId += 1;
        frames.set(frameId, callback);
        return frameId;
      },
    },
    writable: true,
  });

  return {
    canceledFrames,
    dispatchMediaChange() {
      for (const listener of mediaListeners) listener();
    },
    flushAllFrames() {
      for (let index = 0; index < 300 && frames.size > 0; index += 1) {
        this.flushNextFrame(index * (1_000 / 60));
      }
      expect(frames.size).toBe(0);
    },
    flushNextFrame(time: number) {
      const nextFrame = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      expect(nextFrame).toBeDefined();
      if (!nextFrame) return;
      frames.delete(nextFrame[0]);
      nextFrame[1](time);
    },
    mediaQuery,
    pendingFrames: () => frames.size,
    get removedMediaListeners() {
      return removedMediaListeners;
    },
    restore() {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
    },
  };
}
