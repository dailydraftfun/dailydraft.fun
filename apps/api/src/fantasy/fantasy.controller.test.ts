import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const API_ROOT = resolve(import.meta.dir, '../..');

describe('FantasyController', () => {
  test('reports the complete gated Solana-devnet capability contract', async () => {
    if (process.cwd() !== API_ROOT) return runFromApiWorkspace();
    const [{ FantasyController }, { MatchDataOracleService }, { MockMatchDataOracle }] =
      await Promise.all([
        import('./fantasy.controller.js'),
        import('./match-data-oracle.service.js'),
        import('./mock-match-data-oracle.js'),
      ]);
    const controller = new FantasyController(new MatchDataOracleService(new MockMatchDataOracle()));
    const reason =
      'Fantasy tournaments are not yet playable on Solana devnet. The match-data oracle, kickoff snapshot, and payout settlement are pending review.';

    expect(controller.getCapabilities()).toEqual({
      modes: {
        tournaments: { enabled: false, reason },
        entries: { enabled: false, reason },
        payouts: { enabled: false, reason },
      },
      network: 'solana-devnet',
      oracle: { live: false, mode: 'mock' },
    });
  });
});

async function runFromApiWorkspace(): Promise<void> {
  const subprocess = Bun.spawn(['bun', 'test', import.meta.path], {
    cwd: API_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}${stderr}`);
}
