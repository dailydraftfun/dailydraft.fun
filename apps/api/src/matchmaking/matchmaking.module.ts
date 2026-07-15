import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PacksModule } from '../packs/packs.module.js';
import { MatchmakingController } from './matchmaking.controller.js';
import { MatchmakingService } from './matchmaking.service.js';

@Module({
  controllers: [MatchmakingController],
  imports: [AdminModule, AuthModule, PacksModule],
  providers: [MatchmakingService],
})
export class MatchmakingModule {}
