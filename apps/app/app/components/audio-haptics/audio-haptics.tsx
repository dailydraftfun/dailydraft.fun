'use client';

import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import { SpeakerHighIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { Howl, Howler, type HowlOptions } from 'howler';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ChoreographyBeat } from '../choreography/choreography-motion';
import styles from './audio-haptics.module.css';
import {
  type AudioHapticsCueId,
  audioHapticsCueFor,
  audioHapticsCueIds,
  audioHapticsStorageKey,
  resolveInitialAudioHapticsPreference,
} from './audio-haptics-cues';

type FeedbackHowl = {
  play(): number;
  stop(): unknown;
  unload(): void;
  volume(value: number): unknown;
};

type AudioHapticsServiceOptions = {
  canPlayAudio?: () => boolean;
  createHowl?: (options: HowlOptions) => FeedbackHowl;
  resumeAudio?: () => void;
  vibrate?: (pattern: number | number[]) => boolean;
};

export type AudioHapticsService = {
  dispose(): void;
  play(beat: ChoreographyBeat, rarity: PullRarity): boolean;
  setEnabled(nextEnabled: boolean): void;
};

type AudioHapticsContextValue = {
  enabled: boolean;
  play(beat: ChoreographyBeat, rarity: PullRarity): void;
  setEnabled(nextEnabled: boolean): void;
  toggle(): void;
};

type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const cueSources: Record<AudioHapticsCueId, string> = {
  anticipation:
    'data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAACAgIGChIWGh4aFg4B8eXVycG9wcnZ8gomQlpqbm5iSioB2bWReW1tfZnF9ipeiq6+uqZ+Sg3JiVUxISlJeb4KWp7W+wLuvnolzXUs+OTtGV26Hn7XFzczDsZl9YUk3LS04S2WDobzP2NfKtJd3VzwqIic4UnKVtc/e4dbAoX5aOyUcITJPc5m81uXl1ruYcEstHBklP2KKsdDk6N3Dn3dPLxwYJD9kjbXU5ufYu5RrRCgaHC9QeKLF3ubdxKB3TzAfHi9NdJ3B2eHYwJx0TjEjJjlZgKbF19nKroljQy8qNk9ylrbL0sixkG1OOTM8UnGSsMPIv6mLbFFBPkheepeuu7ywmn9lUklMWnCInq2xq5yHcV9WVl9vg5ShpaGWhnZpYmJpdYKOlpmVjYJ4cW5vdXyDiYyLiIR/fHp7fH6AgA==',
  celebration:
    'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YSADAACAgIGBgYB/fn1+gIKEhIOBfnt6e36ChoiGg315d3h8goiLioV+d3R0eoKJjo2If3ZxcXaAipCRi4F2b21zfYmSlY+Ed21qbnqIlJiUiHlsZmp2hpSbmIx7bGRmcoOUnZyRf21iYW1/kp+hloNvYF1ne5CgpJuIcWBaYnWNoKihjXVgV11wiZ+qppN5YlVYaoSdrKuaf2RUU2N+mq2voIVoU09deJass6aMbFRMV3GRq7ask3JWSVFqi6m4spp4WUhLYoSluLehf7O5m2xJSWydu7SLW0JRfqy/qXlNQV6Qub2bZ0NGbqLBtolVPVCBssOqdUc9XpW/wJlhPUNxqMa3hVA5T4W4x6lwQjpgmsTCl1w4QnStyriCSjVQib3KqGw8OGKfyMSUVzRCd7LOt31FMlGOwsylZzg3ZaTMxJBSMUJ7t9C2eUAwU5PGzaNiNDdoqdDDjE0uRIC80rR0PDBWmMrNn10xOGyu0sKISS1GhMDTsXA5MFqczc2bWS85cLLTwINFLEmJw9OtazYwXaHPWq3UqVYsVajUrlssUKPTsmAtS53St2YuR5fRu2swQ5LPv3EyP4zNwnc0PIbKxX03OYDHyII7N3vEyog+NXXAzI5CM3C8zZNGMmq4zphLMWWzz55PMWCuz6JUMVupzqdZMlekzqtfM1OfzK9kNE+ay7NpNkyUybZuOEmPxrl0O0aKxLt5PkSFwb1+QUJ/vb+DRUF7usCISEB2tsGNTD9xssGRUD9trsGVVT9pqcGZWT9lpcCdXUBioL+gYkJfnL6jZkNcmLyla0VZR3y2p2RHdbKsbEdvra9zSWmnsXpLY6GzgU5em7OHUluVs41WV46yk1tViLCYYVSCrZxmU3yqn2xUd6aicVVyoaR3Vm2dpXxZapimgVxnk6aGX2SOpYpjY4mjjmdihaGRa2GAnpRvYn2clnNieZiXd2R2lZd7ZnSSmH5oco6XgWpwi5aEbXCIlYZwb4WTiHNwgpGJdXCAj4p4cX6NinpzfYuKfXR8iIp+dnuGiYB4e4SHgXp7g4aBfHyChIF9fYGDgX9+gIGAgA==',
  reveal:
    'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YZABAACAgIGCg4OCgH57enl6fICEiIuLiYV/eXNwcXV7hIySlJKLgnduaGhueIWRmZyZj4FyZmBia3qLmqOjmop3ZltZYXKHm6iropB5Y1VSXHCJoK+xpY5zW01OXXeUrLezn4FjTUZQaYqourupimhMQUljhqm+wK2LZUg8R2WMsMTCqYJaPjlMcpy+yryZbUc1Pl+LtcvGqHpPNTdUgq/Ly6+AUTQ0UYGwzsytfEwxNFeJudHJo29BLTtmnMbTvo5YMy9NgbXSzKVtPiw+bqXM0bJ8SC04Y5zH07iDTS82YJnG0reCTC85ZZ7Iz7B5Ri9BcanMyaJpPTJPhbjOvItVNT1nnsXIpW9CN1OGt8m0g1E5SHWoxbuRXT5Ea56/vZhmQ0RnmLu7mmpHRmeWt7eXaUpLbJm2spBlS1J1nrSqhl9OXICksJ56WlNpjaipkG1XXXmZqJ1/Y1triaChjHBgZX2Wn5N7Z2V1jJqVgm5ocoaUlIZ1bHKCj5CHeXF1gIqMhnx2eH+GiIR+enyAg4OBf39/',
};

