import { describe, expect, test } from 'bun:test';

import {
  calculateFantasyPayouts,
  FANTASY_PAYOUT_SCHEMA_VERSION,
  FANTASY_PAYOUT_VERSION,
  FantasyPayoutContractError,
  type FantasyPayoutRuleSet,
  hashFantasyPayoutRuleSet,
  type UnsignedFantasyPayoutRuleSet,
  validateFantasyPayoutRuleSet,
} from './fantasy-payout.js';

// Valid base58 (no 0/O/I/l), 32 chars — the payout math rejects non-base58 wallets.
const WALLET = {
  def1: 'Def2A2222222222222222222222222222',
  def2: 'Def2B2222222222222222222222222222',
  fwd1: 'Fwd3A2222222222222222222222222222',
  fwd2: 'Fwd3B2222222222222222222222222222',
  fwd3: 'Fwd3C2222222222222222222222222222',
} as const;

const UNSIGNED_FIXTURE_RULES = {
  activation: 'fixture-only',
  basisPointsTotal: '10000',
  calculatorVersion: FANTASY_PAYOUT_VERSION,
  currency: 'USDC',
  decimals: 6,
  positions: [
    { placeBasisPoints: ['900', '400', '300'], position: 'GOALKEEPER' },
    { placeBasisPoints: ['1200', '700', '500', '300', '100'], position: 'DEFENDER' },
    { placeBasisPoints: ['1200', '700', '500', '300', '100'], position: 'MIDFIELDER' },
    { placeBasisPoints: ['1200', '700', '500', '300', '100'], position: 'FORWARD' },
  ],
  rounding: 'floor',
  rulesVersion: 'synthetic-soccer-ci-v1',
  schemaVersion: FANTASY_PAYOUT_SCHEMA_VERSION,
  sport: 'SOCCER',
} as const satisfies UnsignedFantasyPayoutRuleSet;

const FIXTURE_RULES_HASH = 'e7074753e9bb620b1ff37f86d0a6e3ea554d0993aebf7ebd6676c2411fa2d5dc';

const FIXTURE_RULES: FantasyPayoutRuleSet = Object.freeze({
  ...UNSIGNED_FIXTURE_RULES,
  rulesHash: FIXTURE_RULES_HASH,
});

const USDC = (amount: string) => ({ amount, currency: 'USDC' as const, decimals: 6 as const });

// prizePool 1000001 is deliberately not divisible by the basis-point total, and the
// FORWARD place spreads its allocation over 7 shares, so both place-level and
// holder-level floor remainders are exercised in one vector.
const FIXTURE_INPUT = {
  placements: [
    {
      holders: [
        { eligibleShares: '2', walletAddress: WALLET.def1 },
        { eligibleShares: '1', walletAddress: WALLET.def2 },
      ],
      place: 1,
      playerId: 'def_player_1',
      position: 'DEFENDER' as const,
    },
    {
      holders: [
        { eligibleShares: '3', walletAddress: WALLET.fwd1 },
        { eligibleShares: '2', walletAddress: WALLET.fwd2 },
        { eligibleShares: '2', walletAddress: WALLET.fwd3 },
      ],
      place: 1,
      playerId: 'fwd_player_1',
      position: 'FORWARD' as const,
    },
  ],
  prizePool: USDC('1000001'),
};

