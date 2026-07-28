import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { stableStringify } from '../providers/valuation-policy.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface HouseProviderEvidence {
  hash: string;
  signature: string;
}

export function createHouseProviderEvidence(
  payload: Record<string, unknown>,
  signingKey: string,
): HouseProviderEvidence {
  const canonical = stableStringify(payload);
  return {
    hash: createHash('sha256').update(canonical).digest('hex'),
    signature: createHmac('sha256', signingKey).update(canonical).digest('hex'),
  };
}

export function assertHouseProviderEvidence(
  provider: string,
  payload: Record<string, unknown>,
  evidence: HouseProviderEvidence,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const signingKey = readProviderSigningKeys(environment)[provider];
  if (!signingKey) {
    throw new ServiceUnavailableException(
      `Marketplace evidence verification is not configured for provider ${provider}`,
    );
  }
  const expected = createHouseProviderEvidence(payload, signingKey);
  if (
    !SHA256_PATTERN.test(evidence.hash) ||
    !SHA256_PATTERN.test(evidence.signature) ||
    !timingSafeEqual(Buffer.from(evidence.hash, 'hex'), Buffer.from(expected.hash, 'hex')) ||
    !timingSafeEqual(Buffer.from(evidence.signature, 'hex'), Buffer.from(expected.signature, 'hex'))
  ) {
    throw new UnauthorizedException('Marketplace provider evidence is invalid');
  }
}

export function providerReferenceKey(provider: string, reference: string): string {
  return createHash('sha256').update(stableStringify({ provider, reference })).digest('hex');
}

function readProviderSigningKeys(environment: NodeJS.ProcessEnv): Record<string, string> {
  const raw = environment.DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS?.trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ServiceUnavailableException('Marketplace provider keys are malformed');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceUnavailableException('Marketplace provider keys are malformed');
  }
  const keys: Record<string, string> = {};
  for (const [provider, value] of Object.entries(parsed)) {
    if (
      !/^[A-Za-z0-9._:-]{3,80}$/.test(provider) ||
      typeof value !== 'string' ||
      value.length < 32
    ) {
      throw new ServiceUnavailableException('Marketplace provider keys are malformed');
    }
    keys[provider] = value;
  }
  return keys;
}
