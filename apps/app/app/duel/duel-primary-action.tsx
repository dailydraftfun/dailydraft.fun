import Link from 'next/link';
import type { DuelAction } from './social-card-data';

export function DuelPrimaryAction({ action }: { action: DuelAction }) {
  return (
    <Link className="proof-primary-action shrink-0" href={action.href}>
      {action.label}
    </Link>
  );
}
