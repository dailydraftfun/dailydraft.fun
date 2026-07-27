import { beforeAll, describe, expect, test } from 'bun:test';
import { DuelSide as DatabaseDuelSide } from '@dailydraft/db';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { rarityForSerializedValue } from '../common/pull-rarity.js';
import type { Duel, DuelTransactionRecord } from '../domain.js';
import { toDuelResult } from '../duels/prisma-duel.repository.js';
import { buildPublicDuelReceipt } from '../duels/public-duel-proof.js';
import type { ProviderCardResult } from '../providers/pack-provider.js';
import { compareInsuredValues, normalizeProviderResult } from '../providers/provider-result.js';
import {
  CANONICAL_VALUATION_POLICY,
  CANONICAL_VALUATION_POLICY_HASH,
} from '../providers/valuation-policy.js';

type OpenApiSchemaDocument = {
  components?: { schemas?: Record<string, unknown> };
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
};

const OPENAPI_PATH = new URL('../../../docs/public/openapi.yaml', import.meta.url);
const PRISMA_SCHEMA_PATH = new URL('../../../../packages/db/prisma/schema.prisma', import.meta.url);
const SCHEMA_ROOT_ID = 'https://dailydraft.fun/openapi.yaml';
const GACHA_RIP_INTERNAL_SCALAR_FIELDS = new Set([
  'lifecycleLeaseExpiresAt',
  'lifecycleLeaseOwner',
  'recipientWallet',
]);

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const ESCROW = '7YttLkHDoNj9wyDur5rWnFwyCRLQ8vWUvqGL9cM23Zgy';
const DUEL_ID = 'duel_receipt00001';

/**
 * Payloads the route handlers hand to the JSON serializer, captured once so the same
 * value backs both the conformance pass and the additive-drift negative controls.
 */
type ResponsePayloadCase = {
  payload: unknown;
  schema: string;
  source: string;
};

describe('API response schema gate', () => {
  let openApi: OpenApiSchemaDocument;
  let cases: ResponsePayloadCase[];
  let validators: Map<string, ValidateFunction>;

  beforeAll(async () => {
    openApi = Bun.YAML.parse(await Bun.file(OPENAPI_PATH).text()) as OpenApiSchemaDocument;

    // Only the component section is registered: `paths` carries OpenAPI-only constructs
    // (`required: true` on parameters) that are not valid JSON Schema keywords.
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: false });
    addFormats(ajv);
    ajv.addSchema({ $id: SCHEMA_ROOT_ID, components: openApi.components });

    validators = new Map();
    cases = buildResponsePayloadCases();
    for (const responseCase of cases) {
      if (validators.has(responseCase.schema)) continue;
      validators.set(
        responseCase.schema,
        ajv.compile({ $ref: `${SCHEMA_ROOT_ID}#/components/schemas/${responseCase.schema}` }),
      );
    }
  });

  test('covers every schema this gate claims to guard', () => {
    expect(cases.map((responseCase) => responseCase.schema).sort()).toEqual([
      'DuelPackOutcome',
      'DuelResult',
      'GachaRip',
      'PublicDuelResult',
      'PublicPostDuelCardActionState',
    ]);
  });

  test('guards schemas that are actually reachable from a documented response body', () => {
    const reachable = reachableResponseSchemas(openApi);
    for (const responseCase of cases) {
      expect(reachable).toContain(responseCase.schema);
    }
  });

  test('accepts every serialized response payload', () => {
    for (const responseCase of cases) {
      const validate = requireValidator(validators, responseCase.schema);
      const payload = serialize(responseCase.payload);
      expect({
        errors: validate(payload) ? [] : formatErrors(validate),
        source: responseCase.source,
      }).toEqual({ errors: [], source: responseCase.source });
    }
  });

  test('rejects an additive field on every guarded payload', () => {
    // Regression guard for the PR #223 review finding: a `rarity` field was added to four
    // payloads whose schemas declare `additionalProperties: false` and CI stayed green.
    for (const responseCase of cases) {
      const validate = requireValidator(validators, responseCase.schema);
      const drifted = { ...(serialize(responseCase.payload) as object), rarity: 'holo-rare' };
      expect({
        source: responseCase.source,
        valid: validate(drifted),
      }).toEqual({ source: responseCase.source, valid: false });
    }
  });

  test('binds the GachaRip fixture to every public persisted column and its derived rarity', async () => {
    // The service explicitly projects every public Prisma scalar plus one
    // value-derived rarity. Recovery-only fields must never reach the wire.
    const fixture = cases.find((responseCase) => responseCase.schema === 'GachaRip');
    const fields = Object.keys(fixture?.payload as object);
    expect(fields.filter((field) => field !== 'rarity').sort()).toEqual(
      prismaScalarFields(await Bun.file(PRISMA_SCHEMA_PATH).text(), 'GachaRip').filter(
        (field) => !GACHA_RIP_INTERNAL_SCALAR_FIELDS.has(field),
      ),
    );
    expect(fields).toContain('rarity');
  });
});

