import type { Metadata } from 'next';
import { GameLobby } from './game-lobby';

export const metadata: Metadata = {
  title: 'Card games — DailyDraft Devnet',
  description:
    'Play Card Duel, Sports Pack Gacha, Marketplace Flip, and Card Streak from one honest game hub on Solana devnet.',
  robots: { follow: false, index: false, nocache: true },
};

export default function GamesPage() {
  return <GameLobby />;
}
