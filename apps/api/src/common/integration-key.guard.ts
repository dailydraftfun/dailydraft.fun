import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class IntegrationKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const keys = getIntegrationKeys();

    if (keys.length === 0) {
      throw new ServiceUnavailableException('Integration API keys are not configured');
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const key = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

    if (!key || !matchesIntegrationKey(key, keys)) {
      throw new UnauthorizedException('Missing or invalid integration key');
    }

    return true;
  }
}

export function getIntegrationKeys(): string[] {
  return (process.env.OPENPACKSDUEL_API_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export function matchesIntegrationKey(candidate: string, keys = getIntegrationKeys()): boolean {
  return keys.some((expected) => matchesKey(candidate, expected));
}

function matchesKey(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
