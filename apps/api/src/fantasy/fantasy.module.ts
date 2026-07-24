import { Module } from '@nestjs/common';

import { FantasyController } from './fantasy.controller.js';
import { FantasyKickoffSnapshotService } from './fantasy-kickoff-snapshot.service.js';
import { MatchDataOracleService } from './match-data-oracle.service.js';
import { MockMatchDataOracle } from './mock-match-data-oracle.js';

/**
 * Gated foundation module for the fantasy tournament loop. It wires the pure
 * scoring/payout calculators' collaborators — the deterministic match-data oracle
 * and the fixture-only kickoff snapshot service — behind a capabilities probe.
 * No playable mode is exposed; the loop stays gated until the oracle feed,
 * snapshot capture, and payout settlement are approved.
 */
@Module({
  controllers: [FantasyController],
  exports: [FantasyKickoffSnapshotService, MatchDataOracleService],
  providers: [FantasyKickoffSnapshotService, MatchDataOracleService, MockMatchDataOracle],
})
export class FantasyModule {}