describe('versioned position-weighted fantasy payout calculator', () => {
  test('pins the reviewed synthetic rule fixture to its literal SHA-256 commitment', () => {
    expect(hashFantasyPayoutRuleSet(UNSIGNED_FIXTURE_RULES)).toBe(FIXTURE_RULES_HASH);
    const validated = validateFantasyPayoutRuleSet(FIXTURE_RULES);
    expect(validated.rulesHash).toBe(FIXTURE_RULES_HASH);
  });

  test('distributes position-weighted rewards and conserves every minor unit', () => {
    const result = calculateFantasyPayouts(FIXTURE_RULES, FIXTURE_INPUT);

    expect(result.distributed).toEqual(USDC('239998'));
    expect(result.residual).toEqual(USDC('2'));
    expect(result.undistributed).toEqual(USDC('760001'));
    expect(result.calculationHash).toBe(
      '493cc08b4f11889d6913a3d1712fd9c9770b31ab2b93a2a86f0c39b4607b71ac',
    );

    // Conservation: distributed + residual + undistributed === prizePool.
    const conserved =
      BigInt(result.distributed.amount) +
      BigInt(result.residual.amount) +
      BigInt(result.undistributed.amount);
    expect(conserved.toString()).toBe(result.prizePool.amount);
  });

  test('splits each place allocation by holder share with floor rounding', () => {
    const result = calculateFantasyPayouts(FIXTURE_RULES, FIXTURE_INPUT);

    const defender = result.allocations[0]!;
    expect(defender.placeAllocation).toEqual(USDC('120000'));
    expect(defender.holderResidual).toEqual(USDC('0'));
    expect(defender.holderRewards.map((holder) => holder.reward.amount)).toEqual([
      '80000',
      '40000',
    ]);

    const forward = result.allocations[1]!;
    expect(forward.placeAllocation).toEqual(USDC('120000'));
    // 120000 over shares 3/2/2 -> 51428 + 34285 + 34285 = 119998, 2 minor units held back.
    expect(forward.holderRewards.map((holder) => holder.reward.amount)).toEqual([
      '51428',
      '34285',
      '34285',
    ]);
    expect(forward.holderResidual).toEqual(USDC('2'));
  });

  test('is deterministic across repeated evaluations', () => {
    const first = calculateFantasyPayouts(FIXTURE_RULES, FIXTURE_INPUT);
    const second = calculateFantasyPayouts(FIXTURE_RULES, FIXTURE_INPUT);
    expect(second.calculationHash).toBe(first.calculationHash);
  });

  test('routes a place with no eligible shares entirely to undistributed', () => {
    const result = calculateFantasyPayouts(FIXTURE_RULES, {
      placements: [{ holders: [], place: 1, playerId: 'gk_player_1', position: 'GOALKEEPER' }],
      prizePool: USDC('1000000'),
    });

    // Nothing is payable, so the whole pool stays undistributed and never counts as residual.
    expect(result.distributed).toEqual(USDC('0'));
    expect(result.residual).toEqual(USDC('0'));
    expect(result.undistributed).toEqual(USDC('1000000'));
    expect(result.allocations[0]!.placeAllocation).toEqual(USDC('0'));
  });

  test('rejects a rule set whose basis points do not sum to 10000', () => {
    const unbalanced = {
      ...UNSIGNED_FIXTURE_RULES,
      positions: [{ placeBasisPoints: ['9999'], position: 'FORWARD' as const }],
    };
    const hash = hashFantasyPayoutRuleSet(unbalanced as UnsignedFantasyPayoutRuleSet);
    try {
      validateFantasyPayoutRuleSet({ ...unbalanced, rulesHash: hash });
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyPayoutContractError);
      expect((error as FantasyPayoutContractError).code).toBe('BASIS_POINTS_TOTAL_MISMATCH');
    }
  });

  test('rejects duplicate placements for the same position and place', () => {
    try {
      calculateFantasyPayouts(FIXTURE_RULES, {
        placements: [
          {
            holders: [{ eligibleShares: '1', walletAddress: WALLET.fwd1 }],
            place: 1,
            playerId: 'fwd_player_1',
            position: 'FORWARD',
          },
          {
            holders: [{ eligibleShares: '1', walletAddress: WALLET.fwd2 }],
            place: 1,
            playerId: 'fwd_player_2',
            position: 'FORWARD',
          },
        ],
        prizePool: USDC('1000000'),
      });
      throw new Error('expected calculation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyPayoutContractError);
      expect((error as FantasyPayoutContractError).code).toBe('DUPLICATE_PLACEMENT');
    }
  });

  test('rejects holder wallets that are not valid base58 Solana addresses', () => {
    try {
      calculateFantasyPayouts(FIXTURE_RULES, {
        placements: [
          {
            // lowercase l is not in the base58 alphabet.
            holders: [{ eligibleShares: '1', walletAddress: 'Invalidl0OWallet0000000000000000' }],
            place: 1,
            playerId: 'fwd_player_1',
            position: 'FORWARD',
          },
        ],
        prizePool: USDC('1000000'),
      });
      throw new Error('expected calculation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyPayoutContractError);
      expect((error as FantasyPayoutContractError).code).toBe('INVALID_INPUT');
    }
  });

  test('rejects a place below the first configured rank', () => {
    try {
      calculateFantasyPayouts(FIXTURE_RULES, {
        placements: [
          {
            holders: [{ eligibleShares: '1', walletAddress: WALLET.def1 }],
            place: 0,
            playerId: 'gk_player_1',
            position: 'GOALKEEPER',
          },
        ],
        prizePool: USDC('1000000'),
      });
      throw new Error('expected calculation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyPayoutContractError);
      expect((error as FantasyPayoutContractError).code).toBe('PLACE_NOT_CONFIGURED');
    }
  });

  test('rejects a place outside the configured payout table', () => {
    try {
      calculateFantasyPayouts(FIXTURE_RULES, {
        placements: [
          {
            holders: [{ eligibleShares: '1', walletAddress: WALLET.def1 }],
            place: 4,
            playerId: 'gk_player_1',
            position: 'GOALKEEPER',
          },
        ],
        prizePool: USDC('1000000'),
      });
      throw new Error('expected calculation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyPayoutContractError);
      expect((error as FantasyPayoutContractError).code).toBe('PLACE_NOT_CONFIGURED');
    }
  });
});
