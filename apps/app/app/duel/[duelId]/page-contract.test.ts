import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve(import.meta.dir, 'page.tsx'), 'utf8');

describe('public duel page contract', () => {
  test('keeps one dominant receipt action', () => {
    expect(pageSource).not.toContain('<Link className="proof-primary-action"');
    expect(pageSource.match(/className="proof-primary-action shrink-0"/g)).toHaveLength(1);
  });

  test('does not expose the raw receipt download from the spectator surface', () => {
    expect(pageSource).not.toContain('publicReceiptDownloadUrl');
    expect(pageSource).not.toContain('Machine-readable receipt');
    expect(pageSource).not.toContain('Download JSON');
  });
});
