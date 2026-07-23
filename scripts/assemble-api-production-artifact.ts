import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createProductionArtifactManifest } from '../apps/api/src/production-contract/core.js';

const repositoryRoot = resolve(import.meta.dir, '..');
const apiRoot = resolve(repositoryRoot, 'apps/api');
const distRoot = resolve(apiRoot, 'dist');
const canonicalOpenApi = resolve(repositoryRoot, 'apps/docs/public/openapi.yaml');
const bundledOpenApi = resolve(distRoot, 'openapi.yaml');
const openapiText = await readFile(canonicalOpenApi, 'utf8');

await mkdir(distRoot, { recursive: true });
await copyFile(canonicalOpenApi, bundledOpenApi);
await writeFile(
  resolve(distRoot, 'production-manifest.json'),
  `${JSON.stringify(createProductionArtifactManifest(openapiText), null, 2)}\n`,
  'utf8',
);