function requireValidator(
  validators: Map<string, ValidateFunction>,
  schema: string,
): ValidateFunction {
  const validate = validators.get(schema);
  if (!validate) throw new Error(`Missing compiled validator for ${schema}`);
  return validate;
}

function formatErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
  );
}

/** Round-trips through JSON so `Date` values become the ISO strings clients receive. */
function serialize(payload: unknown): unknown {
  return JSON.parse(JSON.stringify(payload));
}

function buildResponsePayloadCases(): ResponsePayloadCase[] {
  const duelResult = toDuelResult(persistedDuelRow());
  if (!duelResult) throw new Error('Contract fixture must produce a canonical duel result');

  const receipt = buildPublicDuelReceipt(settledDuel(), [
    ...fundingTransactions(),
    settlementTransaction(),
  ]);
  if (!receipt.result) throw new Error('Contract fixture must produce a public duel result');
  const card = receipt.cardActions.cards[0];
  if (!card) throw new Error('Contract fixture must produce a post-duel card action state');

  return [
    {
      payload: duelResult,
      schema: 'DuelResult',
      source: 'toDuelResult(row)',
    },
    {
      payload: duelResult.outcomes[0],
      schema: 'DuelPackOutcome',
      source: 'toDuelResult(row).outcomes[0]',
    },
    {
      payload: receipt.result,
      schema: 'PublicDuelResult',
      source: 'buildPublicDuelReceipt(duel).result',
    },
    {
      payload: card,
      schema: 'PublicPostDuelCardActionState',
      source: 'buildPublicDuelReceipt(duel).cardActions.cards[0]',
    },
    {
      payload: gachaRipPayload(),
      schema: 'GachaRip',
      source: 'GachaRipService.loadRipResult(...).rip',
    },
  ];
}

/** Collects every component schema a documented JSON response body can resolve to. */
function reachableResponseSchemas(document: OpenApiSchemaDocument): string[] {
  const schemas = document.components?.schemas ?? {};
  const reachable = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key !== '$ref' || typeof value !== 'string') {
        walk(value);
        continue;
      }
      const name = value.replace('#/components/schemas/', '');
      if (value === name || reachable.has(name)) continue;
      reachable.add(name);
      walk(schemas[name]);
    }
  };

  for (const operations of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(operations)) walk(operation.responses);
  }
  return [...reachable].sort();
}

/** Field names a Prisma row carries on the wire — relations are objects, never serialized here. */
function prismaScalarFields(schema: string, model: string): string[] {
  const body = schema.match(new RegExp(`^model ${model} \\{$([^}]*)^\\}$`, 'm'))?.[1];
  if (!body) throw new Error(`Prisma model ${model} was not found`);
  const models = new Set([...schema.matchAll(/^model (\w+) \{$/gm)].map((match) => match[1]));

  return body
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([name, type]) => name && type && !name.startsWith('@') && !name.startsWith('//'))
    .filter(([, type]) => !models.has((type as string).replace(/[?[\]]/g, '')))
    .map(([name]) => name as string)
    .sort();
}

function persistedDuelRow() {
  return {
    creatorWallet: CREATOR,
    opponentWallet: OPPONENT,
    packOutcomes: [
      persistedPackOutcome(DatabaseDuelSide.CREATOR, 'creator-card-mint', '100000000'),
      persistedPackOutcome(DatabaseDuelSide.OPPONENT, 'opponent-card-mint', '15000000'),
    ],
    resultHash: 'a'.repeat(64),
    resultReadyAt: new Date('2026-07-15T20:04:00.000Z'),
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    winnerWallet: CREATOR,
  };
}

function persistedPackOutcome(side: DatabaseDuelSide, assetReference: string, amount: string) {
  return {
    assetReference,
    displayName: side === DatabaseDuelSide.CREATOR ? 'Umbreon VMAX' : 'Blastoise',
    imageUrl: 'https://images.example.test/card.png',
    insuredValueAmount: amount,
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    isMock: false,
    openedAt: new Date('2026-07-15T20:04:00.000Z'),
    poolVersion: 'collector-crypt-pool-v1',
    provider: 'collector-crypt',
    providerReference: `${assetReference}-open`,
    resultHash: (side === DatabaseDuelSide.CREATOR ? 'b' : 'c').repeat(64),
    side,
    sourceTimestamp: new Date('2026-07-15T20:03:30.000Z'),
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    valuationSourceReference: 'collector-crypt:card:1:insuredValue:2026-07-15T20:03:00.000Z',
  };
}

function gachaRipRow() {
  return {
    acquiredAt: new Date('2026-07-15T20:06:00.000Z'),
    acquisitionReference: 'collector-crypt:acquisition:1',
    createdAt: new Date('2026-07-15T20:05:00.000Z'),
    failedAssetReference: null,
    failedAt: null,
    failureReason: null,
    id: 'grip_contractfixture01',
    idempotencyKey: 'contract-fixture-rip-0001',
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    insuredValueMinor: '100000000',
    machineKey: 'pokemon_50',
    oddsCommitmentId: 'godds_contractfixture01',
    oddsRulesHash: 'd'.repeat(64),
    revealedAt: new Date('2026-07-15T20:05:30.000Z'),
    seedCommitmentHash: 'e'.repeat(64),
    selectedAssetReference: 'collector-crypt:card:1',
    selectedAt: new Date('2026-07-15T20:05:00.000Z'),
    settledAt: new Date('2026-07-15T20:07:00.000Z'),
    settlementReference: 'collector-crypt:settlement:1',
    snapshotContentHash: 'f'.repeat(64),
    status: 'SETTLED',
    updatedAt: new Date('2026-07-15T20:07:00.000Z'),
  };
}

