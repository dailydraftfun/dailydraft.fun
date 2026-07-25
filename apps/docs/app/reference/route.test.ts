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
});
