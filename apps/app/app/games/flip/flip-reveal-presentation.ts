import { formatUnits } from '../../solana/balance';
import type { GachaInventorySnapshot, GachaRip } from '../../solana/gacha-client';

/**
 * Presentation derivations for one revealed rip.
 *
 * Everything here is read-only decoration over values the server already
 * committed — the card art comes out of the asset reference the provider
 * minted, and the rarity band comes out of the odds commitment that was sealed
 * before the roll. Nothing in this file can change which card was pulled.
 */

const ASSET_PREFIX = 'devnet:sports-pack:';

/**
 * Devnet card identifiers are Pokémon TCG ids (`base1-4`). The pattern is
 * deliberately tighter than the asset grammar: it rejects dots and slashes, so
 * a hostile reference cannot walk out of the image path and into another route
 * on the whitelisted `images.pokemontcg.io` host.
 */
const CARD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/**
 * Reads the card art out of a devnet asset reference.
 *
 * The provider mints `devnet:sports-pack:{machineKey}:{cardId}:{mac}`, and a
 * machine key may itself contain colons, so the known prefix is stripped rather
 * than the string being split on a fixed index. Returns `undefined` for any
 * reference this surface does not recognise — an unknown shape falls back to
 * the text card rather than requesting an image that would 404.
 */
export function getFlipCardImageUrl(
  assetReference: string | null | undefined,
  machineKey: string,
): string | undefined {
  if (!assetReference) {
    return undefined;
  }
  const prefix = `${ASSET_PREFIX}${machineKey}:`;
  if (!assetReference.startsWith(prefix)) {
    return undefined;
  }
  const [cardId, ...rest] = assetReference.slice(prefix.length).split(':');
  // A well-formed reference always carries the trailing signer segment; without
  // it the value is a truncated prefix rather than a card.
  if (!cardId || rest.length === 0 || !CARD_ID_PATTERN.test(cardId)) {
    return undefined;
  }
  return `https://images.pokemontcg.io/${cardId}.png`;
}

export type FlipRarityBand = 'base' | 'chase' | 'plus' | 'premium';

export type FlipRarity = {
  band: FlipRarityBand;
  blurb: string;
  label: string;
  /** The sealed minimum this card cleared, in USDC minor units. */
  minimumMinor: string;
};

const BAND_COPY: Record<FlipRarityBand, { blurb: string; label: string }> = {
  base: { blurb: 'Cleared the pool floor.', label: 'Base' },
  chase: { blurb: 'Top committed band — the chase hit.', label: 'Chase' },
  plus: { blurb: 'Cleared the plus band minimum.', label: 'Plus' },
  premium: { blurb: 'Cleared the premium band minimum.', label: 'Premium' },
};

function isKnownBand(label: string): label is FlipRarityBand {
  return label in BAND_COPY;
}

function parseMinor(value: string | null | undefined): bigint | null {
  if (!value) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Resolves a revealed card's rarity from the sealed band minimums.
 *
 * The bands are the server's own — `bandMinimums` is committed alongside the
 * odds before a rip is priced — so this reads the tier the house published
 * rather than inventing thresholds in the browser. Returns `null` whenever the
 * value or the bands cannot be read, which the UI renders as "Rarity pending"
 * instead of guessing a celebration the roll did not earn.
 */
export function resolveFlipRarity(
  bandMinimums: Record<string, string> | null | undefined,
  insuredValueMinor: string | null | undefined,
): FlipRarity | null {
  const value = parseMinor(insuredValueMinor);
  if (value === null || !bandMinimums) {
    return null;
  }

  const cleared = Object.entries(bandMinimums)
    .flatMap(([label, minimum]) => {
      const parsed = parseMinor(minimum);
      return parsed !== null && isKnownBand(label) && parsed <= value
        ? [{ band: label, minimum: parsed }]
        : [];
    })
    .sort((left, right) => (right.minimum > left.minimum ? 1 : -1));

  const best = cleared[0];
  if (!best) {
    return null;
  }
  return {
    band: best.band,
    ...BAND_COPY[best.band],
    minimumMinor: best.minimum.toString(),
  };
}

export type FlipRevealCard = {
  displayName: string;
  graded: boolean;
  imageUrl: string | undefined;
  insuredValue: string;
  rarity: FlipRarity | null;
};

/**
 * Joins a settled rip to the snapshot entry it drew from.
 *
 * The rip carries the asset reference and the insured value; the sealed
 * snapshot carries the human-readable card name and grading flag. Matching them
 * here keeps the reveal showing the card the pool committed to rather than a
 * reference string.
 */
export function describeFlipReveal(
  rip: GachaRip,
  snapshot: GachaInventorySnapshot | null,
  bandMinimums: Record<string, string> | null,
): FlipRevealCard {
  const reference = rip.selectedAssetReference ?? rip.failedAssetReference;
  const entry = snapshot?.entries.find((candidate) => candidate.assetReference === reference);
  const value = parseMinor(rip.insuredValueMinor);

  return {
    displayName: entry?.displayName ?? 'Vaulted card',
    graded: entry?.graded ?? false,
    imageUrl: getFlipCardImageUrl(reference, rip.machineKey),
    insuredValue:
      value === null ? 'Value pending' : `${formatUnits(value, rip.insuredValueDecimals)} USDC`,
    rarity: resolveFlipRarity(bandMinimums, rip.insuredValueMinor),
  };
}
