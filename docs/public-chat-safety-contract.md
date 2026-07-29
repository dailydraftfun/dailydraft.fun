# Public chat safety contract

Status: **default off; no transport exists.**

DailyDraft must not expose public chat discovery, message reads, message writes, or an operator-only
enable switch until every launch dependency below has an approved owner and implementation.

## Required launch gates

- Age and terms acceptance is required before discovery or participation.
- Active cooldown and self-exclusion states deny discovery and participation.
- Report, block, and mute controls are available from every message and identity surface.
- Per-account, per-wallet, and per-network rate limits are enforced before message acceptance.
- A staffed human moderation queue owns removals and appeals; ownership cannot be `unassigned`.
- A documented retention and deletion policy covers message content, reports, sanctions, and audit
  evidence. `not_approved` is a hard denial.
- Every moderation action records actor, reason, target, timestamp, and prior/new state without
  retaining wallet signatures, credentials, or transaction payloads.
- Credible threats, self-harm risk, minor-safety risk, doxxing, fraud, payment solicitation, hate,
  illegal goods, spam, and market manipulation have documented escalation and removal procedures.

## Safe fallback

Until those gates pass, the community surface links to bounded verified activity: settled,
pseudonymous receipts whose canonical result and proof agree. It must not show fabricated live
players, urgency, unsolicited wallet contact, or user-supplied messages.

The executable source of truth is `apps/api/src/policy/public-chat-policy.ts`. Its decision is
deliberately always denied; introducing a transport or enable path requires a separately reviewed
contract version.
