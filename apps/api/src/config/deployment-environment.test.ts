import { describe, expect, test } from 'bun:test';

import {
  DEPLOYED_REQUIRED_ENVIRONMENT_KEYS,
  DeploymentEnvironmentError,
  PRODUCTION_REQUIRED_ENVIRONMENT_KEYS,
  resolveDeploymentProfile,
  validateDeploymentEnvironment,
} from './deployment-environment.js';

describe('deployed API environment contract', () => {
  test('distinguishes local, ephemeral preview, and durable production profiles', () => {
    expect(validateDeploymentEnvironment({ NODE_ENV: 'development' })).toEqual({
      persistence: 'local-development',
      profile: 'local',
      requiredKeys: [],
    });
    expect(validateDeploymentEnvironment(validEnvironment({ VERCEL_ENV: 'preview' }))).toEqual({
      persistence: 'ephemeral-preview',
      profile: 'preview',
      requiredKeys: DEPLOYED_REQUIRED_ENVIRONMENT_KEYS,
    });
    expect(validateDeploymentEnvironment(validEnvironment())).toEqual({
      persistence: 'durable-postgresql',
      profile: 'production',
      requiredKeys: PRODUCTION_REQUIRED_ENVIRONMENT_KEYS,
    });
  });

  for (const key of PRODUCTION_REQUIRED_ENVIRONMENT_KEYS) {
    test(`rejects a production deployment without ${key}`, () => {
      const environment = validEnvironment();
      delete environment[key];
      expectIssues(environment, `${key} is required`);
    });
  }

  test('rejects malformed database, origin, auth, CORS, and network configuration', () => {
    expectIssues(
      validEnvironment({ DATABASE_URL: 'https://database.example/dailydraft' }),
      'DATABASE_URL must use',
    );
    expectIssues(
      validEnvironment({ DATABASE_URL: 'postgresql://user@database.example' }),
      'host, user, and database',
    );
    expectIssues(
      validEnvironment({ DAILYDRAFT_APP_URL: 'http://dailydraft.example' }),
      'credential-free HTTPS origin',
    );
    expectIssues(
      validEnvironment({ DAILYDRAFT_AUTH_DOMAIN: 'other.example' }),
      'must match DAILYDRAFT_APP_URL',
    );
    expectIssues(
      validEnvironment({ CORS_ORIGINS: 'https://admin.example' }),
      'must include DAILYDRAFT_APP_URL',
    );
    expectIssues(
      validEnvironment({ CORS_ORIGINS: 'https://dailydraft.example/path' }),
      'credential-free HTTPS origin',
    );
    expectIssues(
      validEnvironment({ DAILYDRAFT_NETWORK: 'solana-mainnet' }),
      'must be solana-devnet',
    );
  });

  test('rejects weak secrets, production mock mode, invalid ports, and unknown deployment markers', () => {
    expectIssues(
      validEnvironment({ DAILYDRAFT_API_KEYS: 'short' }),
      'keys of at least 32 characters',
    );
    expectIssues(validEnvironment({ CRON_SECRET: 'short' }), 'at least 32 characters');
    expectIssues(
      validEnvironment({ DAILYDRAFT_PROVIDER_MODE: 'mock' }),
      'must be dailydraft-devnet',
    );
    expectIssues(validEnvironment({ PORT: '0' }), 'PORT must be an integer');
    expectIssues(validEnvironment({ PORT: 'not-a-port' }), 'PORT must be an integer');
    expect(() => resolveDeploymentProfile({ VERCEL_ENV: 'staging' })).toThrow(
      'VERCEL_ENV must be development, preview, or production',
    );
    expect(() => resolveDeploymentProfile({})).toThrow(
      'NODE_ENV must be development, test, or production',
    );
  });

  test('allows preview fixtures to omit production-only worker and provider controls', () => {
    const environment = validEnvironment({ VERCEL_ENV: 'preview' });
    delete environment.CRON_SECRET;
    delete environment.DAILYDRAFT_PROVIDER_MODE;
    expect(validateDeploymentEnvironment(environment)).toMatchObject({
      persistence: 'ephemeral-preview',
      profile: 'preview',
    });
  });
});

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CORS_ORIGINS: 'https://dailydraft.example,https://admin.dailydraft.example',
    CRON_SECRET: 'cron-secret-that-is-at-least-32-characters',
    DATABASE_URL: 'postgresql://dailydraft:secret@database.example/dailydraft',
    NODE_ENV: 'production',
    DAILYDRAFT_API_KEYS: 'api-key-that-is-at-least-32-characters',
    DAILYDRAFT_APP_URL: 'https://dailydraft.example',
    DAILYDRAFT_AUTH_DOMAIN: 'dailydraft.example',
    DAILYDRAFT_NETWORK: 'solana-devnet',
    DAILYDRAFT_PROVIDER_MODE: 'dailydraft-devnet',
    DAILYDRAFT_TRUSTED_PROXIES: '172.18.0.2',
    PORT: '3003',
    VERCEL_ENV: 'production',
    ...overrides,
  };
}

function expectIssues(environment: NodeJS.ProcessEnv, expected: string): void {
  try {
    validateDeploymentEnvironment(environment);
    throw new Error('Expected deployment validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DeploymentEnvironmentError);
    expect((error as DeploymentEnvironmentError).issues.join('; ')).toContain(expected);
  }
}
