import { createHash } from 'node:crypto';

import { stableStringify } from '../providers/valuation-policy.js';

export const CRASH_SETTLEMENT_POLICY = Symbol('CRASH_SETTLEMENT_POLICY');
export const CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION =
  'dailydraft.crash-settlement-policy.v1' as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_WALLET_PATTERN = /^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POLICY_KEYS = [
  'activation',
  'approvedInventoryCustody',
  'approvedSessionCustody',
  'architectureVersion',
  'bustDisposition',
  'calculatorVersion',
  'cashOutMode',
  'custodyPolicyHash',
  'custodyPolicyVersion',
  'inventoryPolicyHash',
  'inventoryPolicyVersion',
  'network',
  'policyHash',
  'policyVersion',
  'riskRulesHash',
  'riskRulesVersion',
  'rulesHash',
  'rulesVersion',
  'schemaVersion',
  'stateMachineRulesHash',
  'stateMachineVersion',
] as const;

export interface UnsignedCrashSettlementPolicy {
  activation: 'fixture-only';
  approvedInventoryCustody: string;
  approvedSessionCustody: string;
  architectureVersion: string;
  bustDisposition: 'hold' | 'liquidate';
  calculatorVersion: string;
  cashOutMode: 'assets-and-proceeds';
  custodyPolicyHash: string;
  custodyPolicyVersion: string;
  inventoryPolicyHash: string;
  inventoryPolicyVersion: string;
  network: 'solana-devnet';
  policyVersion: string;
  riskRulesHash: string;
  riskRulesVersion: string;
  rulesHash: string;
  rulesVersion: string;
  schemaVersion: typeof CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
}

export interface CrashSettlementPolicy extends UnsignedCrashSettlementPolicy {
  policyHash: string;
}

export function hashCrashSettlementPolicy(policy: UnsignedCrashSettlementPolicy): string {
  return sha256(stableStringify(policy));
}

export function validateCrashSettlementPolicy(value: unknown): CrashSettlementPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Crash settlement policy is absent');
  }
  const keys = Object.keys(value).sort();
  if (stableStringify(keys) !== stableStringify([...POLICY_KEYS].sort())) {
    throw new Error('Crash settlement policy shape is unsupported');
  }
  const policy = value as Partial<CrashSettlementPolicy>;
  if (
    policy.activation !== 'fixture-only' ||
    policy.network !== 'solana-devnet' ||
    policy.schemaVersion !== CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION ||
    policy.cashOutMode !== 'assets-and-proceeds' ||
    (policy.bustDisposition !== 'hold' && policy.bustDisposition !== 'liquidate') ||
    !validIdentifier(policy.policyVersion) ||
    !validIdentifier(policy.custodyPolicyVersion) ||
    !validIdentifier(policy.inventoryPolicyVersion) ||
    !validIdentifier(policy.architectureVersion) ||
    !validIdentifier(policy.stateMachineVersion) ||
    !validIdentifier(policy.calculatorVersion) ||
    !validIdentifier(policy.rulesVersion) ||
    !validIdentifier(policy.riskRulesVersion) ||
    !validHash(policy.policyHash) ||
    !validHash(policy.custodyPolicyHash) ||
    !validHash(policy.inventoryPolicyHash) ||
    !validHash(policy.stateMachineRulesHash) ||
    !validHash(policy.rulesHash) ||
    !validHash(policy.riskRulesHash) ||
    !validFixtureWallet(policy.approvedSessionCustody) ||
    !validFixtureWallet(policy.approvedInventoryCustody) ||
    policy.approvedSessionCustody === policy.approvedInventoryCustody
  ) {
    throw new Error('Crash settlement policy is invalid');
  }
  const unsigned: UnsignedCrashSettlementPolicy = {
    activation: 'fixture-only',
    approvedInventoryCustody: policy.approvedInventoryCustody,
    approvedSessionCustody: policy.approvedSessionCustody,
    architectureVersion: policy.architectureVersion,
    bustDisposition: policy.bustDisposition,
    calculatorVersion: policy.calculatorVersion,
    cashOutMode: 'assets-and-proceeds',
    custodyPolicyHash: policy.custodyPolicyHash,
    custodyPolicyVersion: policy.custodyPolicyVersion,
    inventoryPolicyHash: policy.inventoryPolicyHash,
    inventoryPolicyVersion: policy.inventoryPolicyVersion,
    network: 'solana-devnet',
    policyVersion: policy.policyVersion,
    riskRulesHash: policy.riskRulesHash,
    riskRulesVersion: policy.riskRulesVersion,
    rulesHash: policy.rulesHash,
    rulesVersion: policy.rulesVersion,
    schemaVersion: CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION,
    stateMachineRulesHash: policy.stateMachineRulesHash,
    stateMachineVersion: policy.stateMachineVersion,
  };
  if (hashCrashSettlementPolicy(unsigned) !== policy.policyHash) {
    throw new Error('Crash settlement policy hash does not match its canonical content');
  }
  return Object.freeze({ ...unsigned, policyHash: policy.policyHash });
}

export function loadCrashSettlementPolicy(environment: NodeJS.ProcessEnv = process.env): unknown {
  const serialized = environment.DAILYDRAFT_CRASH_FIXTURE_SETTLEMENT_POLICY_JSON;
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function validFixtureWallet(value: unknown): value is string {
  return typeof value === 'string' && FIXTURE_WALLET_PATTERN.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
