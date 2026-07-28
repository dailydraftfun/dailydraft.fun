import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { GachaRipService } from './gacha/gacha-rip.service.js';
import { createApp } from './main.js';

const ORIGINAL_ENVIRONMENT = {
  databaseUrl: process.env.DATABASE_URL,
  fixtureMode: process.env.DAILYDRAFT_GACHA_FIXTURE_MODE,
  nodeEnvironment: process.env.NODE_ENV,
  providerMode: process.env.DAILYDRAFT_PROVIDER_MODE,
};

afterEach(() => {
  restoreEnvironment('DATABASE_URL', ORIGINAL_ENVIRONMENT.databaseUrl);
  restoreEnvironment('DAILYDRAFT_GACHA_FIXTURE_MODE', ORIGINAL_ENVIRONMENT.fixtureMode);
  restoreEnvironment('DAILYDRAFT_PROVIDER_MODE', ORIGINAL_ENVIRONMENT.providerMode);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENVIRONMENT.nodeEnvironment);
});

describe('createApp', () => {
  test('runs controlled Gacha readiness bootstrap before returning the application', async () => {
    process.env.DATABASE_URL =
      'postgresql://dailydraft:dailydraft@127.0.0.1:1/dailydraft_create_app';
    process.env.NODE_ENV = 'test';
    delete process.env.DAILYDRAFT_GACHA_FIXTURE_MODE;
    delete process.env.DAILYDRAFT_PROVIDER_MODE;

    let bootstrapCompleted = false;
    const bootstrap = spyOn(
      GachaRipService.prototype,
      'bootstrapConfiguredMachines',
    ).mockImplementation(async () => {
      await Bun.sleep(10);
      bootstrapCompleted = true;
      return [];
    });
    const app = await createApp({ enableShutdownHooks: false });
    try {
      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(bootstrapCompleted).toBe(true);
      expect(app.get(GachaRipService)).toBeInstanceOf(GachaRipService);
    } finally {
      bootstrap.mockRestore();
      await app.close();
    }
  });
});

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
