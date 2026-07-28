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
    detail: 'This sealed pool is temporarily unavailable. No payment can be started.',
    label: 'Pack offline',
  },
  confirming: {
    detail: 'Your payment is on Solana. The pack will open automatically after confirmation.',
    label: 'Locking in your pack',
  },
  connect: {
    detail: 'Connect a devnet wallet to open this sealed sports pack.',
    label: 'Ready when you are',
  },
  'delivery-failed': {
    detail: 'The payment settled, but card delivery needs operator recovery.',
    label: 'Delivery delayed',
  },
  'funding-review': {
    detail: 'One wallet approval opens this exact pack.',
    label: 'Your pack is sealed',
  },
  'funding-signature': {
    detail: 'Approve the displayed USDC amount. Nothing moves until you sign.',
    label: 'Open your wallet',
  },
  loading: { detail: 'Loading the sealed pool and committed odds.', label: 'Warming up' },
  preparing: {
    detail: 'Locking the pool, odds, and price before your wallet opens.',
    label: 'Sealing your pack',
  },
  recovery: {
    detail: 'Your previous pack is protected while DailyDraft resumes the exact saved attempt.',
    label: 'Pack protected',
  },
  revealed: {
    detail: 'The committed pack is open and the pull is final.',
    label: 'You pulled',
  },
  review: {
    detail: 'Choose a sport and pack, then rip it.',
    label: 'Pick. Rip. Reveal.',
  },
  ripping: {
    detail: 'Payment verified. The reveal is now determined and opening.',
    label: 'Opening your pack',
  },
  verifying: {
    detail: 'Matching the confirmed payment to your sealed pack.',
    label: 'Almost there',
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
