import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  type ConformanceCheck,
  evaluateEnvironmentNegativeFixtures,
  evaluateStaticArtifact,
  type ProductionArtifactManifest,
  productionEnvironmentFixture,
  safeJsonReportPath,
} from '../apps/api/src/production-contract/core.js';

const repositoryRoot = resolve(import.meta.dir, '..');
const artifactArgument = argumentValue('--artifact');
if (artifactArgument !== 'apps/api/dist') {
  throw new Error('--artifact must be apps/api/dist');
}
const reportArgument = safeJsonReportPath(argumentValue('--report'));
const artifactRoot = resolve(repositoryRoot, artifactArgument);
const reportPath = resolve(repositoryRoot, reportArgument);
const checks: ConformanceCheck[] = [evaluateEnvironmentNegativeFixtures()];
let manifest: ProductionArtifactManifest | undefined;

checks.push(await runRouteCompatibilityGate());

try {
  const [manifestText, openapiText, packageText, files] = await Promise.all([
    readFile(resolve(artifactRoot, 'production-manifest.json'), 'utf8'),
    readFile(resolve(artifactRoot, 'openapi.yaml'), 'utf8'),
    readFile(resolve(repositoryRoot, 'apps/api/package.json'), 'utf8'),
    listArtifactFiles(artifactRoot),
  ]);
  manifest = JSON.parse(manifestText) as ProductionArtifactManifest;
  const packageJson = JSON.parse(packageText) as {
    packageManager?: string;
    scripts?: { start?: string };
  };
  checks.push(
    ...evaluateStaticArtifact({
      files: new Set(files),
      manifest,
      openapiText,
      packageManager: packageJson.packageManager,
      startScript: packageJson.scripts?.start,
    }),
  );
} catch (error) {
  checks.push({
    detail: boundedError(error),
    name: 'artifact-inspection',
    passed: false,
  });
}

if (manifest && checks.every((check) => check.passed)) {
  checks.push(await probeBuiltHealthEndpoint(artifactRoot));
} else {
  checks.push({
    detail: 'startup probe skipped because static artifact checks failed',
    name: 'built-health-probe',
    passed: false,
  });
}

const report = {
  artifact: manifest?.artifact ?? null,
  checks,
  deployment: manifest?.deployment ?? null,
  environmentContract: manifest?.environmentContract ?? null,
  passed: checks.every((check) => check.passed),
  schemaVersion: 2,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

async function probeBuiltHealthEndpoint(artifactDirectory: string): Promise<ConformanceCheck> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return {
      detail: 'DATABASE_URL is required for the workflow-local health probe',
      name: 'built-health-probe',
      passed: false,
    };
  }

  const environment = productionEnvironmentFixture({
    DATABASE_URL: databaseUrl,
    PORT: '33159',
  });
  const child = Bun.spawn(['bun', resolve(artifactDirectory, 'src/main.js')], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stderr: 'pipe',
    stdout: 'pipe',
  });

  try {
    const response = await waitForHealth('http://127.0.0.1:33159/v1/health');
    const body = (await response.json()) as {
      dependencies?: { database?: string };
      service?: string;
      status?: string;
      version?: string;
    };
    const passed =
      response.status === 200 &&
      Boolean(response.headers.get('x-request-id')) &&
      body.dependencies?.database === 'ok' &&
      body.service === 'dailydraft-api' &&
      body.status === 'ok' &&
      typeof body.version === 'string' &&
      body.version.length > 0;
    return {
      detail: passed
        ? 'compiled Bun entrypoint served /v1/health with request and dependency metadata'
        : 'compiled health response did not match the documented metadata contract',
      name: 'built-health-probe',
      passed,
    };
  } catch (error) {
    return { detail: boundedError(error), name: 'built-health-probe', passed: false };
  } finally {
    child.kill();
    await child.exited;
  }
}

async function listArtifactFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listArtifactFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function runRouteCompatibilityGate(): Promise<ConformanceCheck> {
  const child = Bun.spawn(['bun', '--filter', '@dailydraft/api', 'test:contract'], {
    cwd: repositoryRoot,
    env: process.env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return {
    detail:
      exitCode === 0
        ? 'running Nest route inventory matches the canonical OpenAPI contract'
        : `route/OpenAPI compatibility exited with status ${exitCode}`,
    name: 'route-openapi-compatibility',
    passed: exitCode === 0,
  };
}

async function waitForHealth(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return response;
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(250);
  }
  throw new Error(`compiled API did not become healthy: ${boundedError(lastError)}`);
}

function argumentValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`${flag} is required`);
  return value;
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
