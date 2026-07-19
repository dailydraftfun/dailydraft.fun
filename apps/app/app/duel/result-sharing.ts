export type NativeShareOutcome = 'cancelled' | 'copied' | 'shared';

export async function shareNativeResult(
  payload: { text: string; title: string; url: string },
  capabilities: {
    share?: (payload: { text: string; title: string; url: string }) => Promise<void>;
    writeClipboard: (value: string) => Promise<void>;
  },
): Promise<NativeShareOutcome> {
  try {
    if (capabilities.share) {
      await capabilities.share(payload);
      return 'shared';
    }
    await capabilities.writeClipboard(`${payload.text}\n${payload.url}`);
    return 'copied';
  } catch (error) {
    if (isAbortError(error)) return 'cancelled';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}
