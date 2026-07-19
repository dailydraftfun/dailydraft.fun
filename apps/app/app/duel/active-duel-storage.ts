type ActiveDuelStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type StoredActiveDuel = {
  duelId: string;
};

const activeDuelStorageKey = 'openpacksduel:active-duel:v1';
const duelIdPattern = /^duel_[A-Za-z0-9_-]{1,120}$/;

export function readStoredActiveDuel(storage: ActiveDuelStorage): StoredActiveDuel | null {
  try {
    const rawValue = storage.getItem(activeDuelStorageKey);
    if (!rawValue) return null;

    const value: unknown = JSON.parse(rawValue);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('duelId' in value) ||
      typeof value.duelId !== 'string' ||
      !duelIdPattern.test(value.duelId)
    ) {
      return null;
    }

    return { duelId: value.duelId };
  } catch {
    return null;
  }
}

export function storeActiveDuel(storage: ActiveDuelStorage, duelId: string): void {
  if (!duelIdPattern.test(duelId)) return;

  try {
    storage.setItem(activeDuelStorageKey, JSON.stringify({ duelId }));
  } catch {
    // A denied storage write only disables reload recovery for this tab.
  }
}

export function clearStoredActiveDuel(storage: ActiveDuelStorage): void {
  try {
    storage.removeItem(activeDuelStorageKey);
  } catch {
    // A denied storage removal must not block leaving the completed duel.
  }
}
