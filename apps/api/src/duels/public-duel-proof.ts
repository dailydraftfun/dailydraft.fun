import type { Duel, DuelStatus, DuelTransactionRecord, Money } from '../domain.js';
import { compareInsuredValues } from '../providers/provider-result.js';
import {
  CANONICAL_VALUATION_POLICY,
  requireCanonicalValuationPolicyHash,
} from '../providers/valuation-policy.js';

export type PublicDuelStatus = DuelStatus | 'expired';

export interface PublicDuelReceipt {
  actions: {
    primary: { href: string; label: string };
    rematch: { href: string; label: string } | null;
    share: { href: string; label: string };
  };
  availability: {
    complete: boolean;
    missing: string[];
  };
  custody: {
    cardAssets: {
      detail: string;
      status: 'not-recorded' | 'provider-results-recorded' | 'settlement-reference-recorded';
    };
    platformFee: {
      asset: 'WSOL';
      escrowAddress: string | null;
      status: 'not-started' | 'partially-funded' | 'funded';
    };
  };
  duel: {
    createdAt: string;
    expiresAt: string;
    id: string;
    mode: Duel['matchmakingMode'];
    network: 'solana-devnet';
    observedAt: string;
    status: PublicDuelStatus;
  };
  fees: {
    asset: 'WSOL';
    finalizedSides: number;
    perSideAmountLamports: string | null;
    requiredSides: 2;
    totalFinalizedAmountLamports: string | null;
  };
  pack: {
    id: string;
    name: string;
    provider: string;
    providerMode: Duel['providerMode'];
    providerPackId: string | null;
    tier: Money;
  };
  participants: {
    creator: PublicParticipant;
    opponent: PublicParticipant | null;
  };
  privacy: {
    indexable: false;
    reason: string;
  };
  references: {
    provider: PublicProviderReference[];
    solana: PublicSolanaReference[];
  };
  recovery: {
    alerts: PublicRecoveryAlert[];
    status: 'attention-required' | 'none' | 'recovered';
  };
  result: PublicDuelResult | null;
  schemaVersion: 'openpacksduel.receipt.v1';
}

export interface PublicParticipant {
  address: string;
  display: string;
  role: 'creator' | 'house' | 'opponent';
}

export interface PublicProviderReference {
  assetReference: string;
  provider: string;
  providerReference: string;
  side: 'creator' | 'opponent';
}

export interface PublicSolanaReference {
  action: DuelTransactionRecord['action'];
  bindingSource: 'api-submission' | 'rpc-recovery';
  explorerUrl: string;
  finalizedAt: string | null;
  recoveredAt: string | null;
  signature: string;
  status: DuelTransactionRecord['status'];
}

export interface PublicRecoveryAlert {
  action: 'fund';
  code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH';
  detectedAt: string;
  explorerUrl: string;
  signature: string;
}

export interface PublicDuelResult {
  comparisonMetric: 'insured-value';
  margin: Money;
  outcomes: Array<{
    assetReference: string;
    displayName: string;
    insuredValue: Money;
    isMock: boolean;
    openedAt: string;
    poolVersion: string;
    resultHash: string;
    side: 'creator' | 'opponent';
    sourceTimestamp: string;
  }>;
  policy: {
    authoritativeField: typeof CANONICAL_VALUATION_POLICY.authoritativeField;
    currency: 'USDC';
    decimals: 6;
    hash: string;
    hashAlgorithm: 'sha256';
    maxSourceAgeSeconds: number;
    maxValueMinorUnits: typeof CANONICAL_VALUATION_POLICY.maxValueMinorUnits;
    policyVersion: typeof CANONICAL_VALUATION_POLICY.policyVersion;
    rounding: 'none';
    tieRule: typeof CANONICAL_VALUATION_POLICY.tieRule;
  };
  proof: {
    context: {
      creatorWallet: string;
      duelId: string;
      escrowAddress: string;
      network: 'solana-devnet';
      opponentWallet: string;
      providerMode: Duel['providerMode'];
    };
    creatorResultHash: string;
    opponentResultHash: string;
    poolVersion: string;
    providerAttestation: {
      required: boolean;
      status: 'mock-not-applicable' | 'not-recorded';
    };
    schemaVersion: 'openpacksduel.result-proof.v1';
  };
  resultHash: string;
  settlementReady: boolean;
  totalValue: Money;
  valuationPolicyHash: string;
  winner: PublicParticipant | null;
  winnerSide: 'creator' | 'opponent' | null;
}

