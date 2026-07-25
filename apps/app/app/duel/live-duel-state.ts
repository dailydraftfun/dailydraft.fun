import type { DurableDuel } from '../solana/duel-client';
import { getDuelPlayerStatus } from './duel-player-copy';
import { type PullRarity, pullRarityFor } from './pull-rarity';

export type LiveDuelPhase = 'lobby' | 'matching' | 'opening' | 'result';

export type LivePull = {
  id: string;
  image?: string;
  label: string;
  name: string;
  provider: string;
  rarity: PullRarity;
  side: 'creator' | 'opponent';
  value: string;
  valueMinor: bigint;
};

export type LiveDuelState = {
  headline: string;
  indicator: string;
  left: LivePull | null;
  margin: string | null;
  phase: LiveDuelPhase;
  right: LivePull | null;
  settlementReference: string | null;
  tier: string;
  totalValue: string | null;
  winner: 'opponent' | 'tie' | 'you' | null;
};

export function toLiveDuelState(duel: DurableDuel, wallet?: string | null): LiveDuelState {
  const outcomes = duel.result?.outcomes ?? [];
  const viewerSide = wallet === duel.opponentWallet ? 'opponent' : 'creator';
  const left = toPull(outcomes.find((outcome) => outcome.side === viewerSide) ?? null);
  const rivalSide = viewerSide === 'creator' ? 'opponent' : 'creator';
  const right = toPull(outcomes.find((outcome) => outcome.side === rivalSide) ?? null);
  const hasCommittedResult = Boolean(duel.result && left && right);
  const phase = phaseForStatus(duel.status, hasCommittedResult);
  const winner = winnerForViewer(duel.result?.winnerSide ?? null, viewerSide, hasCommittedResult);
  const values = left && right ? [left.valueMinor, right.valueMinor] : null;

  return {
    headline: headlineForStatus(duel.status, winner, hasCommittedResult),
    indicator: indicatorForStatus(duel.status),
    left,
    margin: values ? formatMinor(abs(values[0] - values[1]), duel.stake.decimals) : null,
    phase,
    right,
    settlementReference: duel.transactionSignature ?? duel.escrowAddress ?? null,
    tier: formatMinor(BigInt(duel.stake.amount), duel.stake.decimals),
    totalValue: values ? formatMinor(values[0] + values[1], duel.stake.decimals) : null,
    winner,
  };
}

function phaseForStatus(status: DurableDuel['status'], hasResult: boolean): LiveDuelPhase {
  if (status === 'opening') return 'opening';
  if (['awaiting_assets', 'settling', 'settled'].includes(status) && hasResult) return 'result';
  if (status === 'funded') return 'matching';
  return 'lobby';
}

function winnerForViewer(
  winnerSide: 'creator' | 'opponent' | null,
  viewerSide: 'creator' | 'opponent',
  hasResult: boolean,
): LiveDuelState['winner'] {
  if (!hasResult) return null;
  if (winnerSide === null) return 'tie';
  return winnerSide === viewerSide ? 'you' : 'opponent';
}

function headlineForStatus(
  status: DurableDuel['status'],
  winner: LiveDuelState['winner'],
  hasResult: boolean,
): string {
  if (status === 'funded') return 'Both packs are funded';
  if (status === 'opening') return 'Ripping packs…';
  if (hasResult && winner === 'you')
    return status === 'settled' ? 'You won both pulls' : 'Your pull leads';
  if (hasResult && winner === 'opponent') {
    return status === 'settled' ? 'Opponent takes the vault' : 'Opponent pull leads';
  }
  if (hasResult && winner === 'tie') return 'The pulls are tied';
  return getDuelPlayerStatus(status).headline;
}

function indicatorForStatus(status: DurableDuel['status']): string {
  const indicators: Record<DurableDuel['status'], string> = {
    awaiting_assets: 'Cards moving',
    cancelled: 'Cancelled',
    cancelling: 'Closing',
    committing: 'Payments pending',
    failed: 'Needs attention',
    funded: 'Both paid',
    matched: 'Opponent found',
    opening: 'Opening packs',
    refunded: 'Payments returned',
    refunding: 'Returning payments',
    settled: 'Complete',
    settling: 'Final transfer',
    waiting: 'Challenge open',
  };
  return indicators[status] ?? indicators.failed;
}

function toPull(
  outcome: NonNullable<DurableDuel['result']>['outcomes'][number] | null,
): LivePull | null {
  if (!outcome) return null;
  const valueMinor = BigInt(outcome.insuredValue.amount);
  return {
    id: outcome.assetReference,
    ...(outcome.imageUrl ? { image: outcome.imageUrl } : {}),
    label: shortReference(outcome.assetReference),
    name: outcome.displayName,
    provider: outcome.provider,
    rarity: pullRarityFor(valueMinor, outcome.insuredValue.decimals),
    side: outcome.side,
    value: formatMinor(valueMinor, outcome.insuredValue.decimals),
    valueMinor,
  };
}

function formatMinor(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fractional = (amount % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `$${whole.toLocaleString('en-US')}${fractional ? `.${fractional}` : ''}`;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function shortReference(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
