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
    <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <p className="proof-label">Live on devnet</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-4xl">
          Rip a pack.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
          Pick your sport, crack the seal, and watch your card reveal. Every pull is committed
          before your wallet opens.
        </p>
      </header>
      <FlipMachine />
    </main>
  );
}