function gachaRipPayload() {
  const rip = gachaRipRow();
  return {
    ...rip,
    rarity: rarityForSerializedValue(rip.insuredValueMinor, rip.insuredValueDecimals),
  };
}

function settledDuel(): Duel {
  const sourceTimestamp = '2026-07-15T20:03:30.000Z';
  const observedAt = new Date('2026-07-15T20:04:00.000Z');
  const creator = normalizeProviderResult(
    'creator',
    providerResult('creator-card-mint', 'Umbreon VMAX', '100000000', sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    'collector:pack:creator',
    observedAt,
  );
  const opponent = normalizeProviderResult(
    'opponent',
    providerResult('opponent-card-mint', 'Blastoise', '15000000', sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    'collector:pack:opponent',
    observedAt,
  );
  const comparison = compareInsuredValues(creator, opponent, {
    creatorWallet: CREATOR,
    duelId: DUEL_ID,
    escrowAddress: ESCROW,
    network: 'solana-devnet',
    opponentWallet: OPPONENT,
    providerMode: 'collector-crypt-sandbox',
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  });

  return {
    cancellationReason: null,
    createdAt: '2026-07-15T20:00:00.000Z',
    creatorWallet: CREATOR,
    environment: 'solana-devnet',
    escrowAddress: ESCROW,
    expiresAt: '2026-07-15T21:00:00.000Z',
    houseOpponent: false,
    id: DUEL_ID,
    matchmakingMode: 'direct',
    opponentJoinedAt: '2026-07-15T20:01:00.000Z',
    opponentWallet: OPPONENT,
    pack: {
      active: true,
      id: 'pokemon_50',
      name: '$50 Pokémon Pack',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'collector-crypt',
      providerPackId: 'pokemon_50',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    providerMode: 'collector-crypt-sandbox',
    result: {
      comparisonMetric: 'insured-value',
      outcomes: [toDuelOutcome(creator), toDuelOutcome(opponent)],
      resultHash: comparison.resultHash,
      settlementReady: true,
      tieRule: CANONICAL_VALUATION_POLICY.tieRule,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      winnerSide: 'creator',
    },
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status: 'settled',
    updatedAt: '2026-07-15T20:10:00.000Z',
    version: 8,
    winnerWallet: CREATOR,
  };
}

function providerResult(
  assetReference: string,
  displayName: string,
  amount: string,
  sourceTimestamp: string,
): ProviderCardResult {
  return {
    assetReference,
    displayName,
    insuredValue: { amount, currency: 'USDC', decimals: 6 },
    poolVersion: 'collector-crypt-pool-v1',
    sourceTimestamp,
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  };
}

function toDuelOutcome(
  outcome: ReturnType<typeof normalizeProviderResult>,
): NonNullable<Duel['result']>['outcomes'][number] {
  return {
    assetReference: outcome.assetReference,
    displayName: outcome.displayName,
    insuredValue: outcome.insuredValue,
    isMock: false,
    openedAt: outcome.openedAt,
    poolVersion: outcome.poolVersion,
    provider: 'collector-crypt',
    providerReference: outcome.providerReference,
    rarity: rarityForSerializedValue(outcome.insuredValue.amount, outcome.insuredValue.decimals),
    resultHash: outcome.resultHash,
    side: outcome.side,
    sourceTimestamp: outcome.sourceTimestamp,
    ...(outcome.valuationSourceReference
      ? { valuationSourceReference: outcome.valuationSourceReference }
      : {}),
  };
}

function fundingTransactions(): DuelTransactionRecord[] {
  return [CREATOR, OPPONENT].map((wallet, index) => ({
    action: 'fund',
    createdAt: '2026-07-15T20:02:00.000Z',
    duelId: DUEL_ID,
    feeAmountLamports: '1000000',
    finalizedAt: '2026-07-15T20:03:00.000Z',
    id: `tx_fund_${index}`,
    network: 'solana-devnet',
    signature: `${index + 1}`.repeat(88),
    status: 'finalized',
    updatedAt: '2026-07-15T20:03:00.000Z',
    wallet,
  }));
}

function settlementTransaction(): DuelTransactionRecord {
  return {
    action: 'settle',
    createdAt: '2026-07-15T20:04:00.000Z',
    duelId: DUEL_ID,
    finalizedAt: '2026-07-15T20:05:00.000Z',
    id: 'tx_settle_finalized',
    network: 'solana-devnet',
    signature: '3'.repeat(88),
    status: 'finalized',
    updatedAt: '2026-07-15T20:05:00.000Z',
    wallet: CREATOR,
  };
}
