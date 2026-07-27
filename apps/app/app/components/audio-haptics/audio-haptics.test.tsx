import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React, { type ReactElement, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AudioHapticsControl,
  AudioHapticsProvider,
  ChoreographyAudioHaptics,
  createAudioHapticsService,
  isAudioHapticsShortcut,
  readStoredAudioHapticsPreference,
  writeStoredAudioHapticsPreference,
} from './audio-haptics';
import { audioHapticsStorageKey } from './audio-haptics-cues';

type Effect = () => undefined | (() => void);

type HookDispatcher = {
  useCallback<T>(callback: T): T;
  useContext<T>(context: unknown): T;
  useEffect(effect: Effect): void;
  useRef<T>(initialValue: T): RefObject<T>;
  useState<T>(initialValue: T | (() => T)): [T, (value: T) => void];
};

type ReactClientInternals = {
  H: HookDispatcher | null;
};

type ProviderValue = {
  enabled: boolean;
  play(
    beat: 'anticipation' | 'celebrate' | 'hold' | 'idle' | 'reveal' | 'settled',
    rarity: 'common' | 'uncommon' | 'rare' | 'chase',
  ): void;
  setEnabled(enabled: boolean): void;
  toggle(): void;
};

const reactClientInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

type FakeHowl = {
  options: {
    format?: string[];
    preload?: boolean | 'metadata';
    src: string[];
    volume?: number;
  };
  plays: number;
  stops: number;
  unloads: number;
  volumes: number[];
};

