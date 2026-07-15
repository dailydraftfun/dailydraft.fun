import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabaseClient, type DatabaseClient } from '@openpacksduel/db';

import { DATABASE_CLIENT } from './database.constants.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.$disconnect();
  }
}

@Global()
@Module({
  exports: [DATABASE_CLIENT],
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: () => createDatabaseClient(),
    },
    DatabaseLifecycle,
  ],
})
export class DatabaseModule {}
