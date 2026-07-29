import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import { demoCards } from '../games/demo-card-data';
import type { DurableDuel } from '../solana/duel-client';

type PracticeCard = {
  imageUrl: string;
  name: string;
  rarity: PullRarity;
  value: number;
};

const practiceRounds: ReadonlyArray<{
  bot: PracticeCard;
  player: PracticeCard;
}> = [
  {
    bot: { ...demoCards.mewtwo, rarity: 'uncommon' },
    player: { ...demoCards.charizard, rarity: 'rare' },
  },
  {
    bot: { ...demoCards.charizard, rarity: 'rare' },
    player: { ...demoCards.pikachu, rarity: 'common' },
  },
  {
    bot: { ...demoCards.mewtwo, rarity: 'uncommon' },
    player: { ...demoCards.mewtwo, rarity: 'uncommon' },
  },
];

const practicePlayer = 'DailyDraftPracticePlayer';
const practiceBot = 'DailyDraftPracticeBot';

export function createPracticeDuel({
  now = new Date(),
  round,
  tier,
}: {
  now?: Date;
  round: number;
  tier: 25 | 50 | 100;
}): DurableDuel {
  const safeRound = Math.max(1, Math.trunc(round));
  const fixture = practiceRounds[(safeRound - 1) % practiceRounds.length] ?? practiceRounds[0];
  const playerAmount = amountFor(fixture.player.value);
  const botAmount = amountFor(fixture.bot.value);
  const winnerSide =
    playerAmount === botAmount ? null : playerAmount > botAmount ? 'creator' : 'opponent';
  const id = `practice_${safeRound}`;

  return {
    createdAt: now.toISOString(),
    creatorWallet: practicePlayer,
    environment: 'solana-devnet',
    escrowAddress: null,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1_000).toISOString(),
    houseOpponent: true,
    id,
    matchmakingMode: 'house',
    opponentWallet: practiceBot,
    pack: {
      id: `practice_${tier}`,
      name: `$${tier} practice pool`,
      price: { amount: amountFor(tier).toString(), currency: 'USDC', decimals: 6 },
      provider: 'local-practice',
      providerPackId: `practice-pool-${safeRound}`,
    },
    providerMode: 'mock',
    result: {
      comparisonMetric: 'insured-value',
      outcomes: [
        outcome(fixture.player, 'creator', safeRound),
        outcome(fixture.bot, 'opponent', safeRound),
      ],
      resultHash: safeRound.toString(16).padStart(64, '0'),
      settlementReady: false,
      valuationPolicyHash: 'practice-only',
      winnerSide,
    },
    stake: { amount: amountFor(tier).toString(), currency: 'USDC', decimals: 6 },
    status: 'settled',
    transactionSignature: null,
    version: safeRound,
    winnerWallet:
      winnerSide === 'creator' ? practicePlayer : winnerSide === 'opponent' ? practiceBot : null,
  };
}

function outcome(card: PracticeCard, side: 'creator' | 'opponent', round: number) {
  return {
    assetReference: `practice-card-${round}-${side}`,
    displayName: card.name,
    imageUrl: card.imageUrl,
    insuredValue: {
      amount: amountFor(card.value).toString(),
      currency: 'USDC' as const,
      decimals: 6 as const,
    },
    isMock: true,
    provider: 'Practice deck',
    providerReference: `practice-result-${round}-${side}`,
    rarity: card.rarity,
    side,
  };
}

function amountFor(value: number): bigint {
  return BigInt(Math.round(value * 1_000_000));
}
