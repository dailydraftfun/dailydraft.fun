import type { Metadata } from 'next';
import { type FlipCapabilities, flipDevnetCapabilities } from '../game-catalog';
import { GameModePreview } from '../game-mode-preview';
import { FlipMachine } from './flip-machine';

/**
 * Static route for the Sports Pack Gacha.
 *
 * This file takes `/games/flip` away from the dynamic `[mode]` route, which is
 * why `previewModes` there no longer lists `flip` — Next.js fails the build when
 * `generateStaticParams` claims a path a static segment also owns.
 */
export function generateMetadata(): Metadata {
  return {
    description:
      'Rip a sealed sports pack on Solana devnet with committed odds, a published seed hash, and a deposit you approve in full before anything is charged.',
    robots: { follow: false, index: false, nocache: true },
    title: 'Sports Pack Gacha — DailyDraft Devnet',
  };
}

/**
 * Which surface the route renders, as a pure function of the build-time gates.
 *
 * Split out so the contract test can assert both branches without manipulating
 * `NEXT_PUBLIC_*`, which Next.js substitutes textually at build time and cannot
 * be reassigned from a test.
 */
export function resolveFlipSurface(capabilities: FlipCapabilities): 'live' | 'preview' {
  const { acquisition, odds, provider, settlement } = capabilities;
  return acquisition && odds && provider && settlement ? 'live' : 'preview';
}

export default function FlipPage() {
  // The build-time mirror only decides which surface to mount. The live client
  // re-reads `GET /gacha/capability` on mount and fails shut on the server's
  // answer, so a gate that closed after the build can never reach a payment.
  const surface = resolveFlipSurface(flipDevnetCapabilities());

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:py-14">
      {surface === 'live' ? <FlipMachine /> : <GameModePreview mode="flip" />}
    </main>
  );
}
