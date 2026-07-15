import { Module } from '@nestjs/common';

import { PacksController } from './packs.controller.js';
import { PacksService } from './packs.service.js';

@Module({
  controllers: [PacksController],
  exports: [PacksService],
  providers: [PacksService],
})
export class PacksModule {}
