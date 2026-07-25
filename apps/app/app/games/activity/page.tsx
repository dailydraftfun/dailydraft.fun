import type { Metadata } from 'next';
import { ActivityPreview } from '../activity-preview';

export const metadata: Metadata = {
  title: 'Activity receipt lab — DailyDraft Devnet',
  description: 'Preview explicit receipt examples and fixture-backed DailyDraft game activity.',
  robots: { follow: false, index: false, nocache: true },
};

export default function ActivityPage() {
  return <ActivityPreview />;
}