const inactiveAudioHaptics: AudioHapticsContextValue = {
  enabled: false,
  play: () => undefined,
  setEnabled: () => undefined,
  toggle: () => undefined,
};

const AudioHapticsContext = createContext<AudioHapticsContextValue>(inactiveAudioHaptics);

export function createAudioHapticsService(
  options: AudioHapticsServiceOptions = {},
): AudioHapticsService {
  const createHowl =
    options.createHowl ??
    ((howlOptions: HowlOptions) => new Howl(howlOptions) as unknown as FeedbackHowl);
  const canPlayAudio = options.canPlayAudio ?? defaultCanPlayAudio;
  const resumeAudio = options.resumeAudio ?? defaultResumeAudio;
  const vibrate = options.vibrate ?? browserVibrate;
  let bank: Record<AudioHapticsCueId, FeedbackHowl> | null = null;
  let enabled = false;

  function ensureBank(): Record<AudioHapticsCueId, FeedbackHowl> {
    if (bank) return bank;
    bank = Object.fromEntries(
      audioHapticsCueIds.map((id) => [
        id,
        createHowl({
          format: ['wav'],
          onloaderror: () => undefined,
          onplayerror: () => undefined,
          preload: true,
          src: [cueSources[id]],
          volume: 0,
        }),
      ]),
    ) as Record<AudioHapticsCueId, FeedbackHowl>;
    return bank;
  }

  return {
    dispose() {
      if (!bank) return;
      for (const howl of Object.values(bank)) howl.unload();
      bank = null;
      enabled = false;
    },
    play(beat, rarity) {
      if (!enabled) return false;
      const cue = audioHapticsCueFor(beat, rarity);
      if (!cue) return false;
      const howls = ensureBank();
      let played = false;

      if (canPlayAudio()) {
        howls[cue.id].stop();
        howls[cue.id].volume(cue.gain);
        howls[cue.id].play();
        played = true;
      }

      if (cue.hapticPattern.length > 0) {
        played = vibrate([...cue.hapticPattern]) || played;
      }
      return played;
    },
    setEnabled(nextEnabled) {
      if (nextEnabled === enabled) return;
      enabled = nextEnabled;

      if (nextEnabled) {
        ensureBank();
        resumeAudio();
        return;
      }
      for (const howl of Object.values(ensureBank())) howl.stop();
      vibrate(0);
    },
  };
}

