export const DEPLOYED_REQUIRED_ENVIRONMENT_KEYS = [
  'CORS_ORIGINS',
  'DATABASE_URL',
  'DAILYDRAFT_API_KEYS',
  'DAILYDRAFT_APP_URL',
  'DAILYDRAFT_AUTH_DOMAIN',
  'DAILYDRAFT_NETWORK',
] as const;

export const PRODUCTION_REQUIRED_ENVIRONMENT_KEYS = [
  ...DEPLOYED_REQUIRED_ENVIRONMENT_KEYS,
  'CRON_SECRET',
  'DAILYDRAFT_PROVIDER_MODE',
] as const;

export type DeploymentProfile = 'local' | 'preview' | 'production';
export type PersistenceContract = 'local-development' | 'ephemeral-preview' | 'durable-postgresql';

export interface DeploymentEnvironmentContract {
  persistence: PersistenceContract;
  profile: DeploymentProfile;
  requiredKeys: readonly string[];
}

export class DeploymentEnvironmentError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid API deployment environment: ${issues.join('; ')}`);
    this.name = 'DeploymentEnvironmentError';
  }
}

export function resolveDeploymentProfile(
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentProfile {
  const vercelEnvironment = environment.VERCEL_ENV?.trim();
  if (vercelEnvironment) {
    if (vercelEnvironment === 'development') return 'local';
    if (vercelEnvironment === 'preview') return 'preview';
    if (vercelEnvironment === 'production') return 'production';
    throw new DeploymentEnvironmentError([
      'VERCEL_ENV must be development, preview, or production',
    ]);
  }
  if (environment.NODE_ENV === 'production') return 'production';
  if (environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test') return 'local';
  throw new DeploymentEnvironmentError([
    'NODE_ENV must be development, test, or production when VERCEL_ENV is absent',
  ]);
}

export function validateDeploymentEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentEnvironmentContract {
  const profile = resolveDeploymentProfile(environment);
  if (profile === 'local') {
    return { persistence: 'local-development', profile, requiredKeys: [] };
  }

  const requiredKeys =
    profile === 'production'
      ? PRODUCTION_REQUIRED_ENVIRONMENT_KEYS
      : DEPLOYED_REQUIRED_ENVIRONMENT_KEYS;
  const issues: string[] = [];

  for (const key of requiredKeys) {
    if (!environment[key]?.trim()) issues.push(`${key} is required`);
  }

  check(issues, () => validateDatabaseUrl(environment.DATABASE_URL));
  check(issues, () => validateApiKeys(environment.DAILYDRAFT_API_KEYS));
  const appUrl = check(issues, () =>
    validateHttpsOrigin('DAILYDRAFT_APP_URL', environment.DAILYDRAFT_APP_URL),
  );
  check(issues, () => validateAuthDomain(environment.DAILYDRAFT_AUTH_DOMAIN, appUrl));
  check(issues, () => validateCorsOrigins(environment.CORS_ORIGINS, appUrl));
  if (environment.DAILYDRAFT_NETWORK?.trim() !== 'solana-devnet') {
    issues.push('DAILYDRAFT_NETWORK must be solana-devnet');
  }
  check(issues, () => validatePort(environment.PORT));

  if (profile === 'production') {
    if (environment.DAILYDRAFT_PROVIDER_MODE?.trim() !== 'dailydraft-devnet') {
      issues.push('DAILYDRAFT_PROVIDER_MODE must be dailydraft-devnet in production');
    }
    if ((environment.CRON_SECRET?.trim().length ?? 0) < 32) {
      issues.push('CRON_SECRET must contain at least 32 characters');
    }
  }

  if (issues.length > 0) throw new DeploymentEnvironmentError([...new Set(issues)]);
  return {
    persistence: profile === 'production' ? 'durable-postgresql' : 'ephemeral-preview',
    profile,
    requiredKeys,
  };
}

function check<T>(issues: string[], operation: () => T): T | undefined {
  try {
    return operation();
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Unknown environment validation error');
    return undefined;
  }
}

function validateDatabaseUrl(value: string | undefined): void {
  if (!value?.trim()) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be an absolute PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }
  if (!url.hostname || !url.username || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL must include a host, user, and database name');
  }
}

function validateApiKeys(value: string | undefined): void {
  if (!value?.trim()) return;
  const keys = value.split(',').map((key) => key.trim());
  if (keys.some((key) => key.length < 32)) {
    throw new Error('DAILYDRAFT_API_KEYS must contain only keys of at least 32 characters');
  }
}

function validateHttpsOrigin(name: string, value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS origin`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be a credential-free HTTPS origin`);
  }
  return url;
}

function validateAuthDomain(value: string | undefined, appUrl: URL | undefined): void {
  if (!value?.trim() || !appUrl) return;
  if (value.trim() !== appUrl.host) {
    throw new Error('DAILYDRAFT_AUTH_DOMAIN must match DAILYDRAFT_APP_URL');
  }
}

function validateCorsOrigins(value: string | undefined, appUrl: URL | undefined): void {
  if (!value?.trim()) return;
  const origins = value
    .split(',')
    .map((origin) => validateHttpsOrigin('CORS_ORIGINS', origin.trim())?.origin);
  if (appUrl && !origins.includes(appUrl.origin)) {
    throw new Error('CORS_ORIGINS must include DAILYDRAFT_APP_URL');
  }
}

function validatePort(value: string | undefined): void {
  if (!value?.trim()) return;
  if (!/^\d+$/.test(value)) throw new Error('PORT must be an integer from 1 through 65535');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 through 65535');
  }
}
