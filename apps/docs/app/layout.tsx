import type { Metadata } from 'next';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://openpacksduel-docs.vercel.app',
  ),
  title: {
    default: 'OpenPacks Duel Docs',
    template: '%s — OpenPacks Duel',
  },
  description:
    'Integration guides, API reference, Solana transaction rules, and verifiable duel proofs.',
  openGraph: {
    siteName: 'OpenPacks Duel Docs',
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
    projectLink="https://github.com/openpacksduel/app"
  />
);

const footer = (
  <Footer>
    <span>OpenPacks Duel · Solana devnet preview</span>
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
          docsRepositoryBase="https://github.com/openpacksduel/app/tree/main/apps/docs"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
