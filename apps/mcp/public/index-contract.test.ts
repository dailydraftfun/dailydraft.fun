import { describe, expect, test } from 'bun:test';

// The hosted landing page is static markup with no component tree, so nothing in the
// suite reached it and two rebrand sweeps shipped past the wordmark it still carried.
// Asserting the raw file is the only guard that actually covers it.
const source = await Bun.file(new URL('./index.html', import.meta.url)).text();

describe('hosted MCP landing page', () => {
  test('renders the current wordmark in both the header and the footer', () => {
    expect(source.match(/<span class="brand-name">DAILYDRAFT<\/span>/g)).toHaveLength(2);
    expect(source).toContain('<title>DailyDraft MCP — Connect Claude and Codex</title>');
  });

  test('carries no trace of the retired brand', () => {
    const lowercased = source.toLowerCase();
    expect(lowercased).not.toContain('pack duel');
    expect(lowercased).not.toContain('packduel');
    expect(lowercased).not.toContain('openpacksduel');
  });
});
