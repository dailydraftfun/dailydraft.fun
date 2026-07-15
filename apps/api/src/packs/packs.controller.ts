import { Controller, Get, Param, Query } from '@nestjs/common';

import type { Pack, Page } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { ListPacksQuery, PackIdParams } from './list-packs.query.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PacksService } from './packs.service.js';

@Controller('packs')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Get()
  findAll(@Query() query: ListPacksQuery): Page<Pack> {
    return this.packs.findAll(query);
  }

  @Get(':packId')
  findOne(@Param() params: PackIdParams): Pack {
    return this.packs.findOne(params.packId);
  }
}
