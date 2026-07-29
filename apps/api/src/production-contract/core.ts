import {
  PRODUCTION_REQUIRED_ENVIRONMENT_KEYS,
  validateDeploymentEnvironment,
} from '../config/deployment-environment.js';

export const PRODUCTION_ARTIFACT_SCHEMA_VERSION = 2;
const PRODUCTION_ENTRYPOINTS = ['src/main.js'] as const;

export interface ProductionArtifactManifest {
  artifact: {
    entrypoints: readonly ['src/main.js'];
    healthRoute: '/v1/health';
    openapi: 'openapi.yaml';
    runtime: 'bun@1.3.13';
  };
  deployment: {
    preview: { persistence: 'ephemeral-preview' };
    production: { persistence: 'durable-postgresql' };
  };
  environmentContract: 'deployment-environment.v1';
  openapiSha256: string;
  schemaVersion: 2;
}

export interface ConformanceCheck {
  detail: string;
  name: string;
  passed: boolean;
}

export interface StaticArtifactInput {
  files: ReadonlySet<string>;
  manifest: ProductionArtifactManifest;
  openapiText: string;
  packageManager: string | undefined;
  startScript: string | undefined;
}

export interface OpenApiDocument {
  components?: {
    schemas?: {
      Health?: {
        required?: string[];
      };
    };
  };
  paths?: Record<
    string,
    {
      get?: {
        responses?: Record<string, unknown>;
      };
    }
  >;
  servers?: Array<{ description?: string; url?: string }>;
}

export function createProductionArtifactManifest(openapiText: string): ProductionArtifactManifest {
  return {
    artifact: {
      entrypoints: PRODUCTION_ENTRYPOINTS,
      healthRoute: '/v1/health',
      openapi: 'openapi.yaml',
      runtime: 'bun@1.3.13',
    },
    deployment: {
      preview: { persistence: 'ephemeral-preview' },
      production: { persistence: 'durable-postgresql' },
    },
    environmentContract: 'deployment-environment.v1',
    openapiSha256: sha256(openapiText),
    schemaVersion: PRODUCTION_ARTIFACT_SCHEMA_VERSION,
  };
}

export function evaluateStaticArtifact(input: StaticArtifactInput): ConformanceCheck[] {
  const checks: ConformanceCheck[] = [];
  addCheck(
    checks,
    'manifest-schema',
    input.manifest.schemaVersion === PRODUCTION_ARTIFACT_SCHEMA_VERSION &&
      input.manifest.environmentContract === 'deployment-environment.v1' &&
      input.manifest.artifact.healthRoute === '/v1/health' &&
      input.manifest.artifact.openapi === 'openapi.yaml' &&
      input.manifest.artifact.entrypoints.length === PRODUCTION_ENTRYPOINTS.length &&
      input.manifest.artifact.entrypoints.every(
        (entrypoint, index) => entrypoint === PRODUCTION_ENTRYPOINTS[index],
      ),
    `schemaVersion=${input.manifest.schemaVersion}`,
  );
  addCheck(
    checks,
    'runtime',
    input.packageManager === input.manifest.artifact.runtime &&
      input.manifest.artifact.runtime === 'bun@1.3.13',
    `packageManager=${input.packageManager ?? 'missing'}`,
  );
  addCheck(
    checks,
    'start-entrypoint',
    input.startScript === 'NODE_ENV=production bun run dist/src/main.js',
    `start=${input.startScript ?? 'missing'}`,
  );
  for (const entrypoint of PRODUCTION_ENTRYPOINTS) {
    addCheck(
      checks,
      `entrypoint-${entrypoint}`,
      input.files.has(entrypoint),
      `${entrypoint} ${input.files.has(entrypoint) ? 'present' : 'missing'}`,
    );
  }
  addCheck(
    checks,
    'openapi-artifact',
    input.files.has('openapi.yaml') && sha256(input.openapiText) === input.manifest.openapiSha256,
    'bundled OpenAPI file matches its SHA-256 manifest binding',
  );

  let openapi: OpenApiDocument | undefined;
  try {
    openapi = Bun.YAML.parse(input.openapiText) as OpenApiDocument;
    addCheck(checks, 'openapi-parse', true, 'bundled OpenAPI is valid YAML');
  } catch {
    addCheck(checks, 'openapi-parse', false, 'bundled OpenAPI is not valid YAML');
  }

  const health = openapi?.paths?.['/health']?.get;
  addCheck(
    checks,
    'health-contract',
    Boolean(health?.responses?.['200'] && health.responses['503']),
    '/health declares successful and unavailable responses',
  );
  addCheck(
    checks,
    'health-metadata',
    ['dependencies', 'service', 'status', 'version'].every((field) =>
      openapi?.components?.schemas?.Health?.required?.includes(field),
    ),
    'health schema requires service, status, version, and dependency metadata',
  );
  const servers = openapi?.servers ?? [];
  addCheck(
    checks,
    'server-state',
    servers.length > 0 &&
      servers.every((server) => server.url?.endsWith('/v1')) &&
      // The live production host is api.dailydraft.fun — the TLD is .fun, not .com.
      // This guard only works if it names the host we actually serve.
      !servers.some((server) => /(^|\.)api\.dailydraft\.fun$/i.test(safeHostname(server.url))),
    'servers retain the /v1 base and do not advertise a live production API host',
  );
  addCheck(
    checks,
    'persistence-contract',
    input.manifest.deployment.preview.persistence === 'ephemeral-preview' &&
      input.manifest.deployment.production.persistence === 'durable-postgresql',
    'preview and production persistence requirements are explicit and distinct',
  );
  return checks;
}

