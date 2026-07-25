import { describe, expect, test } from 'bun:test';
import {
  battleEyebrowLabel,
  DUEL_SHARE_RESULT_TITLE,
  opponentWalletLabel,
} from './duel-battle-copy';

describe('duel battle copy', () => {
  test('shares results under the canonical Card Duel title', () => {
    expect(DUEL_SHARE_RESULT_TITLE).toBe('Card Duel result');
  });

  test('labels the battle eyebrow with the tier and Card Duel', () => {
    expect(battleEyebrowLabel(50)).toBe('50 Card Duel');
    expect(battleEyebrowLabel(100)).toBe('100 Card Duel');
  });

  test('labels a house opponent as the DailyDraft house regardless of wallet fields', () => {
    expect(
      opponentWalletLabel({
        creatorWallet: 'creator_wallet',
        houseOpponent: true,
        opponentWallet: 'opponent_wallet',
        shortenWallet: () => 'should_not_be_used',
        viewerAddress: 'creator_wallet',
      }),
    ).toBe('DailyDraft House');
  });

  test('shortens the counterpart wallet when the viewer is the creator', () => {
    expect(
      opponentWalletLabel({
        creatorWallet: 'creator_wallet',
        houseOpponent: false,
        opponentWallet: 'opponent_wallet',
        shortenWallet: (address) => `short:${address}`,
        viewerAddress: 'creator_wallet',
      }),
    ).toBe('short:opponent_wallet');
  });

  test('shortens the counterpart wallet when the viewer is the opponent', () => {
    expect(
      opponentWalletLabel({
        creatorWallet: 'creator_wallet',
        houseOpponent: false,
        opponentWallet: 'opponent_wallet',
        shortenWallet: (address) => `short:${address}`,
        viewerAddress: 'opponent_wallet',
      }),
    ).toBe('short:creator_wallet');
  });

  test('falls back to a generic label when the wallet cannot be shortened', () => {
    expect(
      opponentWalletLabel({
        creatorWallet: 'creator_wallet',
        houseOpponent: false,
        opponentWallet: 'opponent_wallet',
        shortenWallet: () => null,
        viewerAddress: 'creator_wallet',
      }),
    ).toBe('Opponent wallet');
  });
});
