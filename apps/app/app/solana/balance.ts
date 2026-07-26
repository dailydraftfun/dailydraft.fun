export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Signature fees are 5000 lamports each and the funding transaction carries the
 * wallet signature plus headroom for a fee-payer re-sign. Reserving three slots
 * keeps a wallet that holds *exactly* the platform fee from being told it can
 * pay, then failing at broadcast with an unhelpful "insufficient funds for rent".
 */
export const NETWORK_FEE_BUFFER_LAMPORTS = 15_000n;

export type BalanceStatus = 'error' | 'idle' | 'loading' | 'ready';

export type TokenBalance = { amount: bigint; decimals: number };

export type WalletBalances = {
  lamports: bigint;
  token: TokenBalance | null;
};

export type FundingRequirement = {
  lamports: bigint;
  token: { amount: bigint; decimals: number; symbol: string } | null;
};

export type FundingShortfall = {
  asset: string;
  available: string;
  required: string;
  shortfall: string;
};

export type FundingSufficiency = {
  shortfalls: FundingShortfall[];
  status: 'insufficient' | 'sufficient';
  summary: string;
};

/**
 * Renders a base-unit integer as a decimal string with trailing zeros trimmed.
 * Mirrors formatPublicMoney in ../duel/public-money.ts — same grouping, same
 * trimming — so a SOL figure and a USDC figure read alike side by side.
 */
export function formatUnits(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`;
}

export function formatSol(lamports: bigint): string {
  return `${formatUnits(lamports, 9)} SOL`;
}

export function formatTokenBalance(balance: TokenBalance, symbol: string): string {
  return `${formatUnits(balance.amount, balance.decimals)} ${symbol}`;
}

/**
 * Turns the provider's balance state into one line of chrome copy. `ready` is
 * reported separately from the label so a compact surface (the header wallet
 * chip) can show the figure alone while a roomier one (the wallet dialog) also
 * explains a pending or failed read.
 */
export function describeWalletBalance(
  status: BalanceStatus,
  balances: WalletBalances | null,
): { label: string; ready: boolean } | null {
  if (status === 'loading') return { label: 'Reading balance…', ready: false };
  if (status === 'error') return { label: 'Balance unavailable', ready: false };
  if (status === 'ready' && balances) return { label: formatSol(balances.lamports), ready: true };
  return null;
}

/**
 * Applies the sufficiency check to whatever the provider currently knows.
 *
 * Returns null — not "blocked" — whenever the balance is unknown: still
 * loading, failed to read, or the wallet is not connected. An RPC hiccup must
 * never be able to stop a funding flow that would have succeeded, so the guard
 * only ever fires on a balance it actually read. An unparseable amount is
 * treated the same way for the same reason.
 */
export function resolveFundingPreflight(
  status: BalanceStatus,
  balances: WalletBalances | null,
  requirement: { lamports: string; token: FundingRequirement['token'] },
): FundingSufficiency | null {
  if (status !== 'ready' || !balances) return null;
  let lamports: bigint;
  try {
    lamports = BigInt(requirement.lamports);
  } catch {
    return null;
  }
  return checkFundingSufficiency(balances, { lamports, token: requirement.token });
}

/**
 * Decides whether the connected wallet can cover a funding intent *before* the
 * wallet is asked to sign. A wallet that has never held the payment mint has no
 * token account at all, which reads as a null balance rather than zero — both
 * mean the same thing here, so they collapse to the same shortfall.
 */
export function checkFundingSufficiency(
  balances: WalletBalances,
  requirement: FundingRequirement,
): FundingSufficiency {
  const shortfalls: FundingShortfall[] = [];

  const requiredLamports = requirement.lamports + NETWORK_FEE_BUFFER_LAMPORTS;
  if (balances.lamports < requiredLamports) {
    shortfalls.push({
      asset: 'SOL',
      available: formatSol(balances.lamports),
      required: formatSol(requiredLamports),
      shortfall: formatSol(requiredLamports - balances.lamports),
    });
  }

  const tokenRequirement = requirement.token;
  if (tokenRequirement) {
    const available = balances.token?.amount ?? 0n;
    if (available < tokenRequirement.amount) {
      const decimals = tokenRequirement.decimals;
      shortfalls.push({
        asset: tokenRequirement.symbol,
        available: `${formatUnits(available, decimals)} ${tokenRequirement.symbol}`,
        required: `${formatUnits(tokenRequirement.amount, decimals)} ${tokenRequirement.symbol}`,
        shortfall: `${formatUnits(tokenRequirement.amount - available, decimals)} ${tokenRequirement.symbol}`,
      });
    }
  }

  if (shortfalls.length === 0) {
    return {
      shortfalls,
      status: 'sufficient',
      summary: 'Wallet balance covers the stake and the network fee.',
    };
  }

  // entry.shortfall already carries its symbol, so this reads "Add 0.02 SOL and
  // 25 USDC to this wallet before funding."
  const missing = shortfalls.map((entry) => entry.shortfall).join(' and ');
  return {
    shortfalls,
    status: 'insufficient',
    summary: `Add ${missing} to this wallet before funding.`,
  };
}