export function evaluateEnvironmentNegativeFixtures(): ConformanceCheck {
  const fixture = productionEnvironmentFixture();
  const failures: string[] = [];

  try {
    validateDeploymentEnvironment(fixture);
  } catch {
    failures.push('valid production fixture was rejected');
  }

  for (const key of PRODUCTION_REQUIRED_ENVIRONMENT_KEYS) {
    const missing = { ...fixture };
    delete missing[key];
    try {
      validateDeploymentEnvironment(missing);
      failures.push(`${key} missing fixture was accepted`);
    } catch {
      // The negative fixture passed by failing closed.
    }
  }

  return {
    detail:
      failures.length === 0
        ? `${PRODUCTION_REQUIRED_ENVIRONMENT_KEYS.length} required-key negative fixtures rejected`
        : failures.join('; '),
    name: 'environment-negative-fixtures',
    passed: failures.length === 0,
  };
}

export function productionEnvironmentFixture(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CORS_ORIGINS: 'https://dailydraft.example',
    CRON_SECRET: 'contract-cron-secret-at-least-32-characters',
    DATABASE_URL: 'postgresql://dailydraft:contract@localhost:5432/dailydraft_contract',
    NODE_ENV: 'production',
    DAILYDRAFT_API_KEYS: 'contract-api-key-at-least-32-characters',
    DAILYDRAFT_APP_URL: 'https://dailydraft.example',
    DAILYDRAFT_AUTH_DOMAIN: 'dailydraft.example',
    DAILYDRAFT_NETWORK: 'solana-devnet',
    DAILYDRAFT_PROVIDER_MODE: 'dailydraft-devnet',
    DAILYDRAFT_TRUSTED_PROXY_HOSTS: 'shipshit-caddy',
    PORT: '33159',
    ...overrides,
  };
}

export function safeJsonReportPath(value: string): string {
  if (!value.startsWith('artifacts/') || value.includes('..') || !value.endsWith('.json')) {
    throw new Error('report path must be a JSON file under artifacts/');
  }
  return value;
}

function addCheck(checks: ConformanceCheck[], name: string, passed: boolean, detail: string): void {
  checks.push({ detail, name, passed });
}

function safeHostname(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
