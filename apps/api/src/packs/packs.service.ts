import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { Pack, Page } from '../domain.js';
import type { ListPacksQuery } from './list-packs.query.js';

const PACKS: readonly Pack[] = [
  {
    active: true,
    id: 'pokemon_50',
    name: 'Pokémon $50 Pack',
    price: { amount: '50000000', currency: 'USDC', decimals: 6 },
    provider: 'jupiter-gacha',
    providerPackId: 'pokemon_50',
    valuationPolicyHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
];

@Injectable()
export class PacksService {
  findAll(query: ListPacksQuery): Page<Pack> {
    const active = query.active === undefined ? true : query.active === 'true';
    const eligible = PACKS.filter((pack) => pack.active === active);
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
    const pack = PACKS.find((candidate) => candidate.id === packId);
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
