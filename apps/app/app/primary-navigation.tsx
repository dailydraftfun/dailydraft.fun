import { ChartBarIcon } from '@phosphor-icons/react';

export function PrimaryNavigation({
  className,
  leaderboardActive,
  mobile = false,
}: {
  className: string;
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
