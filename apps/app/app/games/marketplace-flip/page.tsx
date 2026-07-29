import type { Metadata } from 'next';
import { MarketplaceFlipGame } from './marketplace-flip-game';

export const metadata: Metadata = {
  title: 'Marketplace Flip — DailyDraft Devnet',
  description:
    'Play the no-value Marketplace Flip prediction loop. Live inventory, custody, pricing, and settlement remain disabled.',
  robots: { follow: false, index: false, nocache: true },
};

export default function MarketplaceFlipPage() {
  return <MarketplaceFlipGame />;
}
