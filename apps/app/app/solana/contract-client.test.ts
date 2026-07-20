import { describe, expect, test } from 'bun:test';
import {
  contractFixtures,
  contractValues,
  OPENAPI_CONTRACT_VERSION,
} from '@openpacksduel/contracts';

import {
  DuelApiRequestError,
  requestAuthenticatedDuel,
  requestCreateDuel,
  requestPreparedDuelIntent,
} from './duel-client';
import { createWalletSessionAt, requestWalletChallengeAt } from './wallet-auth-client';

const baseUrl = 'https://api.example.test/v1';

describe('app contract client', () => {
  test('uses the shared wallet authentication request and response fixtures', async () => {
    const requests: Request[] = [];
    const responses = [
      contractFixtures.walletAuthentication.challengeResponse,
      contractFixtures.walletAuthentication.sessionResponse,
    ];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(responses[requests.length - 1]);
    }) as typeof fetch;

    const challenge = await requestWalletChallengeAt(
      baseUrl,
      contractValues.creatorWallet,
      fetcher,
    );
    const session = await createWalletSessionAt(
      baseUrl,
      challenge,
      Uint8Array.from([1, 2, 3, 4]),
      fetcher,
    );

    expect(challenge).toEqual(contractFixtures.walletAuthentication.challengeResponse);
    expect(session).toEqual(contractFixtures.walletAuthentication.sessionResponse);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', `${baseUrl}/auth/challenges`],
      ['POST', `${baseUrl}/auth/sessions`],
    ]);
    expect(await requests[0]?.json()).toEqual(
      contractFixtures.walletAuthentication.challengeRequest,
    );
    expect(await requests[1]?.json()).toEqual(contractFixtures.walletAuthentication.sessionRequest);
  });

  test('keeps create, status, and transaction preparation auth and idempotency aligned', async () => {
    const requests: Request[] = [];
    const responses = [
      contractFixtures.duelStatus.response,
      contractFixtures.duelStatus.response,
      contractFixtures.transactionPreparation.response,
    ];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(responses[requests.length - 1]);
    }) as typeof fetch;

    const created = await requestCreateDuel(
      baseUrl,
      contractFixtures.createDuel.request,
      contractValues.sessionToken,
      contractValues.idempotencyKey,
      fetcher,
    );
    const current = await requestAuthenticatedDuel(
      baseUrl,
      contractValues.duelId,
      contractValues.sessionToken,
      fetcher,
    );
    const prepared = await requestPreparedDuelIntent(
      baseUrl,
      contractValues.duelId,
      contractValues.creatorWallet,
      contractValues.sessionToken,
      contractValues.idempotencyKey,
      fetcher,
    );

    expect(created.version).toBe(contractFixtures.duelStatus.response.version);
    expect(current).toEqual(contractFixtures.duelStatus.response);
    expect(prepared).toEqual(contractFixtures.transactionPreparation.response);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', `${baseUrl}/duels`],
      ['GET', `${baseUrl}/duels/${contractValues.duelId}`],
      ['POST', `${baseUrl}/duels/${contractValues.duelId}/transactions`],
    ]);
    expect(
      requests.every(
        (request) =>
          request.headers.get('authorization') === `Bearer ${contractValues.sessionToken}`,
      ),
    ).toBe(true);
    expect(requests[0]?.headers.get('idempotency-key')).toBe(contractValues.idempotencyKey);
    expect(requests[1]?.headers.get('idempotency-key')).toBeNull();
    expect(requests[2]?.headers.get('idempotency-key')).toBe(contractValues.idempotencyKey);
    expect(await requests[0]?.json()).toEqual(contractFixtures.createDuel.request);
    expect(await requests[2]?.json()).toEqual(contractFixtures.transactionPreparation.request);
  });

  test('preserves shared problem detail and API version semantics', async () => {
    const fetcher = (async () =>
      Response.json(contractFixtures.problem.response, {
        status: contractFixtures.problem.response.status,
      })) as unknown as typeof fetch;

    const error = await requestAuthenticatedDuel(
      baseUrl,
      contractValues.duelId,
      contractValues.sessionToken,
      fetcher,
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(DuelApiRequestError);
    expect(error).toMatchObject({
      message: contractFixtures.problem.response.detail,
      retryable: false,
      status: contractFixtures.problem.response.status,
    });
    expect(contractFixtures.health.response.version).toBe(OPENAPI_CONTRACT_VERSION);
    expect(contractFixtures.publicProof.response.schemaVersion).toBe('openpacksduel.receipt.v1');
  });
});
