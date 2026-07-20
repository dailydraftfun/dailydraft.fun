import { relative, resolve, sep } from 'node:path';

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;
const NON_EXECUTABLE_SOURCE = [
  /\.d\.[cm]?ts$/,
  /\.(?:test|spec|journey)\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:generated|dist|build|out|coverage)(?:\/|$)/,
  /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/,
];

export type ChangedLineMap = Map<string, Set<number>>;

export interface Workspace {
  directory: string;
  name: string;
  testScript: string | null;
}

export function parseChangedLines(diff: string): ChangedLineMap {
  const changed = new Map<string, Set<number>>();
  let currentPath: string | null = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      currentPath = path === '/dev/null' ? null : normalizeRepositoryPath(path.replace(/^b\//, ''));
      continue;
    }

    if (!currentPath || !line.startsWith('@@ ')) continue;
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;

    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) continue;

    const lines = changed.get(currentPath) ?? new Set<number>();
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    changed.set(currentPath, lines);
  }

  return changed;
}

export function isExecutableSource(path: string): boolean {
  const normalized = normalizeRepositoryPath(path);
  return (
    SOURCE_EXTENSION.test(normalized) &&
    NON_EXECUTABLE_SOURCE.every((pattern) => !pattern.test(normalized))
  );
}

export function workspaceForPath(
  repositoryRoot: string,
  path: string,
  workspaces: Workspace[],
): Workspace | null {
  const absolutePath = resolve(repositoryRoot, path);
  return (
    workspaces
      .filter(({ directory }) => {
        const prefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
        return absolutePath.startsWith(prefix);
      })
      .sort((left, right) => right.directory.length - left.directory.length)[0] ?? null
  );
}

export function repositoryPath(repositoryRoot: string, absolutePath: string): string {
  return normalizeRepositoryPath(relative(repositoryRoot, absolutePath));
}

export function normalizeRepositoryPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}
