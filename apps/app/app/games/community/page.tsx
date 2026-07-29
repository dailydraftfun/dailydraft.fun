import {
  ChatCircleSlashIcon,
  ShieldCheckIcon,
  UserFocusIcon,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Community safety — DailyDraft Devnet',
  description:
    'DailyDraft public chat is unavailable while moderation and responsible-play launch controls remain unapproved.',
  robots: { follow: false, index: false, nocache: true },
};

const launchRequirements = [
  'Age and terms gate',
  'Report, block, and mute controls',
  'Cooldown and self-exclusion enforcement',
  'Rate limits and human escalation',
  'Approved retention and audit logging',
] as const;

export default function CommunitySafetyPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-5xl flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid gap-5 border-b border-border pb-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
        <div>
          <p className="proof-label">Community · safety gate</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
            Public chat is unavailable.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-secondary">
            DailyDraft does not expose chat discovery, messages, or submission controls. There is no
            hidden operator switch: the product stays off until a separately reviewed moderation
            operation and responsible-play contract are approved.
          </p>
        </div>
        <div
          aria-label="Public chat launch state"
          className="rounded-xl border border-amber/25 bg-amber/5 p-5"
          data-chat-state="unavailable"
          role="status"
        >
          <div className="flex items-center gap-3 text-amber">
            <ChatCircleSlashIcon aria-hidden="true" size={22} weight="fill" />
            <strong className="text-sm">Default off · no transport</strong>
          </div>
          <p className="mt-3 text-xs leading-5 text-secondary">
            Logged-out discovery and message submission are disabled.
          </p>
        </div>
      </header>

      <section aria-labelledby="chat-launch-contract" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center gap-3 text-primary">
            <ShieldCheckIcon aria-hidden="true" size={22} weight="fill" />
            <h2 className="text-lg font-semibold" id="chat-launch-contract">
              Required before launch
            </h2>
          </div>
          <ul className="mt-4 grid gap-2 text-sm leading-6 text-secondary">
            {launchRequirements.map((requirement) => (
              <li className="flex gap-2" key={requirement}>
                <span aria-hidden="true" className="text-lime">
                  •
                </span>
                {requirement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-lime/20 bg-lime/5 p-5">
          <div className="flex items-center gap-3 text-lime">
            <UserFocusIcon aria-hidden="true" size={22} weight="fill" />
            <h2 className="text-lg font-semibold">Proof without unsafe social pressure</h2>
          </div>
          <p className="mt-4 text-sm leading-6 text-secondary">
            Settled, pseudonymous receipts provide bounded proof of completed play without fake
            player counts, unsolicited wallet contact, or unmoderated messages.
          </p>
          <Link className="proof-secondary-action mt-5" href="/games/activity">
            View verified activity
          </Link>
        </div>
      </section>

      <Link className="proof-primary-action w-fit" href="/games">
        Back to games
      </Link>
    </main>
  );
}
