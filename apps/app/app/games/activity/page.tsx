import type { Metadata } from 'next';
import { ActivityPreview } from '../activity-preview';

export const metadata: Metadata = {
  title: 'Verified game activity — DailyDraft Devnet',
  description:
    'Inspect bounded, settled DailyDraft game outcomes with canonical public receipts and RGS proofs.',
  robots: { follow: false, index: false, nocache: true },
};

export default function ActivityPage() {
  return <ActivityPreview />;
}
