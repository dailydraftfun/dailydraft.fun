import type { Metadata } from 'next';
import { FlipMachine } from '../flip/flip-machine';

export function generateMetadata(): Metadata {
  return {
    description:
      'Rip a sealed sports pack on Solana devnet with committed odds, a published seed hash, and a deposit you approve in full before anything is charged.',
    robots: { follow: false, index: false, nocache: true },
    title: 'Sports Pack Gacha — DailyDraft Devnet',
  };
}

export default function GachaPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:py-14">
      <header className="border-b border-border pb-6">
        <p className="proof-label">Live game · server gated</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
          Sports Pack Gacha
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-secondary">
          Choose a sport and tier, review the server-committed odds and deposit, then reveal the
          exact card settled by the game service.
        </p>
      </header>
      <FlipMachine />
    </main>
  );
}