describe('audio and haptics binding', () => {
  test('does not allocate or play audio until explicit opt-in', () => {
    const howls: FakeHowl[] = [];
    const vibrations: (number | number[])[] = [];
    let resumes = 0;
    const service = createAudioHapticsService({
      canPlayAudio: () => true,
      createHowl: (options) => {
        options.onloaderror?.(0, 'fixture load error');
        options.onplayerror?.(0, 'fixture play error');
        const howl: FakeHowl = {
          options: {
            format: options.format
              ? Array.isArray(options.format)
                ? options.format
                : [options.format]
              : undefined,
            preload: options.preload,
            src: Array.isArray(options.src) ? options.src : [options.src],
            volume: options.volume,
          },
          plays: 0,
          stops: 0,
          unloads: 0,
          volumes: [],
        };
        howls.push(howl);
        return {
          play: () => {
            howl.plays += 1;
            return howl.plays;
          },
          stop: () => {
            howl.stops += 1;
          },
          unload: () => {
            howl.unloads += 1;
          },
          volume: (value) => {
            howl.volumes.push(value);
          },
        };
      },
      resumeAudio: () => {
        resumes += 1;
      },
      vibrate: (pattern) => {
        vibrations.push(pattern);
        return true;
      },
    });

    expect(service.play('reveal', 'rare')).toBe(false);
    expect(howls).toHaveLength(0);

    service.setEnabled(true);
    service.setEnabled(true);
    expect(howls).toHaveLength(3);
    expect(resumes).toBe(1);
    expect(howls.every((howl) => howl.options.format?.[0] === 'wav')).toBe(true);
    expect(howls.every((howl) => howl.options.preload === true)).toBe(true);
    expect(howls.every((howl) => howl.options.volume === 0)).toBe(true);
    expect(howls.every((howl) => howl.options.src[0]?.startsWith('data:audio/wav;base64,'))).toBe(
      true,
    );

    expect(service.play('anticipation', 'common')).toBe(true);
    expect(howls[0]?.volumes).toEqual([0.19]);
    expect(vibrations).toEqual([]);

    expect(service.play('reveal', 'rare')).toBe(true);
    expect(howls[1]?.volumes).toEqual([0.5]);
    expect(vibrations).toEqual([[20, 18, 24]]);

    expect(service.play('celebrate', 'chase')).toBe(true);
    expect(howls[2]?.volumes).toEqual([0.72]);
    expect(vibrations.at(-1)).toEqual([40, 28, 50, 28, 60]);
    expect(service.play('hold', 'chase')).toBe(false);

    service.setEnabled(false);
    service.setEnabled(false);
    expect(howls.every((howl) => howl.stops > 0)).toBe(true);
    expect(vibrations.at(-1)).toBe(0);
    expect(service.play('reveal', 'rare')).toBe(false);

    service.dispose();
    service.dispose();
    expect(howls.every((howl) => howl.unloads === 1)).toBe(true);
  });

  test('keeps autoplay-blocked audio silent while feature-detecting haptics independently', () => {
    let plays = 0;
    const vibrations: (number | number[])[] = [];
    const service = createAudioHapticsService({
      canPlayAudio: () => false,
      createHowl: () => ({
        play: () => {
          plays += 1;
          return plays;
        },
        stop: () => undefined,
        unload: () => undefined,
        volume: () => undefined,
      }),
      resumeAudio: () => undefined,
      vibrate: (pattern) => {
        vibrations.push(pattern);
        return true;
      },
    });

    service.setEnabled(true);
    expect(service.play('reveal', 'uncommon')).toBe(true);
    expect(plays).toBe(0);
    expect(vibrations).toEqual([[16]]);

    const unsupported = createAudioHapticsService({
      canPlayAudio: () => false,
      createHowl: () => ({
        play: () => 0,
        stop: () => undefined,
        unload: () => undefined,
        volume: () => undefined,
      }),
      resumeAudio: () => undefined,
      vibrate: () => false,
    });
    unsupported.setEnabled(true);
    expect(unsupported.play('reveal', 'common')).toBe(false);
  });

  test('reads and persists preference defensively when storage is unavailable', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(readStoredAudioHapticsPreference(storage)).toBeNull();
    expect(writeStoredAudioHapticsPreference('enabled', storage)).toBe(true);
    expect(values.get(audioHapticsStorageKey)).toBe('enabled');
    expect(readStoredAudioHapticsPreference(storage)).toBe('enabled');
    expect(readStoredAudioHapticsPreference(null)).toBeNull();
    expect(writeStoredAudioHapticsPreference('muted', null)).toBe(false);
    expect(readStoredAudioHapticsPreference()).toBeNull();
    expect(writeStoredAudioHapticsPreference('muted')).toBe(false);

    const blockedStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredAudioHapticsPreference(blockedStorage)).toBeNull();
    expect(writeStoredAudioHapticsPreference('muted', blockedStorage)).toBe(false);
  });

  test('reserves Alt+M as a non-repeating global keyboard toggle', () => {
    expect(
      isAudioHapticsShortcut({
        altKey: true,
        code: 'KeyM',
        ctrlKey: false,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      isAudioHapticsShortcut({
        altKey: false,
        code: 'KeyM',
        ctrlKey: false,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isAudioHapticsShortcut({
        altKey: true,
        code: 'KeyM',
        ctrlKey: true,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isAudioHapticsShortcut({
        altKey: true,
        code: 'KeyM',
        ctrlKey: false,
        metaKey: true,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isAudioHapticsShortcut({
        altKey: true,
        code: 'KeyM',
        ctrlKey: false,
        metaKey: false,
        repeat: true,
      }),
    ).toBe(false);
    expect(
      isAudioHapticsShortcut({
        altKey: true,
        code: 'KeyN',
        ctrlKey: false,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(false);
  });

  test('server-renders a muted, keyboard-reachable global control and silent cue binding', () => {
    const control = renderToStaticMarkup(<AudioHapticsControl />);
    const provider = renderToStaticMarkup(
      <AudioHapticsProvider>
        <AudioHapticsControl />
      </AudioHapticsProvider>,
    );
    const cue = renderToStaticMarkup(<ChoreographyAudioHaptics beat="reveal" rarity="rare" />);

    for (const markup of [control, provider]) {
      expect(markup).toContain('aria-keyshortcuts="Alt+M"');
      expect(markup).toContain('aria-pressed="false"');
      expect(markup).toContain('Sound and haptics off');
      expect(markup).toContain('Sound off');
      expect(markup).toContain('⌥M');
    }
    expect(cue).toBe('');
  });

  test('hydrates persisted preference, handles the keyboard shortcut, and cleans up its service', () => {
    const browser = installBrowserHarness(true);
    const enabledChanges: boolean[] = [];
    const plays: string[] = [];
    let disposed = 0;
    const service = {
      dispose: () => {
        disposed += 1;
      },
      play: (beat: string, rarity: string) => {
        plays.push(`${beat}:${rarity}`);
        return true;
      },
      setEnabled: (enabled: boolean) => {
        enabledChanges.push(enabled);
      },
    };

    browser.values.set(audioHapticsStorageKey, 'enabled');
    try {
      const rendered = renderProviderWithHookHarness(service);
      const cleanup = rendered.effects[0]?.();

      expect(rendered.stateUpdates).toEqual([true]);
      expect(enabledChanges).toEqual([true]);
      expect(browser.listenerCount()).toBe(1);

      rendered.value.play('reveal', 'rare');
      expect(plays).toEqual(['reveal:rare']);

      let prevented = 0;
      browser.dispatch({
        altKey: false,
        code: 'KeyN',
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => {
          prevented += 1;
        },
        repeat: false,
      });
      expect(prevented).toBe(0);

      browser.dispatch({
        altKey: true,
        code: 'KeyM',
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => {
          prevented += 1;
        },
        repeat: false,
      });
      expect(prevented).toBe(1);
      expect(enabledChanges).toEqual([true, false]);
      expect(browser.values.get(audioHapticsStorageKey)).toBe('muted');

      rendered.value.setEnabled(true);
      expect(enabledChanges).toEqual([true, false, true]);
      expect(browser.values.get(audioHapticsStorageKey)).toBe('enabled');

      cleanup?.();
      expect(browser.listenerCount()).toBe(0);
      expect(disposed).toBe(1);
    } finally {
      browser.restore();
    }
  });

  test('uses a muted fallback without matchMedia and executes cue effects once per beat', () => {
    const browser = installBrowserHarness(false, false);
    try {
      const service = {
        dispose: () => undefined,
        play: () => false,
        setEnabled: () => undefined,
      };
      const rendered = renderProviderWithHookHarness(service);
      const cleanup = rendered.effects[0]?.();
      expect(rendered.stateUpdates).toEqual([false]);

      const played: string[] = [];
      let toggles = 0;
      const feedback: ProviderValue = {
        enabled: true,
        play: (beat, rarity) => played.push(`${beat}:${rarity}`),
        setEnabled: () => undefined,
        toggle: () => {
          toggles += 1;
        },
      };
      const cueHarness = renderCueWithHookHarness(feedback);

      cueHarness.render('reveal', 'chase');
      cueHarness.runLatestEffect();
      cueHarness.runLatestEffect();
      expect(played).toEqual(['reveal:chase']);

      cueHarness.render('idle', 'chase');
      cueHarness.runLatestEffect();
      cueHarness.render('reveal', 'chase');
      cueHarness.runLatestEffect();
      expect(played).toEqual(['reveal:chase', 'reveal:chase']);

      const enabledControl = cueHarness.renderControl();
      const enabledMarkup = renderToStaticMarkup(enabledControl);
      expect(enabledMarkup).toContain('aria-pressed="true"');
      expect(enabledMarkup).toContain('Sound and haptics on');
      expect(enabledMarkup).toContain('Sound on');
      enabledControl.props.onClick();
      expect(toggles).toBe(1);

      cueHarness.restore();
      cleanup?.();
    } finally {
      browser.restore();
    }
  });

  test('uses default browser adapters without treating unsupported vibration as an error', () => {
    const browser = installBrowserHarness(false);
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const vibrations: (number | number[])[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        vibrate: (pattern: number | number[]) => {
          vibrations.push(pattern);
          return true;
        },
      },
    });

    try {
      let plays = 0;
      const service = createAudioHapticsService({
        createHowl: () => ({
          play: () => {
            plays += 1;
            return plays;
          },
          stop: () => undefined,
          unload: () => undefined,
          volume: () => undefined,
        }),
      });

      service.setEnabled(true);
      expect(service.play('reveal', 'common')).toBe(true);
      expect(plays).toBeGreaterThanOrEqual(0);
      expect(vibrations).toEqual([[12]]);
      service.setEnabled(false);
      expect(vibrations.at(-1)).toBe(0);

      browser.values.set(audioHapticsStorageKey, 'enabled');
      expect(readStoredAudioHapticsPreference()).toBe('enabled');
      expect(writeStoredAudioHapticsPreference('muted')).toBe(true);
      expect(browser.values.get(audioHapticsStorageKey)).toBe('muted');
    } finally {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'navigator');
      }
      browser.restore();
    }
  });

  test('keeps the control focus-visible and compact on mobile with reduced-motion parity', () => {
    const css = readFileSync(new URL('./audio-haptics.module.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('./audio-haptics.tsx', import.meta.url), 'utf8');

    expect(css).toMatch(/\.control\s*\{[^}]*min-block-size: 2\.75rem;/s);
    expect(css).toContain('.control:focus-visible');
    expect(css).toContain('.control[aria-pressed="true"]');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(source).toContain("document.addEventListener('keydown', handleShortcut)");
    expect(source).toContain('Howler.ctx.state');
  });
});

function renderProviderWithHookHarness(service: {
  dispose(): void;
  play(beat: string, rarity: string): boolean;
  setEnabled(enabled: boolean): void;
}): {
  effects: Effect[];
  stateUpdates: boolean[];
  value: ProviderValue;
} {
  const effects: Effect[] = [];
  const stateUpdates: boolean[] = [];
  const previousDispatcher = reactClientInternals.H;
  reactClientInternals.H = {
    useCallback<T>(callback: T) {
      return callback;
    },
    useContext<_T>() {
      throw new Error('Provider does not read context.');
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useRef<T>(initialValue: T) {
      return { current: initialValue };
    },
    useState<T>(initialValue: T | (() => T)) {
      const value = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
      return [
        value,
        (nextValue) => {
          stateUpdates.push(nextValue as boolean);
        },
      ];
    },
  };

  try {
    const provider = AudioHapticsProvider({
      children: <span>Game surface</span>,
      service,
    }) as ReactElement<{ value: ProviderValue }>;
    return { effects, stateUpdates, value: provider.props.value };
  } finally {
    reactClientInternals.H = previousDispatcher;
  }
}

function renderCueWithHookHarness(feedback: ProviderValue) {
  const effects: Effect[] = [];
  const previousCue = { current: null as string | null };
  const previousDispatcher = reactClientInternals.H;
  reactClientInternals.H = {
    useCallback<T>(callback: T) {
      return callback;
    },
    useContext<T>() {
      return feedback as T;
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useRef<T>() {
      return previousCue as RefObject<T>;
    },
    useState<T>(initialValue: T | (() => T)) {
      return [
        typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue,
        () => undefined,
      ];
    },
  };

  return {
    render(
      beat: 'anticipation' | 'celebrate' | 'hold' | 'idle' | 'reveal' | 'settled',
      rarity: 'common' | 'uncommon' | 'rare' | 'chase',
    ) {
      expect(ChoreographyAudioHaptics({ beat, rarity })).toBeNull();
    },
    renderControl() {
      return AudioHapticsControl() as ReactElement<{ onClick(): void }>;
    },
    restore() {
      reactClientInternals.H = previousDispatcher;
    },
    runLatestEffect() {
      const effect = effects.at(-1);
      if (!effect) throw new Error('Expected choreography audio effect.');
      effect();
    },
  };
}

function installBrowserHarness(prefersReducedMotion: boolean, withMatchMedia = true) {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const browserWindow = {
    localStorage,
    ...(withMatchMedia
      ? {
          matchMedia: () => ({
            matches: prefersReducedMotion,
          }),
        }
      : {}),
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: browserWindow,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => {
        listeners.delete(listener);
      },
    },
  });

  return {
    dispatch(event: Partial<KeyboardEvent>) {
      for (const listener of listeners) listener(event as KeyboardEvent);
    },
    listenerCount: () => listeners.size,
    restore() {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
      if (originalDocumentDescriptor) {
        Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    },
    values,
  };
}
