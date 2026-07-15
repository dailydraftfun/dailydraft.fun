import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Openpacksduel',
  description: 'Frontend-only Solana Pokemon pack duel MVP with quick matchmaking, wallet challenges, synchronized reveals, and shareable outcomes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
