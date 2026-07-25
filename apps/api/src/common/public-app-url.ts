import { ServiceUnavailableException } from '@nestjs/common';

const LOCAL_APP_URL = 'http://localhost:3001';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolvePublicAppUrl(): URL {
  const configuredUrl = process.env.DAILYDRAFT_APP_URL?.trim();
  if (!configuredUrl) {
    if (isExplicitLocalDevelopment()) return new URL(LOCAL_APP_URL);
    throw new ServiceUnavailableException('DAILYDRAFT_APP_URL is not configured');
  }

  let appUrl: URL;
  try {
    appUrl = new URL(configuredUrl);
  } catch {
    throw new ServiceUnavailableException('DAILYDRAFT_APP_URL must be an absolute URL');
  }

  if (
    appUrl.protocol !== 'https:' &&
    !(isExplicitLocalDevelopment() && LOCAL_HOSTS.has(appUrl.hostname))
  ) {
    throw new ServiceUnavailableException(
      'DAILYDRAFT_APP_URL must use HTTPS outside local development',
    );
  }

  if (appUrl.username || appUrl.password) {
    throw new ServiceUnavailableException('DAILYDRAFT_APP_URL must not include credentials');
  }

  return new URL(appUrl.origin);
}

function isExplicitLocalDevelopment(): boolean {
  return (
    process.env.NODE_ENV === 'development' && process.env.VERCEL !== '1' && !process.env.VERCEL_ENV
  );
}
