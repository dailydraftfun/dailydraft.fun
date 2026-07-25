import { describe, expect, test } from 'bun:test';

import {
  clearStoredActiveDuel,
  readStoredActiveDuel,
  storeActiveDuel,
} from './active-duel-storage';

type TestStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function createStorage(): TestStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('active duel storage', () => {
  test('round-trips a valid active duel ID', () => {
    const storage = createStorage();

    storeActiveDuel(storage, 'duel_fixture_reload-1');

    expect(readStoredActiveDuel(storage)).toEqual({ duelId: 'duel_fixture_reload-1' });
  });

  test('rejects malformed payloads and unsafe duel IDs', () => {
    const malformedStorage = createStorage();
    malformedStorage.setItem('dailydraft:active-duel:v1', '{not-json');
    expect(readStoredActiveDuel(malformedStorage)).toBeNull();

    const unsafeStorage = createStorage();
    unsafeStorage.setItem('dailydraft:active-duel:v1', JSON.stringify({ duelId: '../duel_other' }));
    expect(readStoredActiveDuel(unsafeStorage)).toBeNull();

    const missingStorage = createStorage();
    missingStorage.setItem('dailydraft:active-duel:v1', JSON.stringify({ duelId: 42 }));
    expect(readStoredActiveDuel(missingStorage)).toBeNull();
  });

  test('does not throw when browser storage is denied', () => {
    const deniedStorage: TestStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(readStoredActiveDuel(deniedStorage)).toBeNull();
    expect(() => storeActiveDuel(deniedStorage, 'duel_fixture_denied')).not.toThrow();
    expect(() => clearStoredActiveDuel(deniedStorage)).not.toThrow();
  });

  test('clears a stored active duel', () => {
    const storage = createStorage();
    storeActiveDuel(storage, 'duel_fixture_clear');

    clearStoredActiveDuel(storage);

    expect(readStoredActiveDuel(storage)).toBeNull();
  });
});
