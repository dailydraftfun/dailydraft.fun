import type { Metadata } from 'next';
import { ActivityPreview } from '../activity-preview';

export const metadata: Metadata = {
  title: 'Activity receipt lab — Pack Duel Devnet',
  description: 'Preview explicit receipt examples and fixture-backed Pack Duel game activity.',
  robots: { follow: false, index: false, nocache: true },
};

export default function ActivityPage() {
  return <ActivityPreview />;
}
