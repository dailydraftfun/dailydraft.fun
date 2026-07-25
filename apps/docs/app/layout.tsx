import type { Metadata } from 'next';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://dailydraft-docs.vercel.app'),
  title: {
    default: 'DailyDraft Docs',
    template: '%s — DailyDraft',
  },
  description:
    'Integration guides, API reference, Solana transaction rules, and verifiable duel proofs.',
  openGraph: {
    siteName: 'DailyDraft Docs',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

const navbar = (
  <Navbar
    logo={
      <span className="docs-logo">
        <span className="docs-logo-mark" aria-hidden="true">
          <span />
          <span />
        </span>
        <strong>PACK DUEL</strong>
        <span>DOCS</span>
      </span>
    }
    projectLink="https://github.com/dailydraftfun/dailydraft.fun"
  />
);

const footer = (
  <Footer>
    <span>DailyDraft · Solana devnet preview</span>
  </Footer>
);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="◆" />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/dailydraftfun/dailydraft.fun/tree/main/apps/docs"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
