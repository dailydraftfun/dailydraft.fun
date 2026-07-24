import { createHash, timingSafeEqual } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';

import type {
  OpenedProviderPackSnapshot,
  ProviderCardResult,
  ProviderResponseEvidence,
} from './pack-provider.js';
import { PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION } from './pack-provider.js';
import { stableStringify } from './valuation-policy.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_RAW_PAYLOAD_BYTES = 32 * 1024;

interface EvidenceSnapshot {
  openedAt: string;
  providerReference: string;
  result: ProviderCardResult;
}

export function rawProviderResponsePayload(snapshot: EvidenceSnapshot): string {
  return stableStringify({
    openedAt: snapshot.openedAt,
    providerReference: snapshot.providerReference,
    result: snapshot.result,
    status: 'opened',
  });
}

export function createProviderResponseEvidence(input: {
  rawPayload: string;
  signature: string;
  signatureAlgorithm: string;
  signingKeyReference: string;
}): ProviderResponseEvidence {
  return {
    payloadHash: sha256(input.rawPayload),
    rawPayload: input.rawPayload,
    schemaVersion: PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION,
    signature: input.signature,
    signatureAlgorithm: input.signatureAlgorithm,
    signingKeyReference: input.signingKeyReference,
  };
}

export function assertProviderResponseEvidence(
  snapshot: OpenedProviderPackSnapshot,
  expectedSignature: string,
): void {
  const { evidence } = snapshot;
  if (evidence.schemaVersion !== PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION) {
    throw new BadGatewayException('Provider response evidence schema is unsupported');
  }
  if (
    Buffer.byteLength(evidence.rawPayload, 'utf8') > MAX_RAW_PAYLOAD_BYTES ||
    evidence.rawPayload !== rawProviderResponsePayload(snapshot)
  ) {
    throw new BadGatewayException('Provider response evidence does not match the opened pack');
  }
  if (
    !SHA256_PATTERN.test(evidence.payloadHash) ||
    evidence.payloadHash !== sha256(evidence.rawPayload)
  ) {
    throw new BadGatewayException('Provider response evidence payload hash is invalid');
  }
  if (
    !EVIDENCE_VALUE_PATTERN.test(evidence.signatureAlgorithm) ||
    !EVIDENCE_VALUE_PATTERN.test(evidence.signingKeyReference) ||
    !SHA256_PATTERN.test(evidence.signature) ||
    !SHA256_PATTERN.test(expectedSignature)
  ) {
    throw new BadGatewayException('Provider response evidence signature is invalid');
  }
  if (
    !timingSafeEqual(Buffer.from(evidence.signature, 'hex'), Buffer.from(expectedSignature, 'hex'))
  ) {
    throw new BadGatewayException('Provider response evidence signature is invalid');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
