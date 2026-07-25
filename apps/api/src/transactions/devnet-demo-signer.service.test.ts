import { afterEach, describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';

import { DevnetDemoSignerService } from './devnet-demo-signer.service.js';

const originalKeypair = process.env.DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON;
const originalNetwork = process.env.DAILYDRAFT_NETWORK;

afterEach(() => {
  setEnvironment('DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON', originalKeypair);
  setEnvironment('DAILYDRAFT_NETWORK', originalNetwork);
});

describe('DevnetDemoSignerService', () => {
  test('refuses to sign for any network other than devnet', async () => {
    delete process.env.DAILYDRAFT_NETWORK;

    const error = await new DevnetDemoSignerService()
      .assertReady()
      .then(() => undefined)
      .catch((value: unknown) => value);

    expectServiceUnavailable(error, 'demo signer is devnet-only');
  });

  test('reports a missing provider keypair rather than exposing a public key', () => {
    delete process.env.DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON;
    const service = new DevnetDemoSignerService();

    let error: unknown;
    try {
      error = service.publicKey;
    } catch (thrown) {
      error = thrown;
    }

    expectServiceUnavailable(error, 'keypair is not configured');
  });
});

function expectServiceUnavailable(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(503);
  expect((error as Error).message).toContain(message);
}

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
