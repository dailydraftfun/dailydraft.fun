export const FALLBACK_DOCS_URL = 'https://docs.dailydraft.fun';

// Kept out of layout.tsx so both sides of the fallback are reachable from a test.
// Inlined in the metadata literal it would only ever evaluate once per process,
// against whatever NEXT_PUBLIC_DOCS_URL happened to be set at import time.
export function resolveDocsMetadataBase(url = process.env.NEXT_PUBLIC_DOCS_URL): string {
  return url ?? FALLBACK_DOCS_URL;
}
