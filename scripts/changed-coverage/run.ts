import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import {
  type ChangedLineMap,
  isExecutableSource,
  parseChangedLines,
  type Workspace,
  workspaceForPath,
} from './changed-lines';
import {
  type CoverageEvaluation,
  evaluateChangedCoverage,
  type IstanbulCoverage,
} from './evaluate';

const THRESHOLD = 0.8;
const MAX_LOG_BYTES = 1_048_576;
const repositoryRoot = resolve(import.meta.dir, '../..');
const artifactRoot = resolve(repositoryRoot, '.artifacts/coverage');
const preloadPath = resolve(import.meta.dir, 'preload.ts');

interface WorkspaceResult {
  evaluation: CoverageEvaluation | null;
  name: string;
  passed: boolean;
  reason: string | null;
  testExitCode: number | null;
}

const base = requiredEnvironment('TURBO_SCM_BASE');
const head = requiredEnvironment('TURBO_SCM_HEAD');

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });

const diff = git([
  'diff',
  '--unified=0',
  '--find-renames',
  '--diff-filter=ACMR',
  '--no-color',
  '--no-ext-diff',
  `${base}...${head}`,
  '--',
]);
const workspaces = await loadWorkspaces();
const executableChanges = [...parseChangedLines(diff)].filter(([path]) => isExecutableSource(path));
const changesByWorkspace = groupByWorkspace(executableChanges, workspaces);
const results: WorkspaceResult[] = [];

for (const [workspace, changedLines] of changesByWorkspace) {
  results.push(await runWorkspaceCoverage(workspace, changedLines));
}

const summary = {
  base,
  changedExecutableFiles: executableChanges.map(([path]) => path).sort(),
  generatedAt: new Date().toISOString(),
  head,
  passed: results.every(({ passed }) => passed),
  results,
  threshold: THRESHOLD,
};
await writeFile(resolve(artifactRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(resolve(artifactRoot, 'summary.md'), markdownSummary(summary));

console.log(markdownSummary(summary));
if (!summary.passed) process.exitCode = 1;

async function runWorkspaceCoverage(
  workspace: Workspace,
  changedLines: ChangedLineMap,
): Promise<WorkspaceResult> {
  if (!workspace.testScript) {
    return {
      evaluation: null,
      name: workspace.name,
      passed: false,
      reason: 'Changed executable code belongs to a workspace without a test script.',
      testExitCode: null,
    };
  }

  const workspaceArtifact = resolve(artifactRoot, safeName(workspace.name));
  const targetsPath = resolve(workspaceArtifact, 'targets.json');
  const coveragePath = resolve(workspaceArtifact, 'coverage.json');
  await mkdir(workspaceArtifact, { recursive: true });
  await writeFile(
    targetsPath,
    `${JSON.stringify(
      [...changedLines.keys()].map((path) => resolve(repositoryRoot, path)),
      null,
      2,
    )}\n`,
  );

  const subprocess = Bun.spawn(['bun', 'test', '--preload', preloadPath, '--pass-with-no-tests'], {
    cwd: workspace.directory,
    env: {
      ...process.env,
      OPENPACKSDUEL_COVERAGE_OUTPUT: coveragePath,
      OPENPACKSDUEL_COVERAGE_TARGETS: targetsPath,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, testExitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  await writeFile(
    resolve(workspaceArtifact, 'tests.log'),
    boundedLog(`$ bun test --preload ${preloadPath} --pass-with-no-tests\n${stdout}${stderr}`),
  );

  const coverage = await readCoverage(coveragePath);
  const evaluation = evaluateChangedCoverage({
    changedLines,
    coverage,
    repositoryRoot,
    threshold: THRESHOLD,
  });
  return {
    evaluation,
    name: workspace.name,
    passed: testExitCode === 0 && evaluation.passed,
    reason: testExitCode === 0 ? null : `Instrumented tests exited with status ${testExitCode}.`,
    testExitCode,
  };
}

function groupByWorkspace(
  executableChanges: Array<[string, Set<number>]>,
  workspaces: Workspace[],
): Map<Workspace, ChangedLineMap> {
  const grouped = new Map<Workspace, ChangedLineMap>();
  for (const [path, lines] of executableChanges) {
    const workspace = workspaceForPath(repositoryRoot, path, workspaces);
    if (!workspace) continue;
    const changedLines = grouped.get(workspace) ?? new Map<string, Set<number>>();
    changedLines.set(path, lines);
    grouped.set(workspace, changedLines);
  }
  return grouped;
}

async function loadWorkspaces(): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  for (const parent of ['apps', 'packages']) {
    const parentPath = resolve(repositoryRoot, parent);
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(parentPath, entry.name);
      const packageJson = JSON.parse(
        await readFile(resolve(directory, 'package.json'), 'utf8'),
      ) as {
        name?: string;
        scripts?: { test?: string };
      };
      workspaces.push({
        directory,
        name: packageJson.name ?? `${parent}/${entry.name}`,
        testScript: packageJson.scripts?.test ?? null,
      });
    }
  }
  return workspaces;
}

async function readCoverage(path: string): Promise<IstanbulCoverage> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as IstanbulCoverage;
  } catch {
    return {};
  }
}

function git(arguments_: string[]): string {
  const subprocess = Bun.spawnSync(['git', ...arguments_], {
    cwd: repositoryRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (subprocess.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(subprocess.stderr).trim());
  }
  return new TextDecoder().decode(subprocess.stdout);
}

function boundedLog(log: string): Uint8Array {
  const bytes = new TextEncoder().encode(log);
  return bytes.byteLength <= MAX_LOG_BYTES ? bytes : bytes.slice(bytes.byteLength - MAX_LOG_BYTES);
}

function safeName(name: string): string {
  return basename(name.replace('@openpacksduel/', '')).replaceAll(/[^a-zA-Z0-9_-]/g, '-');
}

function markdownSummary(summary: {
  base: string;
  changedExecutableFiles: string[];
  head: string;
  passed: boolean;
  results: WorkspaceResult[];
  threshold: number;
}): string {
  const rows = summary.results.map((result) => {
    const lines = formatMetric(result.evaluation?.lines);
    const branches = formatMetric(result.evaluation?.branches);
    return `| ${result.name} | ${lines} | ${branches} | ${result.passed ? 'pass' : 'fail'} |`;
  });
  return [
    '# Changed-code coverage',
    '',
    `Base: \`${summary.base}\`  `,
    `Head: \`${summary.head}\`  `,
    `Threshold: ${formatPercentage(summary.threshold)} lines and branches`,
    '',
    '| Workspace | Lines | Branches | Result |',
    '| --- | ---: | ---: | --- |',
    ...(rows.length > 0 ? rows : ['| No executable workspace changes | — | — | pass |']),
    '',
    summary.passed ? 'Coverage gate passed.' : 'Coverage gate failed.',
    '',
  ].join('\n');
}

function formatMetric(metric: CoverageEvaluation['lines'] | undefined): string {
  if (!metric) return '—';
  return `${formatPercentage(metric.percentage)} (${metric.covered}/${metric.total})`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
