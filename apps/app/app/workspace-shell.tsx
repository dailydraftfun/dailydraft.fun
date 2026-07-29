'use client';

import { usePathname } from 'next/navigation';
import { AudioHapticsControl, AudioHapticsProvider } from './components/audio-haptics';
import { PrimaryNavigation } from './primary-navigation';
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
  const pathname = usePathname();
  const leaderboardNavigationActive = pathname === '/leaderboard';

  return (
    <AudioHapticsProvider>
      <div className="min-h-screen bg-primary text-primary">
        <header className="sticky top-0 z-50 border-b border-border bg-primary">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 sm:px-6">
            <a
              href="/games"
              className="flex shrink-0 items-center gap-2.5"
              aria-label="DailyDraft home"
            >
              <BrandMark />
              <span className="hidden text-sm font-semibold tracking-[-0.02em] text-primary sm:inline sm:text-base">
                DailyDraft
              </span>
              <span
                className="rounded-sm border border-lime/25 bg-lime/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-lime"
                title="Devnet preview · Test SOL and test assets only · No mainnet funds"
              >
                Devnet<span className="hidden sm:inline"> preview</span>
                <span className="sr-only">
                  . Devnet preview uses test SOL and test assets only; no mainnet funds.
                </span>
              </span>
            </a>

            <PrimaryNavigation
              className="ml-4 hidden items-center gap-1 lg:flex"
              leaderboardActive={leaderboardNavigationActive}
            />

            <div className="ml-auto flex items-center gap-2">
              <AudioHapticsControl />
              <WalletControl />
            </div>
          </div>
          <PrimaryNavigation
            className="flex justify-center border-t border-border px-4 py-1 lg:hidden"
            leaderboardActive={leaderboardNavigationActive}
            mobile
          />
        </header>
        {children}
      </div>
    </AudioHapticsProvider>
  );
}
