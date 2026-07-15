'use client';

import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

export function DuelProofRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [active, router]);

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border-strong bg-secondary px-4 text-sm font-semibold text-primary transition hover:border-lime hover:text-lime"
      disabled={pending}
    >
      <ArrowClockwiseIcon className={pending ? 'animate-spin' : ''} size={16} />
      {pending ? 'Refreshing' : active ? 'Live · refresh' : 'Refresh proof'}
    </button>
  );
}
