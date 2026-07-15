import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { getIntegrationKeys, matchesIntegrationKey } from '../common/integration-key.guard.js';
import { type AuthenticatedFastifyRequest, getBearerToken } from './authentication.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { WalletAuthService } from './wallet-auth.service.js';

@Injectable()
export class DuelMutationGuard implements CanActivate {
  constructor(private readonly walletAuth: WalletAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedFastifyRequest>();
    const token = getBearerToken(request);
    const integrationKeys = getIntegrationKeys();
    if (token && matchesIntegrationKey(token, integrationKeys)) {
      request.duelAuthentication = { kind: 'integration' };
      return true;
    }

    request.duelAuthentication = await this.walletAuth.authenticate(token);
    return true;
  }
}
