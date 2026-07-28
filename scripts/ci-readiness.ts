import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseReadinessManifest, validateReadinessManifest } from './ci-readiness/core';

const repositoryRoot = resolve(import.meta.dir, '..');
const manifestPath = resolve(repositoryRoot, '.github/branch-protection-readiness.json');
const manifest = parseReadinessManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
const workflowPaths = [...new Set(manifest.gates.map(({ workflow }) => workflow))];
const workflows = new Map(
  await Promise.all(
    workflowPaths.map(async (path) => [
      path,
      await readFile(resolve(repositoryRoot, path), 'utf8'),
    ]),
  ),
);
const result = validateReadinessManifest(manifest, workflows);

console.log(
  JSON.stringify(
    {
      enforcement: manifest.enforcement.mode,
      gates: manifest.gates.map(({ applicability, checkName, id }) => ({
        applicability,
        checkName,
        id,
      })),
      ...result,
      schemaVersion: manifest.schemaVersion,
    },
    null,
    2,
  ),
);
if (!result.passed) process.exitCode = 1;
