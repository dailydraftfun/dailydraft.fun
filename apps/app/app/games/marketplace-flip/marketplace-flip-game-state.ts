export type FlipCall = 'core' | 'floor' | 'chase';

export type MarketplaceFlipPhase = 'pick' | 'committed' | 'revealing' | 'result' | 'receipt';

export type MarketplaceFlipGameState = {
  call: FlipCall;
  lastPoints: number;
  phase: MarketplaceFlipPhase;
  round: number;
  score: number;
  streak: number;
};

export type MarketplaceFlipGameAction =
  | { call: FlipCall; type: 'call-selected' }
  | { type: 'call-committed' }
  | { type: 'card-flipped' }
  | { type: 'reveal-completed' }
  | { type: 'receipt-opened' }
  | { type: 'round-replayed' };

const FLIP_RESULT_SEQUENCE = ['chase', 'floor', 'core'] as const satisfies readonly FlipCall[];

export const FIXTURE_RESULT_CALL: FlipCall = FLIP_RESULT_SEQUENCE[0];

export const INITIAL_MARKETPLACE_FLIP_GAME_STATE: MarketplaceFlipGameState = {
  call: 'core',
  lastPoints: 0,
  phase: 'pick',
  round: 1,
  score: 0,
  streak: 0,
};

export function flipResultCallForRound(round: number): FlipCall {
  const safeRound = Math.max(1, Math.trunc(round));
  return FLIP_RESULT_SEQUENCE[(safeRound - 1) % FLIP_RESULT_SEQUENCE.length] ?? FIXTURE_RESULT_CALL;
}

export function pointsForFlipCall(
  call: FlipCall,
  resultCall: FlipCall = FIXTURE_RESULT_CALL,
): number {
  return call === resultCall ? (call === 'chase' ? 3 : call === 'core' ? 2 : 1) : 0;
}

export function marketplaceFlipGameReducer(
  state: MarketplaceFlipGameState,
  action: MarketplaceFlipGameAction,
): MarketplaceFlipGameState {
  switch (action.type) {
    case 'call-selected':
      return state.phase === 'pick' ? { ...state, call: action.call } : state;
    case 'call-committed':
      return state.phase === 'pick' ? { ...state, phase: 'committed' } : state;
    case 'card-flipped':
      return state.phase === 'committed' ? { ...state, phase: 'revealing' } : state;
    case 'reveal-completed': {
      if (state.phase !== 'revealing') return state;
      const points = pointsForFlipCall(state.call, flipResultCallForRound(state.round));
      return {
        ...state,
        lastPoints: points,
        phase: 'result',
        score: state.score + points,
        streak: points > 0 ? state.streak + 1 : 0,
      };
    }
    case 'receipt-opened':
      return state.phase === 'result' ? { ...state, phase: 'receipt' } : state;
    case 'round-replayed':
      return state.phase === 'result' || state.phase === 'receipt'
        ? {
            ...state,
            lastPoints: 0,
            phase: 'pick',
            round: state.round + 1,
          }
        : state;
  }
}

export function flipCallLabel(call: FlipCall): string {
  switch (call) {
    case 'floor':
      return 'Floor';
    case 'core':
      return 'Core';
    case 'chase':
      return 'Chase';
  }
}
