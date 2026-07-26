import { describe, expect, test } from 'bun:test';
import {
  checkFundingSufficiency,
  describeWalletBalance,
  formatSol,
  formatTokenBalance,
  formatUnits,
  NETWORK_FEE_BUFFER_LAMPORTS,
  resolveFundingPreflight,
} from './balance';

describe('formatUnits', () => {
  test('trims trailing zeros without losing significant digits', () => {
    expect(formatUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(formatUnits(15_000_000n, 9)).toBe('0.015');
    expect(formatUnits(1_000_000_000n, 9)).toBe('1');
  });

  test('keeps leading zeros inside the fraction', () => {
    expect(formatUnits(1_000n, 9)).toBe('0.000001');
  });

  test('renders a zero balance as a bare zero', () => {
    expect(formatUnits(0n, 6)).toBe('0');
  });

  test('groups whole units the way public money does', () => {
    expect(formatUnits(1_234_500_000n, 6)).toBe('1,234.5');
  });
});

describe('formatSol', () => {
  test('labels lamports as SOL', () => {
    expect(formatSol(15_000_000n)).toBe('0.015 SOL');
  });
});

describe('formatTokenBalance', () => {
  test('labels a token balance with its symbol', () => {
    expect(formatTokenBalance({ amount: 25_000_000n, decimals: 6 }, 'USDC')).toBe('25 USDC');
  });
});

const stake = { amount: 25_000_000n, decimals: 6, symbol: 'USDC' };
const feeLamports = 15_000_000n;

describe('checkFundingSufficiency', () => {
  test('passes when both balances clear the requirement plus the fee buffer', () => {
    const result = checkFundingSufficiency(
      { lamports: 200_000_000n, token: { amount: 30_000_000n, decimals: 6 } },
      { lamports: feeLamports, token: stake },
    );

    expect(result.status).toBe('sufficient');
    expect(result.shortfalls).toHaveLength(0);
    expect(result.summary).toBe(
      'Wallet balance covers the stake, platform fee, and network fee buffer.',
    );
  });

  test('rejects a wallet holding exactly the platform fee, because signatures still cost lamports', () => {
    const result = checkFundingSufficiency(
      { lamports: feeLamports, token: { amount: 30_000_000n, decimals: 6 } },
      { lamports: feeLamports, token: stake },
    );

    expect(result.status).toBe('insufficient');
    expect(result.shortfalls).toHaveLength(1);
    expect(result.shortfalls[0]?.asset).toBe('SOL');
    expect(result.shortfalls[0]?.shortfall).toBe(formatSol(NETWORK_FEE_BUFFER_LAMPORTS));
  });

  test('reports the stake shortfall when the wallet has never held the payment mint', () => {
    const result = checkFundingSufficiency(
      { lamports: 200_000_000n, token: null },
      { lamports: feeLamports, token: stake },
    );

    expect(result.status).toBe('insufficient');
    expect(result.shortfalls).toEqual([
      { asset: 'USDC', available: '0 USDC', required: '25 USDC', shortfall: '25 USDC' },
    ]);
  });

  test('a zero token balance is treated the same as a missing token account', () => {
    const missingAccount = checkFundingSufficiency(
      { lamports: 200_000_000n, token: null },
      { lamports: feeLamports, token: stake },
    );
    const emptyAccount = checkFundingSufficiency(
      { lamports: 200_000_000n, token: { amount: 0n, decimals: 6 } },
      { lamports: feeLamports, token: stake },
    );

    expect(emptyAccount.shortfalls).toEqual(missingAccount.shortfalls);
  });

  test('names both assets when the wallet is short on each', () => {
    const result = checkFundingSufficiency(
      { lamports: 0n, token: { amount: 5_000_000n, decimals: 6 } },
      { lamports: feeLamports, token: stake },
    );

    expect(result.shortfalls.map((entry) => entry.asset)).toEqual(['SOL', 'USDC']);
    expect(result.summary).toBe('Add 0.015015 SOL and 20 USDC to this wallet before funding.');
  });

  test('skips the token check entirely for a SOL-only requirement', () => {
    const result = checkFundingSufficiency(
      { lamports: 200_000_000n, token: null },
      { lamports: feeLamports, token: null },
    );

    expect(result.status).toBe('sufficient');
    expect(result.summary).toBe('Wallet balance covers the platform fee and network fee buffer.');
  });
});

describe('describeWalletBalance', () => {
  test('reports the SOL figure once a read lands', () => {
    expect(describeWalletBalance('ready', { lamports: 2_500_000_000n, token: null })).toEqual({
      label: '2.5 SOL',
      ready: true,
    });
  });

  test('explains a pending or failed read without claiming a figure', () => {
    expect(describeWalletBalance('loading', null)).toEqual({
      label: 'Reading balance…',
      ready: false,
    });
    expect(describeWalletBalance('error', null)).toEqual({
      label: 'Balance unavailable',
      ready: false,
    });
  });

  test('renders nothing for a disconnected wallet', () => {
    expect(describeWalletBalance('idle', null)).toBeNull();
  });

  test('renders nothing when the status claims ready but no balance arrived', () => {
    expect(describeWalletBalance('ready', null)).toBeNull();
  });
});

describe('resolveFundingPreflight', () => {
  const funded = { lamports: 200_000_000n, token: null };
  const solOnly = { lamports: feeLamports.toString(), token: null };

  test('clears a wallet that covers the fee and the buffer', () => {
    expect(resolveFundingPreflight('ready', funded, solOnly)?.status).toBe('sufficient');
  });

  test('blocks a wallet that cannot cover the fee', () => {
    const result = resolveFundingPreflight('ready', { lamports: 1_000n, token: null }, solOnly);

    expect(result?.status).toBe('insufficient');
    expect(result?.summary).toContain('Add ');
  });

  test('applies a token requirement when one is supplied', () => {
    const result = resolveFundingPreflight('ready', funded, {
      lamports: solOnly.lamports,
      token: stake,
    });

    expect(result?.shortfalls.map((entry) => entry.asset)).toEqual(['USDC']);
  });

  test('stays silent while the balance is still unknown', () => {
    expect(resolveFundingPreflight('loading', null, solOnly)).toBeNull();
    expect(resolveFundingPreflight('error', null, solOnly)).toBeNull();
    expect(resolveFundingPreflight('idle', null, solOnly)).toBeNull();
  });

  test('stays silent when the status claims ready but no balance arrived', () => {
    expect(resolveFundingPreflight('ready', null, solOnly)).toBeNull();
  });

  test('stays silent rather than blocking on an unparseable requirement', () => {
    expect(resolveFundingPreflight('ready', funded, { lamports: '0.5', token: null })).toBeNull();
  });
});
