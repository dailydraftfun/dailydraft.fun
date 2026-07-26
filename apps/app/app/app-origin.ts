/**
 * Every `/duel/*` route lives in this app, which is served from `app.dailydraft.fun`. The apex
 * `dailydraft.fun` is the marketing site (`apps/web`) and has no rewrite into this app, so a
 * canonical URL or social-card image URL built against the apex 404s. Fall back to the app origin.
 */
export const DEFAULT_APP_ORIGIN = 'https://app.dailydraft.fun';

export function resolveAppOrigin(): string {
  // Vercel stores a cleared variable as an empty string, not as absent, so `??` never fires and the
  // caller ends up building `new URL('')`. Treat blank as unset, matching `solana/config.ts`.
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_ORIGIN;
}
