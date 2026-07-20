import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { type Loader, plugin } from 'bun';
import { createInstrumenter } from 'istanbul-lib-instrument';

import type { IstanbulCoverage } from './evaluate';

const targetsPath = requiredEnvironment('OPENPACKSDUEL_COVERAGE_TARGETS');
const outputPath = requiredEnvironment('OPENPACKSDUEL_COVERAGE_OUTPUT');
const targets = new Set(
  (JSON.parse(readFileSync(targetsPath, 'utf8')) as string[]).map((path) => resolve(path)),
);

plugin({
  name: 'changed-code-coverage',
  setup(builder) {
    builder.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, async ({ path }) => {
      const absolutePath = resolve(path);
      if (!targets.has(absolutePath)) return undefined;

      const source = await Bun.file(absolutePath).text();
      return {
        contents: instrument(source, absolutePath),
        loader: loaderFor(absolutePath),
      };
    });
  },
});

process.on('exit', () => {
  const coverage = (globalThis as typeof globalThis & { __coverage__?: IstanbulCoverage })
    .__coverage__;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(coverage ?? {}, null, 2)}\n`);
});

function instrument(source: string, path: string): string {
  const loader = loaderFor(path);
  const parserPlugins = [
    ...(loader === 'ts' || loader === 'tsx' ? ['typescript'] : []),
    ...(loader === 'jsx' || loader === 'tsx' ? ['jsx'] : []),
    'decorators-legacy',
  ];
  return createInstrumenter({
    coverageGlobalScope: 'globalThis',
    coverageGlobalScopeFunc: false,
    esModules: true,
    parserPlugins,
    produceSourceMap: false,
  }).instrumentSync(source, path);
}

function loaderFor(path: string): Loader {
  const extension = extname(path);
  if (extension === '.tsx') return 'tsx';
  if (extension === '.jsx') return 'jsx';
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return 'ts';
  return 'js';
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