export function AudioHapticsProvider({
  children,
  service,
}: {
  children: ReactNode;
  service?: AudioHapticsService;
}) {
  const [enabled, setEnabledState] = useState(false);
  const enabledRef = useRef(false);
  const serviceRef = useRef<AudioHapticsService | null>(null);
  serviceRef.current ??= service ?? createAudioHapticsService();

  const setEnabled = useCallback((nextEnabled: boolean) => {
    enabledRef.current = nextEnabled;
    setEnabledState(nextEnabled);
    serviceRef.current?.setEnabled(nextEnabled);
    writeStoredAudioHapticsPreference(nextEnabled ? 'enabled' : 'muted');
  }, []);

  const toggle = useCallback(() => setEnabled(!enabledRef.current), [setEnabled]);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const initialPreference = resolveInitialAudioHapticsPreference(
      readStoredAudioHapticsPreference(),
      prefersReducedMotion,
    );
    enabledRef.current = initialPreference.enabled;
    setEnabledState(initialPreference.enabled);
    serviceRef.current?.setEnabled(initialPreference.enabled);

    function handleShortcut(event: KeyboardEvent) {
      if (!isAudioHapticsShortcut(event)) return;
      event.preventDefault();
      toggle();
    }

    document.addEventListener('keydown', handleShortcut);
    return () => {
      document.removeEventListener('keydown', handleShortcut);
      serviceRef.current?.dispose();
    };
  }, [toggle]);

  const play = useCallback((beat: ChoreographyBeat, rarity: PullRarity) => {
    serviceRef.current?.play(beat, rarity);
  }, []);

  return (
    <AudioHapticsContext.Provider value={{ enabled, play, setEnabled, toggle }}>
      {children}
    </AudioHapticsContext.Provider>
  );
}

export function AudioHapticsControl() {
  const feedback = useContext(AudioHapticsContext);
  const label = feedback.enabled ? 'Sound and haptics on' : 'Sound and haptics off';

  return (
    <button
      aria-keyshortcuts="Alt+M"
      aria-label={`${label}. Toggle with Alt+M.`}
      aria-pressed={feedback.enabled}
      className={styles.control}
      onClick={feedback.toggle}
      title={`${label} · Alt+M`}
      type="button"
    >
      {feedback.enabled ? (
        <SpeakerHighIcon aria-hidden="true" size={17} weight="fill" />
      ) : (
        <SpeakerSlashIcon aria-hidden="true" size={17} weight="bold" />
      )}
      <span className={styles.label}>{feedback.enabled ? 'Sound on' : 'Sound off'}</span>
      <kbd className={styles.shortcut}>⌥M</kbd>
    </button>
  );
}

export function ChoreographyAudioHaptics({
  beat,
  rarity,
}: {
  beat: ChoreographyBeat;
  rarity: PullRarity;
}) {
  const feedback = useContext(AudioHapticsContext);
  const previousCue = useRef<string | null>(null);

  useEffect(() => {
    const cue = audioHapticsCueFor(beat, rarity);
    if (!cue) {
      previousCue.current = null;
      return;
    }
    const cueKey = `${beat}:${rarity}`;
    if (previousCue.current === cueKey) return;
    previousCue.current = cueKey;
    feedback.play(beat, rarity);
  }, [beat, feedback, rarity]);

  return null;
}

export function isAudioHapticsShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'repeat'>,
): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat && event.code === 'KeyM';
}

export function readStoredAudioHapticsPreference(
  storage: PreferenceStorage | null = browserStorage(),
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(audioHapticsStorageKey);
  } catch {
    return null;
  }
}

export function writeStoredAudioHapticsPreference(
  preference: 'enabled' | 'muted',
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(audioHapticsStorageKey, preference);
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): PreferenceStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function defaultCanPlayAudio(): boolean {
  return !Howler.ctx || Howler.ctx.state === 'running';
}

function defaultResumeAudio(): void {
  if (!Howler.ctx || Howler.ctx.state !== 'suspended') return;
  void Howler.ctx.resume().catch(() => undefined);
}

function browserVibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  return navigator.vibrate(pattern);
}
