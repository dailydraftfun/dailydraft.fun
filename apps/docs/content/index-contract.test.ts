import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('developer docs game rules guidance', () => {
  test('deep-links every established mode to its canonical player rules', () => {
    const source = readFileSync(new URL('./index.mdx', import.meta.url), 'utf8');

    expect(source).toContain('https://app.dailydraft.fun/games/duel#rules');
    expect(source).toContain('https://app.dailydraft.fun/games/marketplace-flip#rules');
    expect(source).toContain('https://app.dailydraft.fun/games/crash#rules');
    expect(source).toContain('separate committed state, card ownership, and settlement finality');
  });
});
