export type DuelGrowthParticipant = {
  address: string;
  label: string;
};

export type DuelGrowthParticipants = {
  creator: DuelGrowthParticipant;
  opponent: DuelGrowthParticipant;
};

export type ViewerResult = 'loss' | 'tie' | 'win';

export function resolveRematchOpponent(
  participants: DuelGrowthParticipants,
  viewerWallet?: string | null,
): DuelGrowthParticipant | null {
  if (!viewerWallet) return null;
  if (viewerWallet === participants.creator.address) return participants.opponent;
  if (viewerWallet === participants.opponent.address) return participants.creator;
  return null;
}

export function viewerResult(winner: 'opponent' | 'tie' | 'you'): ViewerResult {
  if (winner === 'you') return 'win';
  if (winner === 'opponent') return 'loss';
  return 'tie';
}

export function resultShareText(input: {
  result: ViewerResult;
  tier: string;
  winningPull: { name: string; value: string } | null;
}): string {
  if (input.result === 'tie') {
    return `My ${input.tier} Card Duel ended in a tie. Run it back with me.`;
  }

  if (!input.winningPull) {
    return input.result === 'win'
      ? `I won a ${input.tier} Card Duel. See the verified result.`
      : `I lost a ${input.tier} Card Duel. Run it back with me.`;
  }

  if (input.result === 'win') {
    return `I won a ${input.tier} Card Duel with ${input.winningPull.name} at ${input.winningPull.value}.`;
  }

  return `I lost a ${input.tier} Card Duel to ${input.winningPull.name} at ${input.winningPull.value}. Revenge is one click away.`;
}

export function rematchLabel(result: ViewerResult): string {
  if (result === 'loss') return 'Revenge rematch';
  if (result === 'tie') return 'Break the tie';
  return 'Run a rematch';
}
