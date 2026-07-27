import { redirect } from 'next/navigation';
import { buildRedirectTarget, type RouteSearchParams } from '../../overview/redirect-target';

type LegacyFlipPageProps = {
  searchParams: Promise<RouteSearchParams>;
};

export default async function LegacyFlipPage({ searchParams }: LegacyFlipPageProps) {
  redirect(buildRedirectTarget('/games/gacha', await searchParams));
}
