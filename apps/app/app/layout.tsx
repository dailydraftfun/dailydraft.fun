import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './globals.css';
import { resolveAppOrigin } from './app-origin';
import { Providers } from './providers';
import { WorkspaceShell } from './workspace-shell';

export const metadata: Metadata = {
  metadataBase: new URL(resolveAppOrigin()),
  title: 'DailyDraft Devnet — Own the cards. Field the squad.',
  description:
    'Devnet preview: rip real, vaulted sports cards from Collector Crypt and play sports fantasy loops on Solana using test SOL and test assets.',
  openGraph: {
    siteName: 'DailyDraft Devnet',
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
