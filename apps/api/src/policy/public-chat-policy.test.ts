import { describe, expect, test } from 'bun:test';

import {
  evaluatePublicChatPolicy,
  PUBLIC_CHAT_POLICY_SCHEMA_VERSION,
  PUBLIC_CHAT_PROHIBITED_CONTENT,
  PUBLIC_CHAT_REQUIRED_CONTROLS,
} from './public-chat-policy.js';

describe('public chat default-off policy', () => {
  test('ships with no transport, discovery, or submission path', () => {
    expect(evaluatePublicChatPolicy({})).toEqual(
      expect.objectContaining({
        allowed: false,
        denialReason: 'launch_not_approved',
        loggedOutDiscovery: false,
        schemaVersion: PUBLIC_CHAT_POLICY_SCHEMA_VERSION,
        submissionsAccepted: false,
        transportAvailable: false,
      }),
    );
  });

  test('rejects an operator flag instead of silently creating an enable path', () => {
    expect(evaluatePublicChatPolicy({ DAILYDRAFT_PUBLIC_CHAT_ENABLED: 'true' })).toMatchObject({
      allowed: false,
      denialReason: 'operator_enablement_rejected',
      submissionsAccepted: false,
      transportAvailable: false,
    });
  });

  test.each([
    { cooldownActive: true, selfExcluded: false },
    { cooldownActive: false, selfExcluded: true },
    { cooldownActive: true, selfExcluded: true },
  ])('fails closed for responsible-play context %#', (context) => {
    expect(
      evaluatePublicChatPolicy({ DAILYDRAFT_PUBLIC_CHAT_ENABLED: 'true' }, context),
    ).toMatchObject({
      allowed: false,
      denialReason: 'responsible_play_restriction',
    });
  });

  test('pins the required moderation, escalation, retention, and audit contract', () => {
    const decision = evaluatePublicChatPolicy({});

    expect(decision.moderationOwner).toBe('unassigned');
    expect(decision.escalationOwner).toBe('unassigned_human_moderation_queue');
    expect(decision.retentionPolicy).toBe('not_approved');
    expect(decision.auditLogging).toBe('required_before_launch');
    expect(decision.requiredControls).toEqual(PUBLIC_CHAT_REQUIRED_CONTROLS);
    expect(decision.prohibitedContent).toEqual(PUBLIC_CHAT_PROHIBITED_CONTENT);
    expect(decision.requiredControls).toEqual(
      expect.arrayContaining([
        'age_and_terms_gate',
        'block',
        'cooldown_enforcement',
        'human_escalation',
        'mute',
        'rate_limit',
        'report',
        'self_exclusion_enforcement',
      ]),
    );
  });
});
