import { redirect } from 'next/navigation';
import { buildRedirectTarget, type RouteSearchParams } from './redirect-target';

type OverviewPageProps = {
  searchParams: Promise<RouteSearchParams>;
};

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  redirect(buildRedirectTarget('/games/duel', await searchParams));
}
