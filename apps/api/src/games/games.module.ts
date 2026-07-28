import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { GachaModule } from '../gacha/gacha.module.js';
import { GamesController } from './games.controller.js';
import { GamesCatalogService } from './games-catalog.service.js';
import { GamesLobbyService } from './games-lobby.service.js';

@Module({
  controllers: [GamesController],
  imports: [AdminModule, GachaModule],
  providers: [GamesCatalogService, GamesLobbyService],
})
export class GamesModule {}
