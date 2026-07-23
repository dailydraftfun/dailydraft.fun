import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DuelsController } from '../duels/duels.controller.js';
import { MatchmakingController } from '../matchmaking/matchmaking.controller.js';
import { ProviderSettlementController } from '../transactions/transaction-monitor.controller.js';
import {
  REAL_VALUE_ADMISSION_BOUNDARY,
  type RealValueAdmissionBoundary,
  RealValuePolicyGuard,
  resolveAdmissionCapability,
} from './real-value-policy.guard.js';

describe('RealValuePolicyGuard', () => {
  test('resolves each duel creation mode independently', () => {
    for (const mode of ['direct', 'house', 'open'] as const) {
      expect(
        resolveAdmissionCapability('duel.create', {
          body: { matchmakingMode: mode },
        } as never),
      ).toBe(`duel.create.${mode}`);
    }
    expect(() =>
      resolveAdmissionCapability('duel.create', {
        body: { matchmakingMode: 'unknown' },
      } as never),
    ).toThrow('matchmakingMode must identify');
  });

  test('records the resolved capability before admitting the request', async () => {
    const capabilities: string[] = [];
    const reflector = {
      getAllAndOverride: () => 'duel.create' as RealValueAdmissionBoundary,
    };
    const policy = {
      assertAllowed: (capability: string) => {
        capabilities.push(capability);
        return Promise.resolve({ allowed: true });
      },
    };
    const guard = new RealValuePolicyGuard(reflector as never, policy as never);
    const context = {
      getClass: () => class TestController {},
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ body: { matchmakingMode: 'house' } }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(capabilities).toEqual(['duel.create.house']);
  });

  test('marks every exposure-creating HTTP boundary and leaves recovery routes unmarked', () => {
    const reflector = new Reflector();
    const cases: Array<[object, string]> = [
      [DuelsController.prototype.create, 'duel.create'],
      [DuelsController.prototype.join, 'duel.join'],
      [DuelsController.prototype.prepareTransaction, 'duel.funding.prepare'],
      [DuelsController.prototype.openPacks, 'duel.pack.open'],
      [MatchmakingController.prototype.search, 'matchmaking.search'],
      [MatchmakingController.prototype.continueSearch, 'matchmaking.search'],
      [MatchmakingController.prototype.houseFallback, 'matchmaking.house-fallback'],
      [ProviderSettlementController.prototype.prepare, 'provider.escrow.prepare'],
    ];
    for (const [handler, boundary] of cases) {
      expect(reflector.get(REAL_VALUE_ADMISSION_BOUNDARY, handler)).toBe(boundary);
    }
    expect(
      reflector.get(REAL_VALUE_ADMISSION_BOUNDARY, DuelsController.prototype.cancel),
    ).toBeUndefined();
    expect(
      reflector.get(REAL_VALUE_ADMISSION_BOUNDARY, MatchmakingController.prototype.cancel),
    ).toBeUndefined();
  });
});
