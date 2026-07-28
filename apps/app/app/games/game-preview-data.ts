export type PreviewMode = 'crash' | 'flip' | 'house';

// Single source for preview mode naming so the client preview component and the
// server-rendered route metadata cannot drift apart on a rebrand.
export const previewModeTitles: Record<PreviewMode, string> = {
  crash: 'Card Streak',
  flip: 'Marketplace Flip',
  house: 'Instant House',
};

export type PreviewCard = {
  imageUrl: string;
  name: string;
  value: number;
};

export type ActivityItem = {
  amount: string;
  badge: string;
  detail: string;
  href: string;
  id: string;
  mode: 'crash' | 'duels' | 'flip';
  player: string;
  proof: 'fixture' | 'receipt';
  time: string;
  title: string;
};

export const previewCards = {
  blastoise: {
    imageUrl: 'https://images.pokemontcg.io/base1/2_hires.png',
    name: 'Blastoise · Base Set',
    value: 54,
  },
  charizard: {
    imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    name: 'Charizard · Base Set',
    value: 72.5,
  },
  mewtwo: {
    imageUrl: 'https://images.pokemontcg.io/base1/10_hires.png',
    name: 'Mewtwo · Base Set',
    value: 42,
  },
  pikachu: {
    imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png',
    name: 'Pikachu · Base Set',
    value: 18.5,
  },
} satisfies Record<string, PreviewCard>;

export const activityItems: readonly ActivityItem[] = [
  {
    amount: '$113.50 total',
    badge: 'Duel receipt demo',
    detail: 'A sample receipt shows Charizard beating Blastoise by $18.50.',
    href: '/leaderboard',
    id: 'duel-1',
    mode: 'duels',
    player: 'Example wallet',
    proof: 'receipt',
    time: 'Example',
    title: 'Base Set duel receipt',
  },
  {
    amount: '$72.50 won',
    badge: 'Duel receipt demo',
    detail: 'A sample direct challenge receipt reaches finalized devnet settlement.',
    href: '/leaderboard',
    id: 'duel-2',
    mode: 'duels',
    player: 'Example wallet',
    proof: 'receipt',
    time: 'Example',
    title: 'Direct challenge receipt',
  },
  {
    amount: '$50 tier',
    badge: 'Refund receipt demo',
    detail: 'A sample timeout receipt makes the absence of pack and card movement explicit.',
    href: '/leaderboard',
    id: 'duel-3',
    mode: 'duels',
    player: 'Example wallet',
    proof: 'receipt',
    time: 'Example',
    title: 'Expired match refund receipt',
  },
  {
    amount: '$25 fixture',
    badge: 'Flip preview',
    detail: 'Scripted local UI with a fixed result and no selection proof or acquisition.',
    href: '/games/marketplace-flip',
    id: 'flip-1',
    mode: 'flip',
    player: 'Fixture player',
    proof: 'fixture',
    time: 'Preview',
    title: 'Charizard acquisition flow',
  },
  {
    amount: '$114.50 pot',
    badge: 'Crash preview',
    detail: 'Three card stages continued before a fixture cash-out.',
    href: '/games/crash',
    id: 'crash-1',
    mode: 'crash',
    player: 'Fixture player',
    proof: 'fixture',
    time: 'Preview',
    title: 'Three-stage cash-out flow',
  },
] as const;

export function activityForProof(
  proof: 'all' | ActivityItem['proof'],
  activity: readonly ActivityItem[] = activityItems,
): ActivityItem[] {
  return activity.filter((item) => proof === 'all' || item.proof === proof);
}
