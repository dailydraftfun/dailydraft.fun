import { afterEach, describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';

import { resolvePublicAppUrl } from './public-app-url.js';

const originalEnvironment = {
  appUrl: process.env.DAILYDRAFT_APP_URL,
  nodeEnvironment: process.env.NODE_ENV,
  vercel: process.env.VERCEL,
  vercelEnvironment: process.env.VERCEL_ENV,
};

afterEach(() => {
  setEnvironment('DAILYDRAFT_APP_URL', originalEnvironment.appUrl);
  setEnvironment('NODE_ENV', originalEnvironment.nodeEnvironment);
  setEnvironment('VERCEL', originalEnvironment.vercel);
  setEnvironment('VERCEL_ENV', originalEnvironment.vercelEnvironment);
});

describe('resolvePublicAppUrl', () => {
  test('fails closed when deployed app configuration is missing', () => {
    delete process.env.DAILYDRAFT_APP_URL;
    process.env.NODE_ENV = 'production';

    expectConfigurationFailure(() => resolvePublicAppUrl(), 'is not configured');
  });

  test('does not let a deployment marker inherit the local fallback', () => {
    delete process.env.DAILYDRAFT_APP_URL;
    process.env.NODE_ENV = 'development';
    process.env.VERCEL = '1';

    expectConfigurationFailure(() => resolvePublicAppUrl(), 'is not configured');
  });

  test('returns the canonical origin for valid deployed configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.DAILYDRAFT_APP_URL = 'https://play.dailydraft.fun/';

    expect(resolvePublicAppUrl().toString()).toBe('https://play.dailydraft.fun/');
  });

  test('preserves the localhost fallback only in explicit local development', () => {
    delete process.env.DAILYDRAFT_APP_URL;
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    expect(resolvePublicAppUrl().toString()).toBe('http://localhost:3001/');
  });

  test('rejects non-HTTPS public configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.DAILYDRAFT_APP_URL = 'http://play.dailydraft.fun';

    expectConfigurationFailure(() => resolvePublicAppUrl(), 'must use HTTPS');
  });

  test('rejects configuration that is not a parseable absolute URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.DAILYDRAFT_APP_URL = '::::';

    expectConfigurationFailure(() => resolvePublicAppUrl(), 'must be an absolute URL');
  });

  test('rejects embedded credentials so they cannot leak into published links', () => {
    process.env.NODE_ENV = 'production';
    process.env.DAILYDRAFT_APP_URL = 'https://user:pw@play.dailydraft.fun';

    expectConfigurationFailure(() => resolvePublicAppUrl(), 'must not include credentials');
  });
});

function expectConfigurationFailure(action: () => unknown, message: string): void {
  try {
    action();
    throw new Error('Expected public app configuration to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as Error).message).toContain(message);
  }
}

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
