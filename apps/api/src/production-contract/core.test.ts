import { describe, expect, test } from 'bun:test';

import {
  createProductionArtifactManifest,
  evaluateEnvironmentNegativeFixtures,
  evaluateStaticArtifact,
  safeJsonReportPath,
} from './core.js';

const OPENAPI = `openapi: 3.1.0
servers:
  - url: https://openpacksduel-api.vercel.app/v1
    description: Canonical hosted devnet API (not mainnet)
paths:
  /health:
    get:
      responses:
        '200': { description: Healthy }
        '503': { description: Unavailable }
components:
  schemas:
    Health:
      required: [service, status, version, dependencies]
`;

describe('API production artifact contract', () => {
  test('accepts the documented Bun entrypoints, bound OpenAPI, and persistence profiles', () => {
    const checks = evaluateStaticArtifact({
      files: new Set(['index.js', 'main.js', 'openapi.yaml', 'production-manifest.json']),
      manifest: createProductionArtifactManifest(OPENAPI),
      openapiText: OPENAPI,
      packageManager: 'bun@1.3.13',
      startScript: 'NODE_ENV=production bun run dist/main.js',
    });
    expect(
      checks.every((check) => check.passed),
      JSON.stringify(checks, null, 2),
    ).toBe(true);
  });

  test('reports missing entrypoints, drifted OpenAPI, runtime drift, and a live production server', () => {
    const productionOpenApi = OPENAPI.replace(
      'https://openpacksduel-api.vercel.app/v1',
      'https://api.openpacksduel.com/v1',
    );
    const checks = evaluateStaticArtifact({
      files: new Set(['openapi.yaml']),
      manifest: createProductionArtifactManifest(OPENAPI),
      openapiText: productionOpenApi,
      packageManager: 'node@24',
      startScript: 'bun run src/main.ts',
    });
    expect(checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'runtime',
        'start-entrypoint',
        'entrypoint-index.js',
        'entrypoint-main.js',
        'openapi-artifact',
        'server-state',
      ]),
    );
  });

  test('fails closed when health metadata or response states drift', () => {
    const incomplete = OPENAPI.replace("        '503': { description: Unavailable }\n", '').replace(
      'required: [service, status, version, dependencies]',
      'required: [status]',
    );
    const checks = evaluateStaticArtifact({
      files: new Set(['index.js', 'main.js', 'openapi.yaml']),
      manifest: createProductionArtifactManifest(incomplete),
      openapiText: incomplete,
      packageManager: 'bun@1.3.13',
      startScript: 'NODE_ENV=production bun run dist/main.js',
    });
    expect(checks.find((check) => check.name === 'health-contract')?.passed).toBe(false);
    expect(checks.find((check) => check.name === 'health-metadata')?.passed).toBe(false);
  });

  test('exercises one fail-closed fixture for every required production key', () => {
    expect(evaluateEnvironmentNegativeFixtures()).toEqual({
      detail: '8 required-key negative fixtures rejected',
      name: 'environment-negative-fixtures',
      passed: true,
    });
  });

  test('rejects manifest-declared entrypoint, health, OpenAPI, and environment drift', () => {
    const manifest = createProductionArtifactManifest(OPENAPI);
    const drifted = {
      ...manifest,
      artifact: {
        ...manifest.artifact,
        entrypoints: ['main.js'],
        healthRoute: '/health',
        openapi: 'other.yaml',
      },
      environmentContract: 'other.v1',
    } as unknown as typeof manifest;
    const checks = evaluateStaticArtifact({
      files: new Set(['index.js', 'main.js', 'openapi.yaml']),
      manifest: drifted,
      openapiText: OPENAPI,
      packageManager: 'bun@1.3.13',
      startScript: 'NODE_ENV=production bun run dist/main.js',
    });
    expect(checks.find((check) => check.name === 'manifest-schema')?.passed).toBe(false);
  });

  test('bounds machine-readable output to the artifact directory', () => {
    expect(safeJsonReportPath('artifacts/api-production-conformance.json')).toBe(
      'artifacts/api-production-conformance.json',
    );
    expect(() => safeJsonReportPath('../report.json')).toThrow('under artifacts');
    expect(() => safeJsonReportPath('artifacts/report.txt')).toThrow('under artifacts');
  });
});
