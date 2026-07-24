import type { Metadata } from 'next';
import { GameLobby } from './game-lobby';

export const metadata: Metadata = {
  title: 'Card games — Grail Devnet',
  description:
    'Explore Card Duels, Sports Pack Gacha, Fantasy Tournaments, and Card Streak as capability-gated sports card games on Solana devnet.',
  robots: { follow: false, index: false, nocache: true },
};

export default function GamesPage() {
  return <GameLobby />;
}
