import { createParamDecorator, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { WalletAuthentication } from './wallet-auth.service.js';

export type DuelAuthentication = WalletAuthentication | { kind: 'integration' };

export type AuthenticatedFastifyRequest = FastifyRequest & {
  duelAuthentication?: DuelAuthentication;
};

export const CurrentDuelAuthentication = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DuelAuthentication => {
    const request = context.switchToHttp().getRequest<AuthenticatedFastifyRequest>();
    if (!request.duelAuthentication) throw new Error('Duel authentication guard was not applied');
    return request.duelAuthentication;
  },
);

export function getBearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

/**
 * Bind a request to the wallet that owns the session presenting it.
 *
 * Integration callers are trusted to act for any wallet, so they pass through;
 * a wallet session may only ever act for itself.
 */
export function assertWalletActor(authentication: DuelAuthentication, claimedWallet: string): void {
  if (authentication.kind === 'wallet-session' && authentication.wallet !== claimedWallet) {
    throw new ForbiddenException('Wallet session cannot act for another wallet');
  }
}
