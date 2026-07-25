import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';

import { type FantasyPosition, isFantasySport } from './fantasy-domain.js';
import type {
  FantasyOracleMode,
  MatchDataPlayerResult,
  MatchDataRequest,
  MatchDataResult,
} from './match-data-oracle.js';
import { MatchDataOracle } from './match-data-oracle.js';

const MOCK_ORACLE_PROVIDER = 'dailydraft.mock-match-data.v1';
const MOCK_LINEUP: readonly { position: FantasyPosition; slots: number }[] = [
  { position: 'GOALKEEPER', slots: 1 },
  { position: 'DEFENDER', slots: 4 },
  { position: 'MIDFIELDER', slots: 3 },
  { position: 'FORWARD', slots: 3 },
];

/**
 * Deterministic, devnet-only fixture adapter. Given the same match reference it
 * always returns the same finalized stat lines, so scoring and payout math can be
 * exercised end to end without a live feed. It is never a source of production
 * truth and refuses to run outside devnet.
 */
@Injectable()
export class MockMatchDataOracle extends MatchDataOracle {
  readonly mode: FantasyOracleMode = 'mock';

  async getMatchResult(request: MatchDataRequest): Promise<MatchDataResult> {
    assertDevnetMockEnabled();
    if (!isFantasySport(request.sport)) {
      throw new ConflictException('The mock match-data oracle requires a known fantasy sport');
    }
    if (typeof request.matchReference !== 'string' || request.matchReference.length === 0) {
      throw new ConflictException('The mock match-data oracle requires a match reference');
    }

    const seed = digest(`${request.sport}:${request.matchReference}`);
    const players: MatchDataPlayerResult[] = [];
    let cursor = 0;
    for (const line of MOCK_LINEUP) {
      for (let slot = 0; slot < line.slots; slot += 1) {
        const playerSeed = digest(`${seed}:${line.position}:${slot}`);
        players.push({
          playerReference: `mock_player_${playerSeed.slice(0, 40)}`,
          position: line.position,
          statLine: mockStatLine(line.position, playerSeed),
        });
        cursor += 1;
      }
    }

    return {
      matchReference: request.matchReference,
      observedAt: new Date().toISOString(),
      players,
      providerReference: `${MOCK_ORACLE_PROVIDER}:${seed.slice(0, 32)}:${cursor}`,
      sport: request.sport,
      status: 'final',
    };
  }
}

function mockStatLine(position: FantasyPosition, seed: string): Readonly<Record<string, number>> {
  const pick = (offset: number, modulo: number): number =>
    Number.parseInt(seed.slice(offset, offset + 4), 16) % modulo;

  const minutesPlayed = 60 + pick(0, 31);
  switch (position) {
    case 'GOALKEEPER':
      return Object.freeze({
        cleanSheet: pick(4, 2),
        goalsConceded: pick(8, 4),
        minutesPlayed,
        saves: pick(12, 8),
      });
    case 'DEFENDER':
      return Object.freeze({
        cleanSheet: pick(4, 2),
        goals: pick(8, 2),
        interceptions: pick(12, 6),
        minutesPlayed,
        tackles: pick(16, 8),
      });
    case 'MIDFIELDER':
      return Object.freeze({
        assists: pick(4, 3),
        goals: pick(8, 3),
        keyPasses: pick(12, 6),
        minutesPlayed,
        tackles: pick(16, 5),
      });
    default:
      return Object.freeze({
        assists: pick(4, 3),
        goals: pick(8, 4),
        minutesPlayed,
        shotsOnTarget: pick(12, 6),
      });
  }
}

function assertDevnetMockEnabled(): void {
  const network = process.env.DAILYDRAFT_NETWORK ?? 'solana-devnet';
  if (network !== 'solana-devnet') {
    throw new ConflictException('The deterministic mock match-data oracle is devnet-only');
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
