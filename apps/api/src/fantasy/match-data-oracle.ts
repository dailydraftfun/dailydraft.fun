import type { FantasyPosition, FantasySport } from './fantasy-domain.js';

// Adapter mode for the match-data feed. `mock` is the deterministic fixture
// adapter used while the loop is gated; `live` is reserved for a real provider
// feed (Sportradar / Opta / equivalent) that is intentionally not wired yet.
export type FantasyOracleMode = 'mock' | 'live';

export type MatchDataStatus = 'scheduled' | 'in_progress' | 'final';

export interface MatchDataRequest {
  matchReference: string;
  sport: FantasySport;
}

export interface MatchDataPlayerResult {
  playerReference: string;
  position: FantasyPosition;
  statLine: Readonly<Record<string, number>>;
}

export interface MatchDataResult {
  matchReference: string;
  observedAt: string;
  players: readonly MatchDataPlayerResult[];
  providerReference: string;
  sport: FantasySport;
  status: MatchDataStatus;
}

/**
 * Clean provider boundary for ingesting real match data. Concrete adapters map a
 * provider feed onto the neutral {@link MatchDataResult} shape the scoring engine
 * consumes. No real feed is wired in this foundation pass — only the deterministic
 * fixture adapter exists, and the loop stays gated until a live adapter is
 * approved.
 */
export abstract class MatchDataOracle {
  abstract readonly mode: FantasyOracleMode;

  abstract getMatchResult(request: MatchDataRequest): Promise<MatchDataResult>;
}