export interface PublicWalletProfile {
  biggestWin: {
    duelId: string;
    prizeValue: Money;
  } | null;
  duels: PublicProfileDuel[];
  pagination: {
    hasMore: boolean;
    sampleLimit: number;
  };
  privacy: {
    indexable: false;
    reason: string;
  };
  record: {
    active: number;
    cancelledOrExpired: number;
    completed: number;
    losses: number;
    refunded: number;
    total: number;
    wins: number;
  };
  schemaVersion: 'openpacksduel.profile.v1';
  wallet: {
    address: string;
    display: string;
  };
}

export interface PublicProfileDuel {
  createdAt: string;
  duelId: string;
  opponentDisplay: string | null;
  packName: string;
  receiptHref: string;
  rematchHref: string | null;
  result: 'loss' | 'none' | 'win';
  status: PublicDuelStatus;
  tier: Money;
}

const TERMINAL_STATUSES = new Set<PublicDuelStatus>([
  'cancelled',
  'expired',
  'failed',
  'refunded',
  'settled',
]);

export function buildPublicDuelReceipt(
  duel: Duel,
  transactions: DuelTransactionRecord[],
): PublicDuelReceipt {
  const status = publicStatus(duel);
  const creator = participant(duel.creatorWallet, 'creator');
  const opponent = duel.opponentWallet
    ? participant(duel.opponentWallet, duel.houseOpponent ? 'house' : 'opponent')
    : null;
  const result = buildResult(duel, creator, opponent);
  const publicTransactions = transactions.filter(
    (transaction): transaction is DuelTransactionRecord & { signature: string } =>
      Boolean(transaction.signature),
  );
  const solana = publicTransactions.map((transaction) => ({
    action: transaction.action,
    bindingSource: transaction.recoveredAt
      ? ('rpc-recovery' as const)
      : ('api-submission' as const),
    explorerUrl: `https://explorer.solana.com/tx/${encodeURIComponent(transaction.signature)}?cluster=devnet`,
    finalizedAt: transaction.finalizedAt ?? null,
    recoveredAt: transaction.recoveredAt ?? null,
    signature: transaction.signature,
    status: transaction.status,
  }));
  const recoveryAlerts = transactions.flatMap((transaction): PublicRecoveryAlert[] => {
    if (
      transaction.action !== 'fund' ||
      transaction.recoveryAlertCode !== 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH' ||
      !transaction.recoveryCandidateAt ||
      !transaction.recoveryCandidateSignature ||
      transaction.recoveredAt
    ) {
      return [];
    }
    return [
      {
        action: 'fund',
        code: transaction.recoveryAlertCode,
        detectedAt: transaction.recoveryCandidateAt,
        explorerUrl: `https://explorer.solana.com/tx/${encodeURIComponent(transaction.recoveryCandidateSignature)}?cluster=devnet`,
        signature: transaction.recoveryCandidateSignature,
      },
    ];
  });
  const funding = transactions.filter(
    (transaction) => transaction.action === 'fund' && transaction.status === 'finalized',
  );
  const fundingSides = new Set(funding.map((transaction) => transaction.wallet)).size;
  const feeAmounts = new Set(
    funding.flatMap((transaction) =>
      transaction.feeAmountLamports ? [transaction.feeAmountLamports] : [],
    ),
  );
  const perSideAmountLamports = feeAmounts.size === 1 ? ([...feeAmounts][0] ?? null) : null;
  const mockOutcome =
    duel.providerMode === 'mock' ||
    Boolean(duel.result?.outcomes.some((outcome) => outcome.isMock));
  const settlementReference =
    !mockOutcome &&
    solana.some((reference) => reference.action === 'settle' && reference.status === 'finalized');
  const provider =
    duel.result?.outcomes.map((outcome) => ({
      assetReference: outcome.assetReference,
      provider: outcome.provider,
      providerReference: outcome.providerReference,
      side: outcome.side,
    })) ?? [];
  const missing = receiptMissingFields({
    duel,
    feeAmounts,
    fundingSides,
    settlementReference,
  });

  return {
    actions: receiptActions(duel.id, status),
    availability: { complete: missing.length === 0, missing },
    custody: {
      cardAssets: {
        detail: settlementReference
          ? 'A Solana settlement reference is recorded. Inspect it independently before relying on custody.'
          : result
            ? 'Provider results are recorded, but no public Solana card-settlement reference exists yet.'
            : 'No provider card result or public card-custody reference is recorded.',
        status: settlementReference
          ? 'settlement-reference-recorded'
          : result
            ? 'provider-results-recorded'
            : 'not-recorded',
      },
      platformFee: {
        asset: 'WSOL',
        escrowAddress: duel.escrowAddress ?? null,
        status:
          fundingSides >= 2 ? 'funded' : fundingSides === 1 ? 'partially-funded' : 'not-started',
      },
    },
    duel: {
      createdAt: duel.createdAt,
      expiresAt: duel.expiresAt,
      id: duel.id,
      mode: duel.matchmakingMode,
      network: duel.environment,
      observedAt: duel.updatedAt ?? duel.createdAt,
      status,
    },
    fees: {
      asset: 'WSOL',
      finalizedSides: fundingSides,
      perSideAmountLamports,
      requiredSides: 2,
      totalFinalizedAmountLamports:
        perSideAmountLamports === null
          ? null
          : (BigInt(perSideAmountLamports) * BigInt(fundingSides)).toString(),
    },
    pack: {
      id: duel.pack.id,
      name: duel.pack.name,
      provider: duel.pack.provider,
      providerMode: duel.providerMode,
      providerPackId: duel.pack.providerPackId ?? null,
      tier: duel.stake,
    },
    participants: { creator, opponent },
    privacy: {
      indexable: false,
      reason: 'No explicit player publication consent is stored for this duel.',
    },
    references: { provider, solana },
    recovery: {
      alerts: recoveryAlerts,
      status:
        recoveryAlerts.length > 0
          ? 'attention-required'
          : transactions.some((transaction) => transaction.recoveredAt)
            ? 'recovered'
            : 'none',
    },
    result,
    schemaVersion: 'openpacksduel.receipt.v1',
  };
}

