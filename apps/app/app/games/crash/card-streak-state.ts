export type CardStreakStatus = 'active' | 'busted' | 'cashed-out';

export type CardStreakCard = Readonly<{
  imageUrl: string;
  name: string;
  pressure: 'Building' | 'High' | 'Maximum' | 'Warm-up';
  value: number;
}>;

export type CardStreakState = Readonly<{
  decisionCount: number;
  round: number;
  stageIndex: number;
  status: CardStreakStatus;
}>;

export type CardStreakAction =
  | Readonly<{ type: 'cash-out' }>
  | Readonly<{ type: 'continue' }>
  | Readonly<{ type: 'replay' }>;

export const CARD_STREAK_CARDS = [
  {
    imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png',
    name: 'Pikachu',
    pressure: 'Warm-up',
    value: 18.5,
  },
  {
    imageUrl: 'https://images.pokemontcg.io/base1/10_hires.png',
    name: 'Mewtwo',
    pressure: 'Building',
    value: 42,
  },
  {
    imageUrl: 'https://images.pokemontcg.io/base1/2_hires.png',
    name: 'Blastoise',
    pressure: 'High',
    value: 54,
  },
  {
    imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    name: 'Charizard',
    pressure: 'Maximum',
    value: 72.5,
  },
] as const satisfies readonly CardStreakCard[];

export const INITIAL_CARD_STREAK_STATE: CardStreakState = {
  decisionCount: 0,
  round: 1,
  stageIndex: 0,
  status: 'active',
};

const ENTRY_FIXTURE_VALUE = 25;

export function cardStreakCardsForRound(round: number): readonly CardStreakCard[] {
  const safeRound = Math.max(1, Math.trunc(round));
  const offset = (safeRound - 1) % CARD_STREAK_CARDS.length;
  return [...CARD_STREAK_CARDS.slice(offset), ...CARD_STREAK_CARDS.slice(0, offset)];
}

export function cardStreakReducer(
  state: CardStreakState,
  action: CardStreakAction,
): CardStreakState {
  if (action.type === 'replay') {
    return {
      ...INITIAL_CARD_STREAK_STATE,
      round: state.round + 1,
    };
  }

  if (state.status !== 'active') return state;

  if (action.type === 'cash-out') {
    return {
      ...state,
      decisionCount: state.decisionCount + 1,
      status: 'cashed-out',
    };
  }

  if (state.stageIndex === CARD_STREAK_CARDS.length - 1) {
    return {
      ...state,
      decisionCount: state.decisionCount + 1,
      status: 'busted',
    };
  }

  return {
    ...state,
    decisionCount: state.decisionCount + 1,
    stageIndex: state.stageIndex + 1,
  };
}

export function fixturePotFor(stageIndex: number, round = 1): number {
  const safeStage = Math.max(0, Math.min(stageIndex, CARD_STREAK_CARDS.length - 1));
  const cards = cardStreakCardsForRound(round);
  return (
    ENTRY_FIXTURE_VALUE + cards.slice(0, safeStage + 1).reduce((sum, card) => sum + card.value, 0)
  );
}

export function nextCardFor(state: CardStreakState): CardStreakCard | null {
  if (state.status !== 'active') return null;
  return cardStreakCardsForRound(state.round)[state.stageIndex + 1] ?? null;
}

export function streakProgressFor(state: CardStreakState): number {
  return ((state.stageIndex + 1) / CARD_STREAK_CARDS.length) * 100;
}
