import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseReadinessManifest, validateReadinessManifest } from './core';

const repositoryRoot = resolve(import.meta.dir, '../..');
const manifest = parseReadinessManifest(
  JSON.parse(
    readFileSync(resolve(repositoryRoot, '.github/branch-protection-readiness.json'), 'utf8'),
  ),
);
const workflows = new Map(
  [...new Set(manifest.gates.map(({ workflow }) => workflow))].map((workflow) => [
    workflow,
    readFileSync(resolve(repositoryRoot, workflow), 'utf8'),
  ]),
);

describe('branch-protection readiness manifest', () => {
  test('matches every emitted required check and applicability evidence', () => {
    expect(validateReadinessManifest(manifest, workflows)).toEqual({ errors: [], passed: true });
    expect(manifest.enforcement).toMatchObject({ mode: 'advisory' });
    expect(manifest.pullRequestsMustBeUpToDate).toBe(true);
    expect(manifest.emergencyBypass).toMatchObject({ allowed: true, auditRequired: true });
  });

  test('fails when a workflow check is renamed', () => {
    const renamed = new Map(workflows);
    renamed.set(
      '.github/workflows/journey.yml',
      requiredWorkflow('.github/workflows/journey.yml').replace(
        'name: Journey smoke',
        'name: Browser journey',
      ),
    );

    const result = validateReadinessManifest(manifest, renamed);

    expect(result.passed).toBe(false);
    expect(result.errors).toContain(
      'journey: workflow name drifted from Journey smoke to Browser journey',
    );
  });

  test('fails when a required job or evidence command disappears', () => {
    const missing = new Map(workflows);
    missing.set(
      '.github/workflows/ci.yml',
      requiredWorkflow('.github/workflows/ci.yml')
        .replace('  affected:', '  changed:')
        .replace('bun run coverage:changed', 'bun run coverage:removed'),
    );

    const result = validateReadinessManifest(manifest, missing);

    expect(result.passed).toBe(false);
    expect(result.errors).toContain('affected: job affected is missing');
    expect(result.errors).toContain(
      'coverage: required evidence command is missing: bun run coverage:changed',
    );
  });
});

function requiredWorkflow(path: string): string {
  const source = workflows.get(path);
  if (!source) throw new Error(`missing workflow fixture ${path}`);
  return source;
}
