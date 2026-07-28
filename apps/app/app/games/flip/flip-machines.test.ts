import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FLIP_MACHINE,
  FLIP_MACHINES,
  FLIP_SPORTS,
  FLIP_TIERS,
  findFlipMachine,
  flipMachineKey,
} from './flip-machines';

describe('flip machine catalog', () => {
  test('derives the twelve devnet machine keys the provider mints', () => {
    expect(FLIP_MACHINES).toHaveLength(FLIP_SPORTS.length * FLIP_TIERS.length);
    expect(FLIP_MACHINES).toHaveLength(12);
    expect(FLIP_MACHINES[0]).toEqual({
      machineKey: 'dailydraft-devnet-football-10000',
      sport: 'football',
      sportLabel: 'Football',
      tierLabel: '$0.01',
      tierPriceMinor: '10000',
    });
    expect(flipMachineKey('basketball', '1000000')).toBe('dailydraft-devnet-basketball-1000000');
  });

  test('emits keys the server machine-key validator accepts', () => {
    // GachaMachineParams: /^[a-z0-9][a-z0-9._:-]{0,127}$/. A key this file gets
    // wrong must fail the route's validator or 404, never match another machine.
    for (const machine of FLIP_MACHINES) {
      expect(machine.machineKey).toMatch(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
    }
    expect(new Set(FLIP_MACHINES.map((machine) => machine.machineKey)).size).toBe(12);
  });

  test('keeps the sport lowercase in keys even though the wire enum is uppercase', () => {
    for (const machine of FLIP_MACHINES) {
      expect(machine.machineKey).toContain(`-${machine.sport}-`);
      expect(machine.sport).toBe(machine.sport.toLowerCase() as typeof machine.sport);
    }
  });

  test('resolves a machine by sport and tier and rejects a combination that does not exist', () => {
    expect(findFlipMachine('soccer', '100000')).toMatchObject({
      machineKey: 'dailydraft-devnet-soccer-100000',
      tierLabel: '$0.10',
    });
    expect(findFlipMachine('soccer', '75000')).toBeUndefined();
  });

  test('defaults to the cheapest football machine so the first render is priced', () => {
    expect(DEFAULT_FLIP_MACHINE).toMatchObject({ sport: 'football', tierPriceMinor: '10000' });
  });
});
