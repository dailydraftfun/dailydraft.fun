import { Controller, Get, Header, Param } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { RgsProofService } from './rgs-proof.service.js';

@Controller('rgs')
export class RgsController {
  constructor(private readonly rgs: RgsProofService) {}

  @Get('modes')
  @Header('cache-control', 'no-store')
  listModes() {
    return {
      modes: this.rgs.listModes(),
      schemaVersion: 'dailydraft.rgs-mode-config.v1',
    };
  }

  @Get('rounds/:mode/:roundId/proof')
  @Header('cache-control', 'private, no-store')
  @Header('x-robots-tag', 'noindex, nofollow, noarchive')
  findRoundProof(@Param('mode') mode: string, @Param('roundId') roundId: string) {
    return this.rgs.findRoundProof(mode, roundId);
  }
}
