import { describe, expect, test } from 'bun:test';
import {
  contractFixtures,
  contractValues,
  OPENAPI_CONTRACT_VERSION,
} from '@openpacksduel/contracts';

import { OpenPacksApiClient, OpenPacksApiError } from './api-client.js';

const baseUrl = 'https://api.example.test/v1';

describe('MCP contract client', () => {
  test('validates shared duel status with integration authentication and version semantics', async () => {
    let request: Request | undefined;
    const client = new OpenPacksApiClient({
      apiKey: contractValues.sessionToken,
      baseUrl,
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json(contractFixtures.duelStatus.response);
      },
    });

    const duel = await client.getDuel(contractValues.duelId);

    expect(duel).toEqual(contractFixtures.duelStatus.response);
    expect(duel.version).toBe(contractFixtures.duelStatus.response.version);
    expect(request?.method).toBe('GET');
    expect(request?.url).toBe(`${baseUrl}/duels/${contractValues.duelId}`);
    expect(request?.headers.get('authorization')).toBe(`Bearer ${contractValues.sessionToken}`);
    expect(contractFixtures.health.response.version).toBe(OPENAPI_CONTRACT_VERSION);
  });

  test('validates shared transaction preparation request, response, and idempotency', async () => {
    let request: Request | undefined;
    const client = new OpenPacksApiClient({
      apiKey: contractValues.sessionToken,
      baseUrl,
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json(contractFixtures.transactionPreparation.response);
      },
    });

    const prepared = await client.prepareTransaction({
      ...contractFixtures.transactionPreparation.request,
      duelId: contractValues.duelId,
      idempotencyKey: contractValues.idempotencyKey,
    });

    expect(prepared).toEqual({
      ...contractFixtures.transactionPreparation.response,
      warnings: [...contractFixtures.transactionPreparation.response.warnings],
    });
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('idempotency-key')).toBe(contractValues.idempotencyKey);
    expect(await request?.json()).toEqual(contractFixtures.transactionPreparation.request);
  });

  test('preserves shared problem response status, detail, and request correlation', async () => {
    const client = new OpenPacksApiClient({
      apiKey: contractValues.sessionToken,
      baseUrl,
      fetch: async () =>
        Response.json(contractFixtures.problem.response, {
          status: contractFixtures.problem.response.status,
        }),
    });

    const error = await client.getDuel(contractValues.duelId).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(OpenPacksApiError);
    expect(error).toMatchObject({
      message: contractFixtures.problem.response.detail,
      requestId: contractFixtures.problem.response.requestId,
      status: contractFixtures.problem.response.status,
    });
  });
});
