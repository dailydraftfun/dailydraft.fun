export type RevealPresentationPhase = 'countdown' | 'first_reveal' | 'second_reveal' | 'resolution';

export type RevealPresentation = {
  countdown: 1 | 2 | 3 | null;
  headline: string;
  indicator: string;
  isComplete: boolean;
  phase: RevealPresentationPhase;
  showLeft: boolean;
  showResolution: boolean;
  showRight: boolean;
};

export type RevealSideResolution = 'loser' | 'tie' | 'winner';

export type StoredRevealTimeline = {
  resultKey: string;
  startedAt: number;
};

const countdownStepMs = 900;
const firstRevealDurationMs = 1_400;
const secondRevealDurationMs = 1_400;
const reducedRevealStepMs = 600;

export const revealCommitmentCopy =
  'Outcome committed before animation. Presentation cannot change it.';

export function revealPresentationAt(elapsedMs: number, reducedMotion = false): RevealPresentation {
  const elapsed = Math.max(0, elapsedMs);

  if (reducedMotion) {
    if (elapsed < reducedRevealStepMs) return firstReveal();
    if (elapsed < reducedRevealStepMs * 2) return secondReveal();
    return resolution();
  }

  const countdownDurationMs = countdownStepMs * 3;
  if (elapsed < countdownDurationMs) {
    const countdown = (3 - Math.floor(elapsed / countdownStepMs)) as 1 | 2 | 3;
    return {
      countdown,
      headline: `Outcome locked. Reveal in ${countdown}…`,
      indicator: 'Outcome committed',
      isComplete: false,
      phase: 'countdown',
      showLeft: false,
      showResolution: false,
      showRight: false,
    };
  }

  if (elapsed < countdownDurationMs + firstRevealDurationMs) return firstReveal();
  if (elapsed < countdownDurationMs + firstRevealDurationMs + secondRevealDurationMs) {
    return secondReveal();
  }
  return resolution();
}

export function revealSideResolution(
  winner: 'opponent' | 'tie' | 'you' | null,
  side: 'opponent' | 'you',
): RevealSideResolution | null {
  if (winner === null) return null;
  if (winner === 'tie') return 'tie';
  return winner === side ? 'winner' : 'loser';
}

export function revealStorageKey(duelId: string): string {
  return `dailydraft:reveal:v1:${duelId}`;
}

export function parseStoredRevealTimeline(value: string | null): StoredRevealTimeline | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<StoredRevealTimeline>;
    if (
      typeof candidate.resultKey !== 'string' ||
      typeof candidate.startedAt !== 'number' ||
      !Number.isFinite(candidate.startedAt)
    ) {
      return null;
    }
    return { resultKey: candidate.resultKey, startedAt: candidate.startedAt };
  } catch {
    return null;
  }
}

export function recoverRevealStartedAt(
  stored: StoredRevealTimeline | null,
  resultKey: string,
  now: number,
): number {
  if (!stored || stored.resultKey !== resultKey || stored.startedAt < 0 || stored.startedAt > now) {
    return now;
  }
  return stored.startedAt;
}

function firstReveal(): RevealPresentation {
  return {
    countdown: null,
    headline: 'Your committed pull is revealed',
    indicator: 'First pull visible',
    isComplete: false,
    phase: 'first_reveal',
    showLeft: true,
    showResolution: false,
    showRight: false,
  };
}

function secondReveal(): RevealPresentation {
  return {
    countdown: null,
    headline: 'Both committed values are visible',
    indicator: 'Comparing committed values',
    isComplete: false,
    phase: 'second_reveal',
    showLeft: true,
    showResolution: false,
    showRight: true,
  };
}

function resolution(): RevealPresentation {
  return {
    countdown: null,
    headline: 'Committed outcome resolved',
    indicator: 'Result revealed',
    isComplete: true,
    phase: 'resolution',
    showLeft: true,
    showResolution: true,
    showRight: true,
  };
}
