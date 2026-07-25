import { afterEach, describe, expect, test } from 'bun:test';
import { type ExecutionContext, HttpException } from '@nestjs/common';

// domain.ts is types only — the rebrand renamed the PackProviderMode union it exports and
// nothing else — so importing it here is what keeps that contract in the module graph.
import '../domain.js';
import { WorkerKeyGuard } from './worker-key.guard.js';

const originalApiKeys = process.env.DAILYDRAFT_API_KEYS;
const originalCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  setEnvironment('CRON_SECRET', originalCronSecret);
  setEnvironment('DAILYDRAFT_API_KEYS', originalApiKeys);
});

describe('WorkerKeyGuard', () => {
  test('fails closed when no worker credential is configured', () => {
    delete process.env.CRON_SECRET;
    delete process.env.DAILYDRAFT_API_KEYS;

    expectRejection(() => new WorkerKeyGuard().canActivate(requestWith(undefined)), 503);
  });

  test('rejects absent, unprefixed, and mismatched bearer credentials', () => {
    delete process.env.DAILYDRAFT_API_KEYS;
    process.env.CRON_SECRET = 'worker-secret';
    const guard = new WorkerKeyGuard();

    expectRejection(() => guard.canActivate(requestWith(undefined)), 401);
    expectRejection(() => guard.canActivate(requestWith('worker-secret')), 401);
    expectRejection(() => guard.canActivate(requestWith('Bearer not-the-secret')), 401);
  });

  test('accepts the cron secret and every comma-separated API key', () => {
    process.env.CRON_SECRET = 'worker-secret';
    process.env.DAILYDRAFT_API_KEYS = ' integration-one , integration-two ';
    const guard = new WorkerKeyGuard();

    expect(guard.canActivate(requestWith('Bearer worker-secret'))).toBe(true);
    expect(guard.canActivate(requestWith('Bearer integration-one'))).toBe(true);
    expect(guard.canActivate(requestWith('Bearer integration-two'))).toBe(true);
  });
});

function expectRejection(action: () => unknown, status: number): void {
  try {
    action();
    throw new Error('Expected the worker guard to reject the request');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}

function requestWith(authorization: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
