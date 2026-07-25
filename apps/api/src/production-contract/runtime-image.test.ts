import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Bun links workspaces in isolation rather than hoisting: a package's declared
// dependencies appear in <package>/node_modules as symlinks into the shared
// <root>/node_modules/.bun store. A runner stage that copies only the root
// node_modules therefore ships the store with no links pointing into it, and the
// API dies at import time on its first dependency. These checks pin the copies
// that make the isolated layout resolvable inside the image.

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

const runnerStage = dockerfile.slice(dockerfile.indexOf('AS runner'));

const copiedSources = Array.from(
  runnerStage.matchAll(/^COPY --from=builder\s+(?:--chown=\S+\s+)?(\S+)\s+\S+$/gm),
  (match) => match[1],
);

const workspaceDirectoryFor = (packageName: string): string | undefined => {
  for (const manifestPath of new Bun.Glob('{apps,packages}/*/package.json').scanSync({
    cwd: repoRoot,
  })) {
    const manifest = JSON.parse(readFileSync(`${repoRoot}${manifestPath}`, 'utf8')) as {
      name?: string;
    };
    if (manifest.name === packageName) {
      return manifestPath.replace(/\/package\.json$/, '');
    }
  }
  return undefined;
};

describe('API runtime image layout', () => {
  test('copies the dependency store and the API symlink farm that points into it', () => {
    expect(copiedSources).toContain('/app/node_modules');
    expect(copiedSources).toContain('/app/apps/api/node_modules');
  });

  test('copies every workspace package the API depends on at runtime', () => {
    const { dependencies = {} } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    const workspaceDependencies = Object.entries(dependencies)
      .filter(([, range]) => range.startsWith('workspace:'))
      .map(([name]) => name);

    // Guard the guard: if this ever empties out the assertion below is vacuous.
    expect(workspaceDependencies.length).toBeGreaterThan(0);

    for (const name of workspaceDependencies) {
      const directory = workspaceDirectoryFor(name);
      expect(directory, `no workspace directory declares ${name}`).toBeDefined();
      expect(copiedSources, `${name} (${directory}) is missing from the runner stage`).toContain(
        `/app/${directory}`,
      );
    }
  });
});
