import { describe, expect, test } from 'bun:test';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { DuelAuthentication } from '../auth/authentication.js';
import { CrashController } from './crash.controller.js';
import {
  CRASH_PLAYER_DECISION_SCHEMA_VERSION,
  type CrashCurrentStage,
  type CrashDecisionService,
} from './crash-decision.service.js';
import { CrashStateMachineError } from './crash-stage-state.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const ROUND_ID = 'crashround_controllertest01';

describe('CrashController', () => {
  test('returns the same canonical current-stage response for duplicate decisions', async () => {
    const calls: unknown[] = [];
    const service = {
      decide: async (input: unknown) => {
        calls.push(input);
        return CURRENT;
      },
    } as unknown as CrashDecisionService;
    const controller = new CrashController(service);
    const body = { action: 'continue' as const, expectedStage: 1, expectedVersion: 1 };
    const response = reply();

    const first = await controller.decide(
      { roundId: ROUND_ID },
      body,
      session(),
      'controller-idempotency-0001',
      response,
    );
    const retry = await controller.decide(
      { roundId: ROUND_ID },
      body,
      session(),
      'controller-idempotency-0001',
      response,
    );

    expect(retry).toEqual(first);
    expect(calls).toEqual([
      {
        ...body,
        idempotencyKey: 'controller-idempotency-0001',
        playerWallet: WALLET,
        roundId: ROUND_ID,
      },
      {
        ...body,
        idempotencyKey: 'controller-idempotency-0001',
        playerWallet: WALLET,
        roundId: ROUND_ID,
      },
    ]);
  });

  test.each([
    ['minimum-length punctuation key', `/${'a'.repeat(15)}`],
    ['punctuated key', 'continue/request?!@#$%^&*()-=+'],
    ['maximum-length punctuation key', `/${'z'.repeat(127)}`],
  ])('forwards the documented %s unchanged', async (_name, idempotencyKey) => {
    const calls: unknown[] = [];
    const service = {
      decide: async (input: unknown) => {
        calls.push(input);
        return CURRENT;
      },
    } as unknown as CrashDecisionService;

    await new CrashController(service).decide(
      { roundId: ROUND_ID },
      { action: 'continue', expectedStage: 1, expectedVersion: 1 },
      session(),
      idempotencyKey,
      reply(),
    );

    expect(idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(idempotencyKey.length).toBeLessThanOrEqual(128);
    expect(calls).toEqual([
      expect.objectContaining({
        idempotencyKey,
        playerWallet: WALLET,
        roundId: ROUND_ID,
      }),
    ]);
  });

  test('binds reconnect to the authenticated wallet and canonical round id', async () => {
    const calls: string[][] = [];
    const service = {
      currentStage: async (roundId: string, wallet: string) => {
        calls.push([roundId, wallet]);
        return CURRENT;
      },
    } as unknown as CrashDecisionService;

    await expect(
      new CrashController(service).currentStage({ roundId: ROUND_ID }, session(), reply()),
    ).resolves.toEqual(CURRENT);
    expect(calls).toEqual([[ROUND_ID, WALLET]]);
  });

  test('refuses non-wallet callers without revealing whether the round exists', async () => {
    const service = {
      currentStage: async () => CURRENT,
    } as unknown as CrashDecisionService;
    const controller = new CrashController(service);

    await expect(
      controller.currentStage({ roundId: ROUND_ID }, { kind: 'integration' }, reply()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test.each([
    ['NOT_FOUND', NotFoundException],
    ['DISABLED', ServiceUnavailableException],
    ['INVALID_EVIDENCE', ServiceUnavailableException],
    ['CONCURRENT_TRANSITION', ConflictException],
    ['DEADLINE_EXPIRED', ConflictException],
    ['IDEMPOTENCY_MISMATCH', ConflictException],
    ['INVALID_TRANSITION', ConflictException],
  ] as const)('maps %s to a stable HTTP contract', async (code, expected) => {
    const service = {
      currentStage: async () => {
        throw new CrashStateMachineError(code, `fixture ${code}`);
      },
    } as unknown as CrashDecisionService;

    await expect(
      new CrashController(service).currentStage({ roundId: ROUND_ID }, session(), reply()),
    ).rejects.toBeInstanceOf(expected);
  });

  test('does not mask unexpected controller-service failures', async () => {
    const service = {
      currentStage: async () => {
        throw new Error('unexpected database failure');
      },
    } as unknown as CrashDecisionService;

    await expect(
      new CrashController(service).currentStage({ roundId: ROUND_ID }, session(), reply()),
    ).rejects.toThrow('unexpected database failure');
  });
});

const CURRENT: CrashCurrentStage = {
  availableActions: ['continue', 'cash-out'],
  decisionDeadline: '2026-07-28T17:00:30.000Z',
  defaultAction: 'forfeit',
  mode: 'fixture-preview',
  network: 'solana-devnet',
  pot: { amount: '1000000', currency: 'USDC', decimals: 6 },
  roundId: ROUND_ID,
  schemaVersion: CRASH_PLAYER_DECISION_SCHEMA_VERSION,
  stage: 2,
  status: 'active',
  terminalReason: null,
  version: 2,
};

function session(): DuelAuthentication {
  return { kind: 'wallet-session', sessionId: 'auths_crash', wallet: WALLET };
}

function reply(): FastifyReply {
  return {
    header: () => reply(),
  } as unknown as FastifyReply;
}
