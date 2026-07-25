import { describe, expect, mock, test } from 'bun:test';

interface ApiReferenceConfig {
  metaData?: { description?: string; title?: string };
  url?: string;
}

let capturedConfig: ApiReferenceConfig | undefined;

mock.module('@scalar/nextjs-api-reference', () => ({
  ApiReference: (config: ApiReferenceConfig) => {
    capturedConfig = config;
    return () => new Response(null, { status: 200 });
  },
}));

const { GET } = await import('./route');

describe('docs API reference route', () => {
  test('serves the bundled OpenAPI document', () => {
    expect(typeof GET).toBe('function');
    expect(capturedConfig?.url).toBe('/openapi.yaml');
  });

  test('titles the reference with the DailyDraft brand', () => {
    expect(capturedConfig?.metaData?.title).toBe('DailyDraft API Reference');
    expect(capturedConfig?.metaData?.title).not.toContain('OpenPacks');
  });

  // The description sat one field away from an asserted title and still shipped the
  // retired brand to the live reference page, so both metadata fields are guarded.
  test('describes the reference with the current game-mode name', () => {
    expect(capturedConfig?.metaData?.description).toBe(
      'Preview integration contract for card duels on Solana devnet',
    );
    const metaData = Object.values(capturedConfig?.metaData ?? {})
      .join(' ')
      .toLowerCase();
    expect(metaData).not.toContain('pack duel');
    expect(metaData).not.toContain('openpacksduel');
  });
});
