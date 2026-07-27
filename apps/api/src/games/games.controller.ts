import { Controller, Get, Header } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GamesCatalogService } from './games-catalog.service.js';

@Controller('games')
export class GamesController {
  constructor(private readonly catalog: GamesCatalogService) {}

  @Get('catalog')
  @Header('cache-control', 'no-store')
  getCatalog() {
    return this.catalog.getCatalog();
  }
}
