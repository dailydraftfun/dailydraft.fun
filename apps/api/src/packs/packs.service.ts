import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { Pack, Page } from '../domain.js';
import { currentValuationPolicy } from '../providers/valuation-policy.js';
import type { ListPacksQuery } from './list-packs.query.js';
import { PACK_TIER_CATALOG } from './pack-catalog.js';

function packs(): readonly Pack[] {
  const { policyHash } = currentValuationPolicy();
  return PACK_TIER_CATALOG.filter((pack) => pack.supported).map(
    (pack) =>
      ({
        active: true,
        id: pack.id,
        name: pack.name,
        price: { amount: String(pack.tier * 1_000_000), currency: 'USDC', decimals: 6 },
        provider:
          process.env.DAILYDRAFT_PROVIDER_MODE === 'dailydraft-devnet'
            ? 'dailydraft-devnet'
            : 'collector-crypt',
        providerPackId: pack.id,
        valuationPolicyHash: policyHash,
      }) satisfies Pack,
  );
}

@Injectable()
export class PacksService {
  findAll(query: ListPacksQuery): Page<Pack> {
    const active = query.active === undefined ? true : query.active === 'true';
    const eligible = packs().filter((pack) => pack.active === active);
    const start = resolveCursor(eligible, query.cursor);
    const data = eligible.slice(start, start + query.limit);
    const hasMore = start + data.length < eligible.length;

    return {
      data,
      hasMore,
      nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null,
    };
  }

  findOne(packId: string): Pack {
    const pack = packs().find((candidate) => candidate.id === packId);
    if (!pack) throw new NotFoundException(`Pack ${packId} was not found`);
    return pack;
  }
}

function resolveCursor(packs: readonly Pack[], cursor?: string): number {
  if (!cursor) return 0;
  const index = packs.findIndex((pack) => pack.id === cursor);
  if (index === -1) throw new BadRequestException('cursor does not identify an eligible pack');
  return index + 1;
}
