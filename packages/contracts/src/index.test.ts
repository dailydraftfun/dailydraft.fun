import { describe, expect, test } from 'bun:test';

import {
  CONTRACT_FIXTURE_VERSION,
  compareRouteInventories,
  contractFixtureFingerprint,
  contractOperations,
  operationKey,
} from './index.js';

describe('versioned contract fixture inventory', () => {
  test('has a unique route and operation id for every fixture', () => {
    const routes = contractOperations.map((operation) =>
      operationKey(operation.method, operation.path),
    );
    const operationIds = contractOperations.map((operation) => operation.operationId);

    expect(CONTRACT_FIXTURE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+\+[a-f0-9]{12}$/);
    expect(CONTRACT_FIXTURE_VERSION.split('+')[1]).toBe(contractFixtureFingerprint());
    expect(new Set(routes).size).toBe(routes.length);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  test('reports implementation-only drift', () => {
    expect(
      compareRouteInventories(
        new Set(['GET /health', 'POST /implementation-only']),
        new Set(['GET /health']),
      ),
    ).toEqual(['Implementation-only route: POST /implementation-only']);
  });

  test('reports specification-only drift', () => {
    expect(
      compareRouteInventories(
        new Set(['GET /health']),
        new Set(['GET /health', 'POST /specification-only']),
      ),
    ).toEqual(['Specification-only route: POST /specification-only']);
  });
});
