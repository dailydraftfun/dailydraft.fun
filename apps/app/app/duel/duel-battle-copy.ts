// Small, independently testable copy helpers for the DuelArena battle view.
//
// These strings previously lived inline inside DuelArena's ~2,200-line render tree,
// gated behind runtime-only state (an accepted duel, a house opponent) that no test
// exercised. Pulling them out into pure functions lets the exact rebrand-sensitive
// copy be asserted directly, without having to drive DuelArena's full interactive
// lifecycle just to reach these lines.

export const DUEL_SHARE_RESULT_TITLE = 'Card Duel result';

export function battleEyebrowLabel(tier: string): string {
  return `${tier} Card Duel`;
}

export function opponentWalletLabel(params: {
  creatorWallet: string;
  houseOpponent: boolean;
  opponentWallet: string;
  shortenWallet: (address: string) => string | null;
  viewerAddress: string | null;
}): string {
  if (params.houseOpponent) return 'DailyDraft House';
  const counterpartWallet =
    params.viewerAddress === params.opponentWallet ? params.creatorWallet : params.opponentWallet;
  return params.shortenWallet(counterpartWallet) ?? 'Opponent wallet';
}
