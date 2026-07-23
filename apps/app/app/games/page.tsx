import type { Metadata } from 'next';
import { GameLobby } from './game-lobby';

export const metadata: Metadata = {
  title: 'Card games — Pack Duel Devnet',
  description:
    'Explore Pack Duel, Flip Gacha, and Crash as capability-gated card games on Solana devnet.',
  robots: { follow: false, index: false, nocache: true },
};

export default function GamesPage() {
  return <GameLobby />;
}
