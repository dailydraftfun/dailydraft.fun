import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  getOperatorTreasurySummary,
  operatorDashboardAuthorized,
} from './operator-treasury-client';
import { TreasuryDashboard } from './treasury-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  description: 'Read-only canonical House treasury and reconciliation evidence.',
  robots: { follow: false, index: false, nocache: true },
  title: 'House treasury operations — DailyDraft',
};

export default async function OperatorTreasuryPage() {
  const requestHeaders = await headers();
  if (!operatorDashboardAuthorized(requestHeaders.get('authorization'))) notFound();
  return <TreasuryDashboard summary={await getOperatorTreasurySummary()} />;
}