export function buildPublicWalletProfile(
  wallet: string,
  duels: Duel[],
  hasMore: boolean,
  sampleLimit: number,
): PublicWalletProfile {
  let wins = 0;
  let losses = 0;
  let completed = 0;
  let refunded = 0;
  let cancelledOrExpired = 0;
  let active = 0;
  let biggestWin: PublicWalletProfile['biggestWin'] = null;

  const summaries = duels.map((duel) => {
    const status = publicStatus(duel);
    const won = duel.status === 'settled' && duel.winnerWallet === wallet;
    const lost = duel.status === 'settled' && Boolean(duel.winnerWallet) && !won;
    if (duel.status === 'settled') completed += 1;
    if (won) wins += 1;
    if (lost) losses += 1;
    if (duel.status === 'refunded') refunded += 1;
    if (status === 'cancelled' || status === 'expired') cancelledOrExpired += 1;
    if (!TERMINAL_STATUSES.has(status)) active += 1;
    if (won && duel.result) {
      const prizeValue = sumMoney(duel.result.outcomes.map((outcome) => outcome.insuredValue));
      if (!biggestWin || BigInt(prizeValue.amount) > BigInt(biggestWin.prizeValue.amount)) {
        biggestWin = { duelId: duel.id, prizeValue };
      }
    }
    const opponentAddress =
      duel.creatorWallet === wallet ? duel.opponentWallet : duel.creatorWallet;
    return {
      createdAt: duel.createdAt,
      duelId: duel.id,
      opponentDisplay: opponentAddress ? pseudonymizeWallet(opponentAddress) : null,
      packName: duel.pack.name,
      receiptHref: `/duel/${encodeURIComponent(duel.id)}`,
      rematchHref:
        duel.status === 'settled' ? `/overview?rematch=${encodeURIComponent(duel.id)}` : null,
      result: won ? ('win' as const) : lost ? ('loss' as const) : ('none' as const),
      status,
      tier: duel.stake,
    };
  });

  return {
    biggestWin,
    duels: summaries,
    pagination: { hasMore, sampleLimit },
    privacy: {
      indexable: false,
      reason: 'Wallet-linked activity pages are excluded from search indexing by default.',
    },
    record: {
      active,
      cancelledOrExpired,
      completed,
      losses,
      refunded,
      total: duels.length,
      wins,
    },
    schemaVersion: 'openpacksduel.profile.v1',
    wallet: { address: wallet, display: pseudonymizeWallet(wallet) },
  };
}

