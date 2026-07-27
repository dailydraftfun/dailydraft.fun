import { Module } from '@nestjs/common';

import { GachaModule } from '../gacha/gacha.module.js';
import { RgsController } from './rgs.controller.js';
import { RgsProofService } from './rgs-proof.service.js';

@Module({
  controllers: [RgsController],
  imports: [GachaModule],
  providers: [RgsProofService],
})
export class RgsModule {}
