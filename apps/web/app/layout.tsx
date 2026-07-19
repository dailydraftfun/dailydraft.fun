import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://openpacksduel-web.vercel.app'),
  title: 'Pack Duel — Two packs. One winner.',
  description:
    'Challenge a friend or another wallet to a synchronized trading card pack duel on Solana.',
  keywords: ['trading cards', 'pack opening', 'Solana', 'Pokémon cards', 'wallet duel'],
  openGraph: {
    title: 'Pack Duel — Two packs. One winner.',
    description: 'Rip the same pack together. The higher verified card value takes both pulls.',
    siteName: 'Pack Duel',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pack Duel — Two packs. One winner.',
    description: 'Rip the same pack together. The higher verified card value takes both pulls.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
