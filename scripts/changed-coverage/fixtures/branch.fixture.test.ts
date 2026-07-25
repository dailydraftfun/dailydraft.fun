import { expect, test } from 'bun:test';

import { branchFixture } from './branch.fixture';

test('runs the configured branch outcomes', () => {
  expect(branchFixture(true)).toBe('covered');
  if (process.env.DAILYDRAFT_COVERAGE_FIXTURE_COMPLETE === '1') {
    expect(branchFixture(false)).toBe('alternate');
  }
});
