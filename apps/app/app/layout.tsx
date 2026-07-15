import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './globals.css';
import { Providers } from './providers';
import { WorkspaceShell } from './workspace-shell';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://openpacksduel.vercel.app'),
  title: 'Pack Duel — Rip together. Winner takes all.',
  description: 'Challenge another wallet to a synchronized trading card pack duel on Solana.',
  openGraph: {
    siteName: 'Pack Duel',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <WorkspaceShell>{children}</WorkspaceShell>
        </Providers>
      </body>
    </html>
  );
}
