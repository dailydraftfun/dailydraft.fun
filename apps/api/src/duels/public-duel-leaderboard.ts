import type { Duel, Money } from '../domain.js';
import { pseudonymizeWallet } from './public-duel-proof.js';

export interface PublicDuelLeaderboard {
  entries: PublicDuelLeaderboardEntry[];
  methodology: {
    entryLimit: number;
    excludesMockResults: true;
    hasMoreSettledDuels: boolean;
    ranking: 'wins-total-value-completed-recency';
    sampleLimit: number;
    sampledSettledDuels: number;
  };
  privacy: {
    indexable: false;
    reason: string;
  };
  schemaVersion: 'openpacksduel.leaderboard.v1';
}

export interface PublicDuelLeaderboardEntry {
  display: string;
  lastPlayedAt: string;
  profileHref: string;
  rank: number;
  record: {
    completed: number;
    losses: number;
    ties: number;
    wins: number;
  };
  totalWonValue: Money;
}

type MutableLeaderboardEntry = {
  completed: number;
  lastPlayedAt: string;
  losses: number;
  ties: number;
  totalWonAmount: bigint;
  wallet: string;
  wins: number;
};

type LeaderboardCacheEntry = {
  expiresAt: number | null;
  snapshot: Promise<PublicDuelLeaderboard>;
};

const ZERO_VALUE = {
  amount: '0',
  currency: 'USDC',
  decimals: 6,
} as const satisfies Money;

const LEADERBOARD_SNAPSHOT_TTL_MS = 30_000;

export class PublicDuelLeaderboardCache {
  #entry: LeaderboardCacheEntry | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LEADERBOARD_SNAPSHOT_TTL_MS,
  ) {}

  get(loader: () => Promise<PublicDuelLeaderboard>): Promise<PublicDuelLeaderboard> {
    const now = this.now();
    if (this.#entry && (this.#entry.expiresAt === null || this.#entry.expiresAt > now)) {
      return this.#entry.snapshot;
    }

    const snapshot = Promise.resolve().then(loader);
    const entry: LeaderboardCacheEntry = { expiresAt: null, snapshot };
    this.#entry = entry;
    void snapshot.then(
      () => {
        if (this.#entry === entry) entry.expiresAt = this.now() + this.ttlMs;
      },
      () => {
        if (this.#entry === entry) this.#entry = null;
      },
    );
    return snapshot;
  }
}

export function buildPublicDuelLeaderboard(
  duels: Duel[],
  hasMoreSettledDuels: boolean,
  sampleLimit: number,
  entryLimit: number,
  houseWallet: string,
): PublicDuelLeaderboard {
  const entries = new Map<string, MutableLeaderboardEntry>();
  let sampledSettledDuels = 0;

  for (const duel of duels) {
    if (!isRankableDuel(duel)) continue;
    sampledSettledDuels += 1;

    const wallets = [duel.creatorWallet, duel.opponentWallet].filter(
      (wallet) => wallet !== houseWallet,
    );
    const totalValue = sumMoney(duel.result.outcomes.map((outcome) => outcome.insuredValue));

    for (const wallet of wallets) {
      const playedAt = duel.settledAt;
      const entry = entries.get(wallet) ?? {
        completed: 0,
        lastPlayedAt: playedAt,
        losses: 0,
        ties: 0,
        totalWonAmount: 0n,
        wallet,
        wins: 0,
      };
      entry.completed += 1;
      if (playedAt > entry.lastPlayedAt) entry.lastPlayedAt = playedAt;

      if (!duel.winnerWallet) {
        entry.ties += 1;
      } else if (duel.winnerWallet === wallet) {
        entry.wins += 1;
        entry.totalWonAmount += BigInt(totalValue.amount);
      } else {
        entry.losses += 1;
      }
      entries.set(wallet, entry);
    }
  }

  const ranked = [...entries.values()]
    .sort(compareEntries)
    .slice(0, entryLimit)
    .map(
      (entry, index): PublicDuelLeaderboardEntry => ({
        display: pseudonymizeWallet(entry.wallet),
        lastPlayedAt: entry.lastPlayedAt,
        profileHref: `/profile/${encodeURIComponent(entry.wallet)}`,
        rank: index + 1,
        record: {
          completed: entry.completed,
          losses: entry.losses,
          ties: entry.ties,
          wins: entry.wins,
        },
        totalWonValue: {
          ...ZERO_VALUE,
          amount: entry.totalWonAmount.toString(),
        },
      }),
    );

  return {
    entries: ranked,
    methodology: {
      entryLimit,
      excludesMockResults: true,
      hasMoreSettledDuels,
      ranking: 'wins-total-value-completed-recency',
      sampleLimit,
      sampledSettledDuels,
    },
    privacy: {
      indexable: false,
      reason:
        'Ranks use shortened wallet labels. Profile links resolve to public Solana identifiers and must not be indexed.',
    },
    schemaVersion: 'openpacksduel.leaderboard.v1',
  };
}

function isRankableDuel(duel: Duel): duel is Duel & {
  opponentWallet: string;
  result: NonNullable<Duel['result']>;
  settledAt: string;
} {
  if (
    duel.status !== 'settled' ||
    !duel.opponentWallet ||
    !duel.result ||
    !duel.settledAt ||
    duel.providerMode === 'mock' ||
    duel.result.outcomes.length !== 2 ||
    duel.result.outcomes.some((outcome) => outcome.isMock)
  ) {
    return false;
  }
  return (
    duel.winnerWallet === null ||
    duel.winnerWallet === duel.creatorWallet ||
    duel.winnerWallet === duel.opponentWallet
  );
}

function compareEntries(left: MutableLeaderboardEntry, right: MutableLeaderboardEntry): number {
  if (left.wins !== right.wins) return right.wins - left.wins;
  if (left.totalWonAmount !== right.totalWonAmount) {
    return left.totalWonAmount > right.totalWonAmount ? -1 : 1;
  }
  if (left.completed !== right.completed) return right.completed - left.completed;
  const recency = right.lastPlayedAt.localeCompare(left.lastPlayedAt);
  return recency || left.wallet.localeCompare(right.wallet);
}

function sumMoney(values: Money[]): Money {
  const first = values[0] ?? ZERO_VALUE;
  if (
    values.some((value) => value.currency !== first.currency || value.decimals !== first.decimals)
  ) {
    throw new Error('Cannot aggregate leaderboard values with different currencies or decimals');
  }
  return {
    amount: values.reduce((total, value) => total + BigInt(value.amount), 0n).toString(),
    currency: first.currency,
    decimals: first.decimals,
  };
}
