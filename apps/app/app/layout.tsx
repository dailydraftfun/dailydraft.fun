import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './globals.css';
import { Providers } from './providers';
import { WorkspaceShell } from './workspace-shell';

export const metadata: Metadata = {
  title: 'Pack Duel — Rip together. Winner takes all.',
  description: 'Challenge another wallet to a synchronized trading card pack duel on Solana.',
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