export function pseudonymizeWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}

function participant(address: string, role: PublicParticipant['role']): PublicParticipant {
  return { address, display: pseudonymizeWallet(address), role };
}

function publicStatus(duel: Duel): PublicDuelStatus {
  return duel.status === 'cancelled' && duel.cancellationReason === 'timeout'
    ? 'expired'
    : duel.status;
}

function buildResult(
  duel: Duel,
  creator: PublicParticipant,
  opponent: PublicParticipant | null,
): PublicDuelResult | null {
  if (!duel.result) return null;
  const policyHash = requireCanonicalValuationPolicyHash(duel.result.valuationPolicyHash);
  if (duel.pack.valuationPolicyHash !== policyHash) {
    throw new Error('Duel result policy does not match the pre-funding policy commitment');
  }
  const creatorOutcome = duel.result.outcomes.find((outcome) => outcome.side === 'creator');
  const opponentOutcome = duel.result.outcomes.find((outcome) => outcome.side === 'opponent');
  if (!creatorOutcome || !opponentOutcome || duel.result.outcomes.length !== 2) {
    throw new Error('Duel result must contain one immutable outcome per side');
  }
  if (!duel.opponentWallet || !duel.escrowAddress || !opponent) {
    throw new Error('Duel result proof lacks committed participants or escrow');
  }
  const context = {
    creatorWallet: duel.creatorWallet,
    duelId: duel.id,
    escrowAddress: duel.escrowAddress,
    network: duel.environment,
    opponentWallet: duel.opponentWallet,
    providerMode: duel.providerMode,
    valuationPolicyHash: policyHash,
  };
  const comparison = compareInsuredValues(
    { ...creatorOutcome, valuationPolicyHash: policyHash },
    { ...opponentOutcome, valuationPolicyHash: policyHash },
    context,
  );
  if (
    comparison.resultHash !== duel.result.resultHash ||
    comparison.winnerSide !== duel.result.winnerSide ||
    comparison.tieRule !== duel.result.tieRule ||
    !duel.result.settlementReady
  ) {
    throw new Error('Duel result proof does not reproduce the recorded winner');
  }
  const left = creatorOutcome.insuredValue;
  const right = opponentOutcome.insuredValue;
  const values = [left, right];
  const marginAmount = (BigInt(left.amount) - BigInt(right.amount)).toString().replace('-', '');
  const winner =
    duel.result.winnerSide === 'creator'
      ? creator
      : duel.result.winnerSide === 'opponent'
        ? opponent
        : null;
  return {
    comparisonMetric: duel.result.comparisonMetric,
    margin: { amount: marginAmount, currency: left.currency, decimals: left.decimals },
    outcomes: duel.result.outcomes.map((outcome) => ({
      assetReference: outcome.assetReference,
      displayName: outcome.displayName,
      insuredValue: outcome.insuredValue,
      isMock: outcome.isMock,
      openedAt: outcome.openedAt,
      poolVersion: outcome.poolVersion,
      resultHash: outcome.resultHash,
      side: outcome.side,
      sourceTimestamp: outcome.sourceTimestamp,
    })),
    policy: {
      authoritativeField: CANONICAL_VALUATION_POLICY.authoritativeField,
      currency: CANONICAL_VALUATION_POLICY.currency,
      decimals: CANONICAL_VALUATION_POLICY.decimals,
      hash: policyHash,
      hashAlgorithm: 'sha256',
      maxSourceAgeSeconds: CANONICAL_VALUATION_POLICY.maxSourceAgeSeconds,
      maxValueMinorUnits: CANONICAL_VALUATION_POLICY.maxValueMinorUnits,
      policyVersion: CANONICAL_VALUATION_POLICY.policyVersion,
      rounding: CANONICAL_VALUATION_POLICY.rounding,
      tieRule: CANONICAL_VALUATION_POLICY.tieRule,
    },
    proof: {
      context: {
        creatorWallet: context.creatorWallet,
        duelId: context.duelId,
        escrowAddress: context.escrowAddress,
        network: context.network,
        opponentWallet: context.opponentWallet,
        providerMode: context.providerMode,
      },
      creatorResultHash: creatorOutcome.resultHash,
      opponentResultHash: opponentOutcome.resultHash,
      poolVersion: comparison.poolVersion,
      providerAttestation: {
        required: duel.providerMode !== 'mock',
        status: duel.providerMode === 'mock' ? 'mock-not-applicable' : 'not-recorded',
      },
      schemaVersion: 'openpacksduel.result-proof.v1',
    },
    resultHash: duel.result.resultHash,
    settlementReady: duel.result.settlementReady,
    totalValue: sumMoney(values),
    valuationPolicyHash: duel.result.valuationPolicyHash,
    winner,
    winnerSide: duel.result.winnerSide,
  };
}

