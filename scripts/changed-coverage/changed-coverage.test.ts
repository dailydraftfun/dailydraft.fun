import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { isExecutableSource, parseChangedLines } from './changed-lines';
import { evaluateChangedCoverage, type IstanbulFileCoverage } from './evaluate';

const syntheticRepositoryRoot = '/repo';
const integrationRepositoryRoot = resolve(import.meta.dir, '../..');
const sourcePath = 'apps/api/src/example.ts';

describe('changed-code coverage gate', () => {
  test('extracts only added and modified destination lines from a zero-context diff', () => {
    const changed =
      parseChangedLines(`diff --git a/apps/api/src/example.ts b/apps/api/src/example.ts
--- a/apps/api/src/example.ts
+++ b/apps/api/src/example.ts
@@ -1,2 +1,3 @@
@@ -8 +9,0 @@
`);

    expect([...changed]).toEqual([[sourcePath, new Set([1, 2, 3])]]);
  });

  test('leaves browser harnesses to the dedicated journey coverage gate', () => {
    expect(isExecutableSource('apps/app/e2e/mcp-onboarding-server.ts')).toBe(false);
    expect(isExecutableSource('apps/app/app/__journey/public-duel-receipt.ts')).toBe(false);
    expect(
      isExecutableSource('apps/app/app/%5F%5Fjourney/v1/duels/[duelId]/receipt/route.ts'),
    ).toBe(false);
    expect(isExecutableSource('apps/app/app/duel/public-duel-receipt.ts')).toBe(true);
  });

  test('accepts a fixture with covered changed lines and both branch outcomes', () => {
    const result = evaluateChangedCoverage({
      changedLines: new Map([[sourcePath, new Set([2, 3])]]),
      coverage: {
        [`${syntheticRepositoryRoot}/${sourcePath}`]: coverageFixture({
          branchHits: [1, 1],
          lineHits: [1, 1],
        }),
      },
      repositoryRoot: syntheticRepositoryRoot,
      threshold: 0.8,
    });

    expect(result.passed).toBe(true);
    expect(result.lines.percentage).toBe(1);
    expect(result.branches.percentage).toBe(1);
  });

  test('rejects an under-covered fixture and a changed file absent from the report', () => {
    const underCovered = evaluateChangedCoverage({
      changedLines: new Map([[sourcePath, new Set([2, 3])]]),
      coverage: {
        [`${syntheticRepositoryRoot}/${sourcePath}`]: coverageFixture({
          branchHits: [1, 0],
          lineHits: [1, 0],
        }),
      },
      repositoryRoot: syntheticRepositoryRoot,
      threshold: 0.8,
    });
    const missing = evaluateChangedCoverage({
      changedLines: new Map([[sourcePath, new Set([2])]]),
      coverage: {},
      repositoryRoot: syntheticRepositoryRoot,
      threshold: 0.8,
    });

    expect(underCovered.passed).toBe(false);
    expect(underCovered.lines.percentage).toBe(0.5);
    expect(underCovered.branches.percentage).toBe(0.5);
    expect(missing.passed).toBe(false);
    expect(missing.missingFiles).toEqual([sourcePath]);
  });

  test('instruments a real Bun test and distinguishes covered from under-covered branches', () => {
    const covered = runInstrumentedFixture(true);
    const underCovered = runInstrumentedFixture(false);

    expect(covered.passed).toBe(true);
    expect(covered.branches.percentage).toBe(1);
    expect(underCovered.passed).toBe(false);
    expect(underCovered.branches.percentage).toBe(0.5);
  });
});

function coverageFixture(input: {
  branchHits: number[];
  lineHits: number[];
}): IstanbulFileCoverage {
  return {
    b: { 0: input.branchHits },
    branchMap: {
      0: {
        locations: [location(3), location(3)],
        loc: location(3),
      },
    },
    s: { 0: input.lineHits[0] ?? 0, 1: input.lineHits[1] ?? 0 },
    statementMap: { 0: location(2), 1: location(3) },
  };
}

function location(line: number) {
  return {
    end: { line },
    start: { line },
  };
}

function runInstrumentedFixture(complete: boolean) {
  const directory = mkdtempSync(resolve(tmpdir(), 'openpacksduel-coverage-'));
  const fixturePath = resolve(import.meta.dir, 'fixtures/branch.fixture.ts');
  const testPath = resolve(import.meta.dir, 'fixtures/branch.fixture.test.ts');
  const targetsPath = resolve(directory, 'targets.json');
  const outputPath = resolve(directory, 'coverage.json');
  writeFileSync(targetsPath, `${JSON.stringify([fixturePath])}\n`);

  try {
    const subprocess = Bun.spawnSync(
      ['bun', 'test', testPath, '--preload', resolve(import.meta.dir, 'preload.ts')],
      {
        cwd: integrationRepositoryRoot,
        env: {
          ...process.env,
          OPENPACKSDUEL_COVERAGE_FIXTURE_COMPLETE: complete ? '1' : '0',
          OPENPACKSDUEL_COVERAGE_OUTPUT: outputPath,
          OPENPACKSDUEL_COVERAGE_TARGETS: targetsPath,
        },
        stderr: 'pipe',
        stdout: 'pipe',
      },
    );
    expect(subprocess.exitCode, new TextDecoder().decode(subprocess.stderr)).toBe(0);

    return evaluateChangedCoverage({
      changedLines: new Map([
        [fixturePath.replace(`${integrationRepositoryRoot}/`, ''), new Set([2])],
      ]),
      coverage: JSON.parse(readFileSync(outputPath, 'utf8')),
      repositoryRoot: integrationRepositoryRoot,
      threshold: 0.8,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
