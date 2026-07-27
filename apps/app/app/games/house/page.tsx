import { redirect } from 'next/navigation';
import { buildRedirectTarget, type RouteSearchParams } from '../../overview/redirect-target';

type LegacyHousePageProps = {
  searchParams: Promise<RouteSearchParams>;
};

export default async function LegacyHousePage({ searchParams }: LegacyHousePageProps) {
  redirect(buildRedirectTarget('/games/duel', await searchParams));
}
