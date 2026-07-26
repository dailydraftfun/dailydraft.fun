import { describe, expect, test } from 'bun:test';

import {
  ESCROW_DUEL_VERSION,
  ESCROW_V2_IDL_SHA256,
  ESCROW_V2_PROGRAM_ID,
  ESCROW_V2_SOURCE_SHA,
} from './dailydraft-escrow-v2.js';

// The README restates every provenance value this module exports, and the two
// SHAs are published to clients through the funding metadata. Nothing compared
// the prose to the constants, so a republished artifact could leave the README
// pointing at a build the API no longer accepts. The whole file is asserted
// rather than the lines that happened to be remembered.
const readme = await Bun.file(new URL('./README.md', import.meta.url)).text();

describe('vendored escrow contract surface', () => {
  test('documents exactly the provenance the module exports', () => {
    expect(readme).toContain(ESCROW_V2_SOURCE_SHA);
    expect(readme).toContain(ESCROW_V2_IDL_SHA256);
    expect(readme).toContain(ESCROW_V2_PROGRAM_ID.toBase58());
    expect(readme).toContain(`Duel account version: \`${ESCROW_DUEL_VERSION}\``);
  });

  test('names the republished artifact and IDL, with no trace of the retired brand', () => {
    expect(readme.toLowerCase()).not.toContain('openpacksduel');
    expect(readme).toContain(`Artifact: \`dailydraft-escrow-${ESCROW_V2_SOURCE_SHA}\``);
    expect(readme).toContain('IDL file: `dailydraft_escrow.json`');
  });
});
