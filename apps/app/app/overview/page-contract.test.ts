import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve(import.meta.dir, 'page.tsx'), 'utf8');

describe('overview shared-route boundary', () => {
  test('never serializes participant wallet addresses into DuelArena props', () => {
    expect(pageSource).not.toContain('.address');
    expect(pageSource).not.toContain('address:');
    expect(pageSource).toContain('opponentLabel: receipt.participants.creator.display');
    expect(pageSource).toContain('participantLabels:');
  });
});
