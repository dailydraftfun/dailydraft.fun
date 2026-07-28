import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_CLIENTS = 10_000;

export interface RequestBoundaryConfig {
  allowedOrigins: readonly string[];
  rateLimit: number;
  rateWindowMs: number;
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
  log?: (entry: RequestBoundaryLog) => void;
  now?: () => number;
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
  return {
    allowedOrigins,
    rateLimit: boundedInteger(environment.DAILYDRAFT_RATE_LIMIT, DEFAULT_RATE_LIMIT, 1, 10_000),
    rateWindowMs: boundedInteger(
      environment.DAILYDRAFT_RATE_WINDOW_MS,
      DEFAULT_RATE_WINDOW_MS,
      1_000,
      3_600_000,
    ),
    trustedProxies,
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
  const startedAt = new WeakMap<FastifyRequest, number>();
  const rateLimits = new Map<string, RateLimitState>();

  instance.addHook('onRequest', (request, response, done) => {
    const observedAt = now();
    startedAt.set(request, observedAt);
    response.header('x-request-id', request.id);

    const forwardedIssue = forwardedHeaderIssue(request, config.trustedProxies);
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
      route: request.routeOptions.url ?? request.url,
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
  trustedProxies: readonly string[],
): string | null {
  const remoteAddress = request.raw.socket.remoteAddress ?? '';
  if (!trustedProxies.includes(remoteAddress)) return null;

  const forwardedFor = request.headers['x-forwarded-for'];
  if (
    forwardedFor !== undefined &&
    (typeof forwardedFor !== 'string' ||
      forwardedFor
        .split(',')
        .map((address) => address.trim())
        .some((address) => isIP(address) === 0))
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
