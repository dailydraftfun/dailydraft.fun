'use client';

import { ChartBarIcon, LightningIcon } from '@phosphor-icons/react';
import { WalletControl } from './solana/wallet-control';

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-primary text-primary">
      <header className="sticky top-0 z-50 border-b border-border bg-primary/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 sm:px-6">
          <a
            href="/overview"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="Pack Duel home"
          >
            <BrandMark />
            <span className="text-sm font-semibold tracking-[-0.02em] text-primary sm:text-base">
              Pack Duel
            </span>
            <span className="rounded-sm border border-lime/25 bg-lime/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-lime">
              Demo
            </span>
          </a>

          <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            <a className="nav-link nav-link-active" href="/overview">
              <LightningIcon size={15} weight="fill" />
              Duels
            </a>
            <button className="nav-link" type="button" title="Coming after the demo">
              <ChartBarIcon size={15} />
              Leaderboard
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-secondary md:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              18 players online
            </div>
            <WalletControl />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
