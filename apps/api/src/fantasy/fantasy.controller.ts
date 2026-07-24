import { Controller, Get, Header } from '@nestjs/common';

import type { FantasyOracleMode } from './match-data-oracle.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { MatchDataOracleService } from './match-data-oracle.service.js';

type FantasyCapabilityAvailability = {
  enabled: boolean;
  reason: string | null;
};

// Reason surfaced while the loop is gated. Live entries stay disabled until the
// oracle feed, kickoff snapshot, and payout math are reviewed and approved.
const FANTASY_GATED_REASON =
  'Fantasy tournaments are not yet playable on Solana devnet. The match-data oracle, kickoff snapshot, and payout settlement are pending review.';

export type FantasyProductCapabilities = {
  modes: {
    tournaments: FantasyCapabilityAvailability;
    entries: FantasyCapabilityAvailability;
    payouts: FantasyCapabilityAvailability;
  };
  network: 'solana-devnet';
  oracle: { mode: FantasyOracleMode; live: boolean };
};

/**
 * Read-only surface for the gated fantasy tournament loop. Only the capabilities
 * probe is exposed in this foundation pass; every playable mode reports disabled
 * so no live entry, scoring, or payout can occur before the engine is approved.
 */
@Controller('fantasy')
export class FantasyController {
  constructor(private readonly oracle: MatchDataOracleService) {}

  @Get('capabilities')
  @Header('Cache-Control', 'no-store')
  getCapabilities(): FantasyProductCapabilities {
    // Resolve the fixture adapter so the gated wiring stays exercised; the live
    // feed is intentionally unreachable from this probe.
    const oracleMode = this.oracle.forMode('mock').mode;

    return {
      modes: {
        tournaments: { enabled: false, reason: FANTASY_GATED_REASON },
        entries: { enabled: false, reason: FANTASY_GATED_REASON },
        payouts: { enabled: false, reason: FANTASY_GATED_REASON },
      },
      network: 'solana-devnet',
      oracle: { live: false, mode: oracleMode },
    };
  }
}
