import { afterEach, describe, expect, test } from 'bun:test';
import { FALLBACK_DOCS_URL, resolveDocsMetadataBase } from './metadata-base';

const originalDocsUrl = process.env.NEXT_PUBLIC_DOCS_URL;

afterEach(() => {
  if (originalDocsUrl === undefined) delete process.env.NEXT_PUBLIC_DOCS_URL;
  else process.env.NEXT_PUBLIC_DOCS_URL = originalDocsUrl;
});

describe('docs metadata base', () => {
  test('prefers the deployment URL when one is configured', () => {
    expect(resolveDocsMetadataBase('https://docs.dailydraft.fun')).toBe(
      'https://docs.dailydraft.fun',
    );
  });

  test('reads NEXT_PUBLIC_DOCS_URL when no override is passed', () => {
    process.env.NEXT_PUBLIC_DOCS_URL = 'https://preview.dailydraft.fun';

    expect(resolveDocsMetadataBase()).toBe('https://preview.dailydraft.fun');
  });

  test('falls back to the preview deployment when the variable is unset', () => {
    delete process.env.NEXT_PUBLIC_DOCS_URL;

    expect(resolveDocsMetadataBase()).toBe(FALLBACK_DOCS_URL);
  });

  test('always resolves to an absolute URL Next can use as a metadata base', () => {
    delete process.env.NEXT_PUBLIC_DOCS_URL;

    expect(new URL(resolveDocsMetadataBase()).protocol).toBe('https:');
  });
});
