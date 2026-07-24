import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

const WALLET = '11111111111111111111111111111111';
const API_ROOT = resolve(import.meta.dir, '../..');

describe('fantasy route parameter schemas', () => {
  test('accepts canonical tournament, player, and wallet identifiers', async () => {
    if (process.cwd() !== API_ROOT) return runFromApiWorkspace();
    const { FantasyPlayerIdParams, FantasyTournamentIdParams, FantasyWalletParams } = await import(
      './fantasy.dto.js'
    );
    expect(
      validateSync(
        Object.assign(new FantasyTournamentIdParams(), {
          tournamentId: 'fantnmt_AbCdEf123456',
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        Object.assign(new FantasyPlayerIdParams(), {
          playerId: 'fanplyr_AbCdEf123456',
        }),
      ),
    ).toHaveLength(0);
    expect(validateSync(Object.assign(new FantasyWalletParams(), { wallet: WALLET }))).toHaveLength(
      0,
    );
  });

  test('rejects malformed tournament, player, and wallet identifiers', async () => {
    if (process.cwd() !== API_ROOT) return runFromApiWorkspace();
    const { FantasyPlayerIdParams, FantasyTournamentIdParams, FantasyWalletParams } = await import(
      './fantasy.dto.js'
    );
    expect(
      validateSync(
        Object.assign(new FantasyTournamentIdParams(), { tournamentId: 'fantnmt_short' }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(Object.assign(new FantasyPlayerIdParams(), { playerId: 'player_AbCdEf123456' }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(Object.assign(new FantasyWalletParams(), { wallet: `${WALLET}0` })).length,
    ).toBeGreaterThan(0);
  });
});

describe('ListFantasyTournamentsQuery', () => {
  test('accepts defaults and all supported filters', async () => {
    if (process.cwd() !== API_ROOT) return runFromApiWorkspace();
    const { ListFantasyTournamentsQuery } = await import('./fantasy.dto.js');
    expect(validateSync(new ListFantasyTournamentsQuery())).toHaveLength(0);

    const query = plainToInstance(ListFantasyTournamentsQuery, {
      cursor: 'next-page',
      limit: '100',
      position: 'FORWARD',
      sport: 'SOCCER',
      status: 'settled',
      wallet: WALLET,
    });
    expect(query.limit).toBe(100);
    expect(validateSync(query)).toHaveLength(0);
  });

  test('rejects invalid cursor, limit, enum, status, and wallet values', async () => {
    if (process.cwd() !== API_ROOT) return runFromApiWorkspace();
    const { ListFantasyTournamentsQuery } = await import('./fantasy.dto.js');
    const invalidQueries = [
      { cursor: 42 },
      { cursor: 'x'.repeat(257) },
      { limit: 1.5 },
      { limit: 0 },
      { limit: 101 },
      { position: 'CENTER' },
      { sport: 'HOCKEY' },
      { status: 'playing' },
      { wallet: 'not-a-wallet' },
    ];

    for (const invalid of invalidQueries) {
      const query = Object.assign(new ListFantasyTournamentsQuery(), invalid);
      expect(validateSync(query).length).toBeGreaterThan(0);
    }
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
