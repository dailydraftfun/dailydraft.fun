import { formatUnits } from '../../solana/balance';
import type {
  GachaCapability,
  GachaPaymentIntent,
  GachaRipResult,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import { isGachaRipAvailable } from '../../solana/gacha-client';

/**
 * Stage resolution for the live rip loop, kept out of the component on purpose.
 *
 * The app workspace has no DOM test environment — `renderToStaticMarkup` is the
 * only render idiom, and a hook body never executes under it — so the decisions
 * live in pure functions the tests can reach. Mirrors `getDuelEntryStage`'s flat
 * early-return precedence rather than inventing a second shape.
 */

export type FlipStage =
  | 'blocked'
  | 'confirming'
  | 'connect'
  | 'delivery-failed'
  | 'funding-review'
  | 'funding-signature'
  | 'loading'
  | 'preparing'
  | 'recovery'
  | 'revealed'
  | 'review'
  | 'ripping'
  | 'verifying';

export type FlipFundingPhase =
  | 'confirming'
  | 'idle'
  | 'recovering'
  | 'ripping'
  | 'signing'
  | 'verifying';

type FlipStageInput = {
  capability: GachaCapability | null;
  capabilityError: string | null;
  error: string | null;
  fundingPhase: FlipFundingPhase;
  pending: boolean;
  prepared: PreparedGachaPaymentTransaction | null;
  result: GachaRipResult | null;
  walletAddress: string | null;
};

export function getFlipStage(input: FlipStageInput): FlipStage {
  // The capability read gates everything, and it fails shut: a machine whose
  // gates the server closed can never reach a payment step, whatever the
  // build-time mirror in `game-catalog.ts` said.
  if (input.capabilityError) return 'blocked';
  if (!input.capability) return 'loading';
  if (!isGachaRipAvailable(input.capability)) return 'blocked';

  // A terminal rip outranks every in-flight phase. Provider failure is not a
  // reveal: the payment was consumed but no card was delivered.
  if (input.result?.rip.status === 'FAILED') return 'delivery-failed';
  if (input.result) return 'revealed';

  if (input.fundingPhase === 'signing') return 'funding-signature';
  if (input.fundingPhase === 'confirming') return 'confirming';
  if (input.fundingPhase === 'verifying') return 'verifying';
  if (input.fundingPhase === 'ripping') return 'ripping';
  if (input.fundingPhase === 'recovering') return 'recovery';

  if (!input.walletAddress) return 'connect';
  if (input.prepared) return 'funding-review';
  if (input.pending) return 'preparing';
  if (input.error) return 'recovery';
  return 'review';
}

export type FlipStageDescription = { detail: string; label: string };

const STAGE_COPY: Record<FlipStage, FlipStageDescription> = {
  blocked: {
    detail: 'The server closed a capability gate, so no rip can be priced right now.',
    label: 'Machine closed',
  },
  confirming: {
    detail: 'Waiting for the network to confirm your deposit before the seed is revealed.',
    label: 'Confirming deposit',
  },
  connect: {
    detail: 'Connect a Wallet Standard wallet on devnet to price a rip.',
    label: 'Connect your wallet',
  },
  'delivery-failed': {
    detail: 'The deposit settled, but the provider did not deliver the selected card.',
    label: 'Delivery failed',
  },
  'funding-review': {
    detail: 'Review the exact deposit your wallet is about to approve.',
    label: 'Review the deposit',
  },
  'funding-signature': {
    detail: 'Approve the transfer in your wallet. Nothing is charged until you sign.',
    label: 'Approve in your wallet',
  },
  loading: { detail: 'Reading the machine capability.', label: 'Checking the machine' },
  preparing: {
    detail: 'Sealing the odds commitment and building your deposit transaction.',
    label: 'Preparing your rip',
  },
  recovery: {
    detail: 'Something interrupted the rip. Your deposit intent is still recoverable.',
    label: 'Recover this rip',
  },
  revealed: {
    detail: 'The server seed is revealed and the pull is final.',
    label: 'Card revealed',
  },
  review: {
    detail: 'Pick a sport and tier, then commit the rip.',
    label: 'Choose your pack',
  },
  ripping: {
    detail: 'The payment is verified. Revealing the committed pull.',
    label: 'Ripping the pack',
  },
  verifying: {
    detail: 'Checking your transfer against the sealed payment intent.',
    label: 'Verifying your deposit',
  },
};

export function describeFlipStage(stage: FlipStage): FlipStageDescription {
  return STAGE_COPY[stage];
}

export type FlipCostSummary = {
  deposit: string;
  networkFee: string;
  packTier: string;
  walletApproval: string;
};

function formatUsdc(minor: string, decimals = 6): string | null {
  try {
    return `${formatUnits(BigInt(minor), decimals)} USDC`;
  } catch {
    return null;
  }
}

/**
 * Plain-money disclosure for the funding step, mirroring `getPlainMoneySummary`.
 *
 * The quoted deposit comes from the server's sealed intent once one exists; the
 * tier price is only ever a preview, so the two are never merged into a single
 * "cost" line that could imply the browser priced the rip.
 */
export function getFlipCostSummary(
  tierPriceMinor: string,
  intent: GachaPaymentIntent | null,
): FlipCostSummary {
  const tier = formatUsdc(tierPriceMinor) ?? 'Quoted by the machine';
  const deposit = intent ? formatUsdc(intent.amountMinor, intent.amountDecimals) : null;

  return {
    deposit: deposit ?? 'Quoted before you sign',
    networkFee: 'Solana network fee only, paid in SOL',
    packTier: tier,
    walletApproval: deposit
      ? `One transfer of ${deposit} to the house treasury`
      : 'One transfer, shown in full before you approve',
  };
}

/**
 * Funding requirement for `checkFundingSufficiency`.
 *
 * The deposit itself is USDC, so the SOL side is zero — the preflight still adds
 * `NETWORK_FEE_BUFFER_LAMPORTS` on top, which is exactly the signature headroom
 * a wallet holding zero SOL would otherwise discover at broadcast time.
 */
export function getFlipFundingRequirement(intent: GachaPaymentIntent): {
  lamports: string;
  token: { amount: bigint; decimals: number; symbol: string } | null;
} {
  let amount: bigint;
  try {
    amount = BigInt(intent.amountMinor);
  } catch {
    return { lamports: '0', token: null };
  }
  return {
    lamports: '0',
    token: { amount, decimals: intent.amountDecimals, symbol: 'USDC' },
  };
}

/**
 * 32 bytes of client entropy as lowercase hex.
 *
 * The server's `seed` validator accepts 16–240 characters, and 64 hex clears it
 * with room to spare. Taking the fill function as an argument keeps the tests
 * deterministic without reaching for `mock.module`, which is process-wide in Bun
 * and would leak across the shared test process.
 */
export function createClientSeed(
  fill: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fill(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
