import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_TRUSTED_PROXY_REFRESH_MS = 5_000;
const MAX_RATE_LIMIT_CLIENTS = 10_000;

export interface RequestBoundaryConfig {
  allowedOrigins: readonly string[];
  rateLimit: number;
  rateWindowMs: number;
  trustedProxyHosts: readonly string[];
  trustedProxyRefreshMs: number;
  trustedProxies: readonly string[];
}

export interface RequestBoundaryLog {
  durationMs: number;
  event: 'http_request_completed';
  method: string;
  rateLimit: {
    limit: number;
    remaining: number;
    resetSeconds: number;
  };
  remoteAddress: string;
  requestId: string;
  route: string;
  status: number;
}

export interface RequestBoundaryOptions {
  isTrustedProxy?: (address: string) => boolean;
  log?: (entry: RequestBoundaryLog) => void;
  now?: () => number;
}

export interface TrustedProxyPolicy {
  close(): void;
  isTrusted(address: string): boolean;
  refresh(): Promise<void>;
}

export interface TrustedProxyPolicyOptions {
  lookup?: typeof lookup;
  onRefreshError?: (error: unknown) => void;
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

export function resolveRequestBoundaryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RequestBoundaryConfig {
  const allowedOrigins = canonicalOrigins(environment.CORS_ORIGINS);
  const trustedProxies = canonicalTrustedProxies(environment.DAILYDRAFT_TRUSTED_PROXIES);
  const trustedProxyHosts = canonicalTrustedProxyHosts(environment.DAILYDRAFT_TRUSTED_PROXY_HOSTS);
  return {
    allowedOrigins,
    rateLimit: boundedInteger(environment.DAILYDRAFT_RATE_LIMIT, DEFAULT_RATE_LIMIT, 1, 10_000),
    rateWindowMs: boundedInteger(
      environment.DAILYDRAFT_RATE_WINDOW_MS,
      DEFAULT_RATE_WINDOW_MS,
      1_000,
      3_600_000,
    ),
    trustedProxyHosts,
    trustedProxyRefreshMs: boundedInteger(
      environment.DAILYDRAFT_TRUSTED_PROXY_REFRESH_MS,
      DEFAULT_TRUSTED_PROXY_REFRESH_MS,
      1_000,
      60_000,
    ),
    trustedProxies,
  };
}

export async function createTrustedProxyPolicy(
  config: Pick<
    RequestBoundaryConfig,
    'trustedProxies' | 'trustedProxyHosts' | 'trustedProxyRefreshMs'
  >,
  options: TrustedProxyPolicyOptions = {},
): Promise<TrustedProxyPolicy> {
  const resolve = options.lookup ?? lookup;
  let dynamicAddresses = new Set<string>();
  let refreshInFlight: Promise<void> | undefined;
  const staticAddresses = new Set(config.trustedProxies);

  const refresh = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const next = new Set<string>();
      for (const host of config.trustedProxyHosts) {
        const addresses = await resolve(host, { all: true, verbatim: true });
        if (addresses.length === 0) {
          throw new Error(`Trusted proxy host ${host} resolved without an address`);
        }
        for (const { address } of addresses) next.add(address);
      }
      dynamicAddresses = next;
    })().finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  };

  if (config.trustedProxyHosts.length > 0) await refresh();
  const timer =
    config.trustedProxyHosts.length > 0
      ? setInterval(() => {
          void refresh().catch(options.onRefreshError ?? (() => undefined));
        }, config.trustedProxyRefreshMs)
      : undefined;
  timer?.unref();

  return {
    close: () => {
      if (timer) clearInterval(timer);
    },
    isTrusted: (address) => staticAddresses.has(address) || dynamicAddresses.has(address),
    refresh,
  };
}

export function resolveRequestId(
  header: string | string[] | undefined,
  create: () => string = randomUUID,
): string {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : create();
}

export function registerRequestBoundary(
  instance: FastifyInstance,
  config: RequestBoundaryConfig,
  options: RequestBoundaryOptions = {},
): void {
  const now = options.now ?? Date.now;
  const logger = new Logger('HttpRequestBoundary');
  const log = options.log ?? ((entry) => logger.log(JSON.stringify(entry)));
  const isTrustedProxy =
    options.isTrustedProxy ?? ((address: string) => config.trustedProxies.includes(address));
  const startedAt = new WeakMap<FastifyRequest, number>();
  const rateLimits = new Map<string, RateLimitState>();

  instance.addHook('onRequest', (request, response, done) => {
    const observedAt = now();
    startedAt.set(request, observedAt);
    response.header('x-request-id', request.id);

    const forwardedIssue = forwardedHeaderIssue(request, isTrustedProxy);
    if (forwardedIssue) {
      sendBoundaryProblem(response, request.id, 400, forwardedIssue);
      return;
    }

    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      sendBoundaryProblem(response, request.id, 403, 'Origin is not allowed');
      return;
    }
    if (origin) {
      response.header('access-control-allow-origin', origin);
      response.header('access-control-allow-credentials', 'true');
      response.header('vary', 'Origin');
      if (request.method === 'OPTIONS') {
        response.header(
          'access-control-allow-headers',
          'authorization, content-type, idempotency-key, x-request-id',
        );
        response.header('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
        response.status(204).send();
        return;
      }
    }

    const remoteAddress = request.ip;
    const rate = consumeRateLimit(rateLimits, remoteAddress, config, observedAt);
    response.header('x-ratelimit-limit', String(config.rateLimit));
    response.header('x-ratelimit-remaining', String(rate.remaining));
    response.header('x-ratelimit-reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      response.header('retry-after', String(rate.resetSeconds));
      sendBoundaryProblem(response, request.id, 429, 'Request rate limit exceeded');
      return;
    }
    done();
  });

  instance.addHook('onResponse', (request, response, done) => {
    const observedAt = now();
    const limit = numberHeader(response.getHeader('x-ratelimit-limit'), config.rateLimit);
    const remaining = numberHeader(response.getHeader('x-ratelimit-remaining'), config.rateLimit);
    const resetSeconds = numberHeader(response.getHeader('x-ratelimit-reset'), 0);
    log({
      durationMs: Math.max(0, observedAt - (startedAt.get(request) ?? observedAt)),
      event: 'http_request_completed',
      method: request.method,
      rateLimit: { limit, remaining, resetSeconds },
      remoteAddress: request.ip,
      requestId: request.id,
      route: request.routeOptions.url ?? requestPath(request.url),
      status: response.statusCode,
    });
    done();
  });
}

