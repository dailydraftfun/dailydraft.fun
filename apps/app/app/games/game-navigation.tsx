'use client';

import { CardsThreeIcon, ChartBarIcon, SparkleIcon, SwordIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const gameNavigationItems = [
  {
    href: '/games',
    icon: CardsThreeIcon,
    label: 'Arena',
  },
  {
    href: '/games/duel',
    icon: SwordIcon,
    label: 'Duel',
  },
  {
    href: '/games/gacha',
    icon: SparkleIcon,
    label: 'Pack Gacha',
  },
  {
    href: '/games/activity',
    icon: ChartBarIcon,
    label: 'Activity',
  },
] as const;

export function isGameNavigationItemActive(pathname: string, href: string) {
  if (href === '/games') return pathname === href;
  if (href === '/games/gacha') {
    return pathname === href || pathname.startsWith(`${href}/`) || pathname === '/games/flip';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function GameNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Games"
      className="border-b border-border bg-secondary/90 px-3 backdrop-blur-xl sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-[1500px] gap-1 overflow-x-auto py-2">
        {gameNavigationItems.map(({ href, icon: Icon, label }) => {
          const active = isGameNavigationItemActive(pathname, href);
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`nav-link min-h-10 shrink-0 px-3${active ? ' nav-link-active bg-lime/5' : ''}`}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={16} weight={active ? 'fill' : 'regular'} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
