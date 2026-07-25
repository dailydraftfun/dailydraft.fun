import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dailydraft.fun'),
  title: 'Grail — Own the cards. Field the squad.',
  description:
    'A sports fantasy casino on Solana. Rip real, vaulted sports cards from Collector Crypt, build a squad, and win tournaments scored by live match data.',
  keywords: [
    'sports fantasy',
    'fantasy casino',
    'Solana',
    'Collector Crypt',
    'sports cards',
    'football',
    'soccer',
    'baseball',
    'basketball',
  ],
  openGraph: {
    title: 'Grail — Own the cards. Field the squad.',
    description:
      'Rip real, vaulted sports cards from Collector Crypt and win tournaments scored by live match data on Solana.',
    siteName: 'Grail',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Grail — Own the cards. Field the squad.',
    description:
      'Rip real, vaulted sports cards from Collector Crypt and win tournaments scored by live match data on Solana.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
