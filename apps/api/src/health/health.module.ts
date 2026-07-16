import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController], imports: [AdminModule] })
export class HealthModule {}
