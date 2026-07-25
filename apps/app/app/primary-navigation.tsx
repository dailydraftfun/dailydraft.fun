import { CardsThreeIcon, ChartBarIcon, LightningIcon } from '@phosphor-icons/react';

export function PrimaryNavigation({
  className,
  duelActive,
  gamesActive,
  leaderboardActive,
  mobile = false,
}: {
  className: string;
  duelActive: boolean;
  gamesActive: boolean;
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
        aria-current={gamesActive ? 'page' : undefined}
        className={`${linkClassName}${gamesActive ? ' nav-link-active' : ''}`}
        href="/games"
      >
        <CardsThreeIcon size={15} weight="fill" />
        Games
      </a>
      <a
        aria-current={duelActive ? 'page' : undefined}
        className={`${linkClassName}${duelActive ? ' nav-link-active' : ''}`}
        href="/overview"
      >
        <LightningIcon size={15} weight="fill" />
        Card Duels
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
