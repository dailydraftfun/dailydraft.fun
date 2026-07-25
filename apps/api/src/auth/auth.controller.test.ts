import { describe, expect, test } from 'bun:test';
import { type ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

import { ProblemDetailsFilter } from '../common/problem-details.filter.js';
import { AuthController } from './auth.controller.js';
import type { WalletAuthService } from './wallet-auth.service.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';

describe('AuthController', () => {
  test('returns a stable 429 problem response when challenge issuance is limited', async () => {
    const service = {
      issueChallenge: async () => {
        throw new HttpException(
          'Wallet challenge issuance rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      },
    } as unknown as WalletAuthService;
    const controller = new AuthController(service);
    const reply = new FakeReply();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'req_auth_rate_limit',
          method: 'POST',
          params: {},
          routeOptions: { url: '/v1/auth/challenges' },
        }),
        getResponse: () => reply,
      }),
    } as unknown as ArgumentsHost;

    let exception: unknown;
    try {
      await controller.createChallenge({ wallet: WALLET });
    } catch (error) {
      exception = error;
    }
    new ProblemDetailsFilter().catch(exception, host);

    expect(reply.statusCode).toBe(429);
    expect(reply.contentType).toBe('application/problem+json');
    expect(reply.body).toEqual({
      detail: 'Wallet challenge issuance rate limit exceeded',
      requestId: 'req_auth_rate_limit',
      status: 429,
      title: 'Too Many Requests',
      type: 'https://dailydraft.fun/problems/too-many-requests',
    });
  });
});

class FakeReply {
  body: unknown;
  contentType = '';
  statusCode = 0;

  send(body: unknown): this {
    this.body = body;
    return this;
  }

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  type(contentType: string): this {
    this.contentType = contentType;
    return this;
  }
}