function sumMoney(values: Money[]): Money {
  const first = values[0] ?? { amount: '0', currency: 'USDC' as const, decimals: 6 as const };
  if (
    values.some((value) => value.currency !== first.currency || value.decimals !== first.decimals)
  ) {
    throw new Error('Cannot aggregate values with different currencies or decimals');
  }
  return {
    amount: values.reduce((total, value) => total + BigInt(value.amount), 0n).toString(),
    currency: first.currency,
    decimals: first.decimals,
  };
}

function receiptMissingFields(input: {
  duel: Duel;
  feeAmounts: Set<string>;
  fundingSides: number;
  settlementReference: boolean;
}): string[] {
  const missing: string[] = [];
  if (!input.duel.opponentWallet) missing.push('opponent_wallet');
  if (!input.duel.escrowAddress) missing.push('fee_escrow_address');
  if (input.fundingSides < 2) missing.push('two_finalized_fee_deposits');
  if (input.feeAmounts.size !== 1) missing.push('single_persisted_fee_amount');
  if (input.duel.status === 'settled') {
    if (!input.duel.result) missing.push('provider_results');
    if (!input.duel.result?.valuationPolicyHash) missing.push('valuation_policy_hash');
    if (
      input.duel.providerMode !== 'mock' &&
      input.duel.result?.outcomes.some((outcome) => !outcome.isMock)
    ) {
      missing.push('provider_result_attestation');
    }
    if (!input.settlementReference) missing.push('card_settlement_reference');
  }
  return missing;
}

function receiptActions(duelId: string, status: PublicDuelStatus): PublicDuelReceipt['actions'] {
  const encoded = encodeURIComponent(duelId);
  const share = { href: `/duel/${encoded}`, label: 'Share proof' };
  if (status === 'waiting') {
    return {
      primary: { href: `/overview?challenge=${encoded}`, label: 'Accept challenge' },
      rematch: null,
      share,
    };
  }
  if (status === 'settled') {
    const rematch = { href: `/overview?rematch=${encoded}`, label: 'Run a rematch' };
    return { primary: rematch, rematch, share };
  }
  if (!TERMINAL_STATUSES.has(status)) {
    return { primary: { href: `/duel/${encoded}`, label: 'Spectate duel' }, rematch: null, share };
  }
  return { primary: { href: '/overview', label: 'Open a new duel' }, rematch: null, share };
}
