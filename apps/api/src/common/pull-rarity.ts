import { type PullRarity, pullRarityFor } from '@dailydraft/contracts';

const INTEGER_PATTERN = /^-?(0|[1-9]\d*)$/;

export function rarityForSerializedValue(valueMinor: unknown, decimals: unknown): PullRarity {
  if (
    typeof valueMinor !== 'string' ||
    !INTEGER_PATTERN.test(valueMinor) ||
    typeof decimals !== 'number'
  ) {
    return 'common';
  }
  return pullRarityFor(BigInt(valueMinor), decimals);
}
