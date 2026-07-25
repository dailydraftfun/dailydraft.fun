import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The provider is loaded and rendered through apps/app/app/duel/duel-entry-stepper.test.tsx,
// which imports the real module before stubbing the hook, so a second render harness here
// would only see that stub. What it cannot catch is a regression in the persisted key,
// which would silently strand every saved wallet choice.
describe('solana wallet provider', () => {
  test('persists the selected wallet under the rebranded storage namespace', () => {
    const source = readFileSync(new URL('./wallet-provider.tsx', import.meta.url), 'utf8');

    expect(source).toContain("const walletStorageKey = 'dailydraft.wallet';");
    expect(source).not.toContain('openpacksduel');
  });
});
