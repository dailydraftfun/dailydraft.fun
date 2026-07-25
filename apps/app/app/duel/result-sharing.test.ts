import { describe, expect, test } from 'bun:test';
import { shareNativeResult } from './result-sharing';

const payload = {
  text: 'I won a Card Duel.',
  title: 'Card Duel result',
  url: 'https://dailydraft.example/duel/duel_share',
};

describe('native result sharing', () => {
  test('uses the native share capability when available', async () => {
    const shared: unknown[] = [];

    await expect(
      shareNativeResult(payload, {
        share: async (value) => {
          shared.push(value);
        },
        writeClipboard: async () => {
          throw new Error('clipboard should not run');
        },
      }),
    ).resolves.toBe('shared');
    expect(shared).toEqual([payload]);
  });

  test('falls back to a status-aware clipboard payload', async () => {
    const copied: string[] = [];

    await expect(
      shareNativeResult(payload, {
        writeClipboard: async (value) => {
          copied.push(value);
        },
      }),
    ).resolves.toBe('copied');
    expect(copied).toEqual([`${payload.text}\n${payload.url}`]);
  });

  test('treats native-share cancellation as a non-error', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';

    await expect(
      shareNativeResult(payload, {
        share: async () => {
          throw abortError;
        },
        writeClipboard: async () => undefined,
      }),
    ).resolves.toBe('cancelled');
  });
});
