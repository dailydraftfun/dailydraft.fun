import type { Metadata } from 'next';
import { GameModePreview } from '../game-mode-preview';

export const metadata: Metadata = {
  title: 'Marketplace Flip preview — DailyDraft Devnet',
  description:
    'Fixture-only Marketplace Flip journey. Live inventory, custody, pricing, and settlement are not enabled.',
  robots: { follow: false, index: false, nocache: true },
};

export default function MarketplaceFlipPage() {
  return <GameModePreview mode="flip" />;
}
