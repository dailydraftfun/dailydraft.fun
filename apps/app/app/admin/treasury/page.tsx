import type { Metadata } from 'next';
import { headers } from 'next/headers';
import {
  getOperatorTreasurySummary,
  operatorDashboardAuthorized,
} from './operator-treasury-client';
import { TreasuryDashboard } from './treasury-dashboard';

const navigation = require('next/navigation') as typeof import('next/navigation');

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  description: 'Read-only canonical House treasury and reconciliation evidence.',
  robots: { follow: false, index: false, nocache: true },
  title: 'House treasury operations — DailyDraft',
};

export default async function OperatorTreasuryPage() {
  const requestHeaders = await headers();
  if (!operatorDashboardAuthorized(requestHeaders.get('authorization'))) navigation.notFound();
  return <TreasuryDashboard summary={await getOperatorTreasurySummary()} />;
}
