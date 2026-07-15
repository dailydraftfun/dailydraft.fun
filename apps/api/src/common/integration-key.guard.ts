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
    const keys = (process.env.OPENPACKSDUEL_API_KEYS ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);

    if (keys.length === 0) {
      throw new ServiceUnavailableException('Integration API keys are not configured');
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const key = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

    if (!key || !keys.some((expected) => matchesKey(key, expected))) {
      throw new UnauthorizedException('Missing or invalid integration key');
    }

    return true;
  }
}

function matchesKey(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