function consumeRateLimit(
  states: Map<string, RateLimitState>,
  key: string,
  config: RequestBoundaryConfig,
  now: number,
): { allowed: boolean; remaining: number; resetSeconds: number } {
  let state = states.get(key);
  if (!state || state.resetAt <= now) {
    if (states.size >= MAX_RATE_LIMIT_CLIENTS) {
      const oldest = states.keys().next().value;
      if (oldest !== undefined) states.delete(oldest);
    }
    state = { count: 0, resetAt: now + config.rateWindowMs };
    states.set(key, state);
  }
  state.count += 1;
  return {
    allowed: state.count <= config.rateLimit,
    remaining: Math.max(0, config.rateLimit - state.count),
    resetSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1_000)),
  };
}

function forwardedHeaderIssue(
  request: FastifyRequest,
  isTrustedProxy: (address: string) => boolean,
): string | null {
  const remoteAddress = request.raw.socket.remoteAddress ?? '';
  const forwardingHeaders = [
    request.headers['x-forwarded-for'],
    request.headers['x-forwarded-host'],
    request.headers['x-forwarded-proto'],
  ];
  if (!isTrustedProxy(remoteAddress)) {
    return forwardingHeaders.some((header) => header !== undefined)
      ? 'Forwarded headers require a trusted proxy'
      : null;
  }

  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor === undefined) {
    return 'Trusted proxy omitted x-forwarded-for';
  }
  if (
    typeof forwardedFor !== 'string' ||
    forwardedFor
      .split(',')
      .map((address) => address.trim())
      .some((address) => isIP(address) === 0)
  ) {
    return 'Trusted proxy supplied malformed x-forwarded-for';
  }
  const forwardedProto = request.headers['x-forwarded-proto'];
  if (
    forwardedProto !== undefined &&
    (typeof forwardedProto !== 'string' || !['http', 'https'].includes(forwardedProto))
  ) {
    return 'Trusted proxy supplied malformed x-forwarded-proto';
  }
  const forwardedHost = request.headers['x-forwarded-host'];
  if (
    forwardedHost !== undefined &&
    (typeof forwardedHost !== 'string' ||
      forwardedHost.length > 255 ||
      !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(forwardedHost))
  ) {
    return 'Trusted proxy supplied malformed x-forwarded-host';
  }
  return null;
}

function sendBoundaryProblem(
  response: FastifyReply,
  requestId: string,
  status: number,
  detail: string,
): void {
  response
    .status(status)
    .type('application/problem+json')
    .send({
      detail,
      requestId,
      status,
      title: status === 400 ? 'Bad Request' : status === 403 ? 'Forbidden' : 'Too Many Requests',
      type: `https://dailydraft.fun/problems/${
        status === 400 ? 'bad-request' : status === 403 ? 'forbidden' : 'too-many-requests'
      }`,
    });
}

function canonicalOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(',').map((origin) => new URL(origin.trim()).origin))].sort();
}

function canonicalTrustedProxies(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const proxies = value.split(',').map((address) => address.trim());
  if (proxies.some((address) => isIP(address) === 0)) {
    throw new Error('DAILYDRAFT_TRUSTED_PROXIES must contain only literal IP addresses');
  }
  return [...new Set(proxies)].sort();
}

function canonicalTrustedProxyHosts(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const hosts = value.split(',').map((host) => host.trim().toLowerCase());
  if (
    hosts.some(
      (host) =>
        host.length > 253 ||
        !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
          host,
        ),
    )
  ) {
    throw new Error('DAILYDRAFT_TRUSTED_PROXY_HOSTS must contain only DNS hostnames');
  }
  return [...new Set(hosts)].sort();
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Request-boundary limit must be an integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Request-boundary limit must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function numberHeader(value: string | number | string[] | undefined, fallback: number): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requestPath(value: string): string {
  const query = value.indexOf('?');
  const fragment = value.indexOf('#');
  const boundary = query === -1 ? fragment : fragment === -1 ? query : Math.min(query, fragment);
  return boundary === -1 ? value : value.slice(0, boundary);
}
