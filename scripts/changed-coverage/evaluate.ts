import { isAbsolute, resolve } from 'node:path';

import type { ChangedLineMap } from './changed-lines';
import { normalizeRepositoryPath, repositoryPath } from './changed-lines';

interface Position {
  line: number;
}

interface SourceLocation {
  end: Position;
  start: Position;
}

interface BranchMetadata {
  locations: SourceLocation[];
  loc?: SourceLocation;
}

export interface IstanbulFileCoverage {
  b: Record<string, number[]>;
  branchMap: Record<string, BranchMetadata>;
  path?: string;
  s: Record<string, number>;
  statementMap: Record<string, SourceLocation>;
}

export type IstanbulCoverage = Record<string, IstanbulFileCoverage>;

export interface CoverageEvaluation {
  branches: CoverageMetric;
  lines: CoverageMetric;
  missingFiles: string[];
  passed: boolean;
  threshold: number;
}

export interface CoverageMetric {
  covered: number;
  percentage: number;
  total: number;
}

export function evaluateChangedCoverage(input: {
  changedLines: ChangedLineMap;
  coverage: IstanbulCoverage;
  repositoryRoot: string;
  threshold: number;
}): CoverageEvaluation {
  const coverageByPath = normalizeCoveragePaths(input.coverage, input.repositoryRoot);
  const lineHits: number[] = [];
  const branchHits: number[] = [];
  const missingFiles: string[] = [];

  for (const [path, changedLines] of input.changedLines) {
    const fileCoverage = coverageByPath.get(normalizeRepositoryPath(path));
    if (!fileCoverage) {
      missingFiles.push(path);
      for (const _line of changedLines) lineHits.push(0);
      continue;
    }

    const hitsByLine = new Map<number, number>();
    for (const [statementId, location] of Object.entries(fileCoverage.statementMap)) {
      const hits = fileCoverage.s[statementId] ?? 0;
      const line = location.start.line;
      hitsByLine.set(line, Math.max(hitsByLine.get(line) ?? 0, hits));
    }
    for (const line of changedLines) {
      const hits = hitsByLine.get(line);
      if (hits !== undefined) lineHits.push(hits);
    }

    for (const [branchId, metadata] of Object.entries(fileCoverage.branchMap)) {
      if (!branchTouchesChangedLine(metadata, changedLines)) continue;
      branchHits.push(...(fileCoverage.b[branchId] ?? []));
    }
  }

  const lines = metric(lineHits);
  const branches = metric(branchHits);
  return {
    branches,
    lines,
    missingFiles,
    passed:
      missingFiles.length === 0 &&
      lines.percentage >= input.threshold &&
      branches.percentage >= input.threshold,
    threshold: input.threshold,
  };
}

function normalizeCoveragePaths(
  coverage: IstanbulCoverage,
  repositoryRoot: string,
): Map<string, IstanbulFileCoverage> {
  const normalized = new Map<string, IstanbulFileCoverage>();
  for (const [key, value] of Object.entries(coverage)) {
    const path = value.path ?? key;
    const absolutePath = isAbsolute(path) ? path : resolve(repositoryRoot, path);
    normalized.set(repositoryPath(repositoryRoot, absolutePath), value);
  }
  return normalized;
}

function branchTouchesChangedLine(metadata: BranchMetadata, changedLines: Set<number>): boolean {
  const locations = metadata.loc ? [metadata.loc, ...metadata.locations] : metadata.locations;
  return locations.some((location) => locationTouchesChangedLine(location, changedLines));
}

function locationTouchesChangedLine(location: SourceLocation, changedLines: Set<number>): boolean {
  for (let line = location.start.line; line <= location.end.line; line += 1) {
    if (changedLines.has(line)) return true;
  }
  return false;
}

function metric(hits: number[]): CoverageMetric {
  const covered = hits.filter((count) => count > 0).length;
  const total = hits.length;
  return {
    covered,
    percentage: total === 0 ? 1 : covered / total,
    total,
  };
}
