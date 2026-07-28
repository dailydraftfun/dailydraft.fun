export const PUBLIC_CHAT_POLICY_SCHEMA_VERSION = 'dailydraft.public-chat-policy.v1' as const;

export const PUBLIC_CHAT_PROHIBITED_CONTENT = [
  'abuse_or_harassment',
  'doxxing_or_personal_information',
  'fraud_or_impersonation',
  'hate_or_extremism',
  'illegal_goods_or_services',
  'minor_safety_risk',
  'payment_or_wallet_solicitation',
  'self_harm_or_credible_threats',
  'spam_or_market_manipulation',
] as const;

export const PUBLIC_CHAT_REQUIRED_CONTROLS = [
  'age_and_terms_gate',
  'block',
  'cooldown_enforcement',
  'human_escalation',
  'mute',
  'rate_limit',
  'report',
  'self_exclusion_enforcement',
] as const;

export type PublicChatDenialReason =
  | 'launch_not_approved'
  | 'operator_enablement_rejected'
  | 'responsible_play_restriction';

export interface PublicChatPolicyContext {
  cooldownActive: boolean;
  selfExcluded: boolean;
}

export interface PublicChatPolicyDecision {
  allowed: false;
  auditLogging: 'required_before_launch';
  denialReason: PublicChatDenialReason;
  escalationOwner: 'unassigned_human_moderation_queue';
  loggedOutDiscovery: false;
  moderationOwner: 'unassigned';
  prohibitedContent: typeof PUBLIC_CHAT_PROHIBITED_CONTENT;
  requiredControls: typeof PUBLIC_CHAT_REQUIRED_CONTROLS;
  retentionPolicy: 'not_approved';
  schemaVersion: typeof PUBLIC_CHAT_POLICY_SCHEMA_VERSION;
  submissionsAccepted: false;
  transportAvailable: false;
}

const DEFAULT_CONTEXT: PublicChatPolicyContext = {
  cooldownActive: false,
  selfExcluded: false,
};

/**
 * Public chat has no enable path until a separately reviewed transport,
 * moderation operation, retention policy, and responsible-play integration exist.
 */
export function evaluatePublicChatPolicy(
  environment: NodeJS.ProcessEnv = process.env,
  context: PublicChatPolicyContext = DEFAULT_CONTEXT,
): PublicChatPolicyDecision {
  const denialReason: PublicChatDenialReason =
    context.cooldownActive || context.selfExcluded
      ? 'responsible_play_restriction'
      : environment.DAILYDRAFT_PUBLIC_CHAT_ENABLED === 'true'
        ? 'operator_enablement_rejected'
        : 'launch_not_approved';

  return {
    allowed: false,
    auditLogging: 'required_before_launch',
    denialReason,
    escalationOwner: 'unassigned_human_moderation_queue',
    loggedOutDiscovery: false,
    moderationOwner: 'unassigned',
    prohibitedContent: PUBLIC_CHAT_PROHIBITED_CONTENT,
    requiredControls: PUBLIC_CHAT_REQUIRED_CONTROLS,
    retentionPolicy: 'not_approved',
    schemaVersion: PUBLIC_CHAT_POLICY_SCHEMA_VERSION,
    submissionsAccepted: false,
    transportAvailable: false,
  };
}
