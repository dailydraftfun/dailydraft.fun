'use client';

import { ChartBarIcon, LightningIcon } from '@phosphor-icons/react';
import { usePathname } from 'next/navigation';
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
  const duelNavigationActive = pathname === '/overview' || pathname.startsWith('/duel/');
  const leaderboardNavigationActive = pathname === '/leaderboard';

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
              Devnet
            </span>
          </a>

          <PrimaryNavigation
            className="ml-4 hidden items-center gap-1 lg:flex"
            duelActive={duelNavigationActive}
            leaderboardActive={leaderboardNavigationActive}
          />

          <div className="ml-auto flex items-center gap-2">
            <WalletControl />
          </div>
        </div>
        <PrimaryNavigation
          className="grid grid-cols-2 border-t border-border px-4 py-1 lg:hidden"
          duelActive={duelNavigationActive}
          leaderboardActive={leaderboardNavigationActive}
          mobile
        />
        <div className="devnet-disclosure" role="status" aria-label="Devnet environment notice">
          <span className="devnet-disclosure-label">
            <i aria-hidden="true" />
            Devnet preview
          </span>
          <span>
            Test SOL and test assets only. No mainnet funds. Collector Crypt live pack settlement is
            not enabled yet.
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}

function PrimaryNavigation({
  className,
  duelActive,
  leaderboardActive,
  mobile = false,
}: {
  className: string;
  duelActive: boolean;
  leaderboardActive: boolean;
  mobile?: boolean;
}) {
  const linkClassName = mobile ? 'nav-link justify-center' : 'nav-link';
  return (
    <nav
      className={className}
      aria-label={mobile ? 'Mobile primary navigation' : 'Primary navigation'}
    >
      <a
        aria-current={duelActive ? 'page' : undefined}
        className={`${linkClassName}${duelActive ? ' nav-link-active' : ''}`}
        href="/overview"
      >
        <LightningIcon size={15} weight="fill" />
        Duels
      </a>
      <a
        aria-current={leaderboardActive ? 'page' : undefined}
        className={`${linkClassName}${leaderboardActive ? ' nav-link-active' : ''}`}
        href="/leaderboard"
      >
        <ChartBarIcon size={15} />
        Leaderboard
      </a>
    </nav>
  );
}
