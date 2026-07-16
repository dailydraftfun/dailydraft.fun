import type { Metadata } from 'next';
import type { PublicDuelReceipt, PublicDuelStatus } from './public-proof-client';

const defaultAppUrl = 'https://openpacksduel.vercel.app';

export function buildDuelMetadata(
  receipt: PublicDuelReceipt,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? defaultAppUrl,
): Metadata {
  const title = `${receiptTitle(receipt)} — Pack Duel`;
  const participantSummary = `${receipt.participants.creator.display} vs ${receipt.participants.opponent?.display ?? 'open seat'}`;
  const description = `${receipt.pack.name} duel on Solana devnet: ${participantSummary}. Status: ${receipt.duel.status}.`;
  const canonicalUrl = absoluteAppUrl(`/duel/${encodeURIComponent(receipt.duel.id)}`, appUrl);
  const imageUrl = absoluteAppUrl(
    `/duel/${encodeURIComponent(receipt.duel.id)}/social/${receipt.duel.status}`,
    appUrl,
  );
  const imageAlt = `${receiptTitle(receipt)} for ${participantSummary} on Solana devnet`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      images: [{ alt: imageAlt, height: 630, url: imageUrl, width: 1200 }],
      siteName: 'Pack Duel',
      type: 'website',
      url: canonicalUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ alt: imageAlt, url: imageUrl }],
    },
    robots: { follow: false, index: receipt.privacy.indexable, nocache: true },
  };
}

function absoluteAppUrl(pathname: string, appUrl: string): URL {
  const baseUrl = new URL(appUrl);
  return new URL(pathname, `${baseUrl.origin}/`);
}

function statusTitle(status: PublicDuelStatus): string {
  const titles: Record<PublicDuelStatus, string> = {
    awaiting_assets: 'Assets awaiting settlement',
    cancelled: 'Duel cancelled',
    cancelling: 'Cancellation in progress',
    committing: 'Funding in progress',
    expired: 'Challenge expired',
    failed: 'Duel failed',
    funded: 'Both fees funded',
    matched: 'Opponent matched',
    opening: 'Packs opening',
    refunded: 'Duel refunded',
    refunding: 'Refund in progress',
    settled: 'Duel settled',
    settling: 'Settlement in progress',
    waiting: 'Challenge open',
  };
  return titles[status];
}

export function receiptTitle(receipt: PublicDuelReceipt): string {
  if (
    receipt.result &&
    (receipt.pack.providerMode === 'mock' ||
      receipt.result.outcomes.some((outcome) => outcome.isMock))
  ) {
    return 'Devnet mock result';
  }
  return statusTitle(receipt.duel.status);
}
