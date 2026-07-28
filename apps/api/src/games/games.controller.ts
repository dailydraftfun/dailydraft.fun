import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GamesCatalogService } from './games-catalog.service.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { ListVerifiedGameActivityQuery } from './games-lobby.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GamesLobbyService } from './games-lobby.service.js';

@Controller('games')
export class GamesController {
  constructor(
    private readonly catalog: GamesCatalogService,
    private readonly lobby: GamesLobbyService,
  ) {}

  @Get('catalog')
  @Header('cache-control', 'no-store')
  getCatalog() {
    return this.catalog.getCatalog();
  }

  @Get('availability')
  @Header('cache-control', 'no-store')
  getAvailability() {
    return this.lobby.getAvailability();
  }

  @Get('activity')
  async getVerifiedActivity(
    @Query() query: ListVerifiedGameActivityQuery,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const activity = await this.lobby.getVerifiedActivity(query);
    response.header('cache-control', 'public, max-age=30, stale-while-revalidate=120');
    response.header('x-robots-tag', 'noindex, nofollow, noarchive');
    return activity;
  }
}
