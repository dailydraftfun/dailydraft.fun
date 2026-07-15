import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { type AuthenticatedFastifyRequest, getBearerToken } from './authentication.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { WalletAuthService } from './wallet-auth.service.js';

@Injectable()
export class WalletSessionGuard implements CanActivate {
  constructor(private readonly walletAuth: WalletAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedFastifyRequest>();
    request.duelAuthentication = await this.walletAuth.authenticate(getBearerToken(request));
    return true;
  }
}
