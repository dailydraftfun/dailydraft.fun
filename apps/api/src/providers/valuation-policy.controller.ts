import { Controller, Get, Header, Param } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { ValuationPolicyService } from './valuation-policy.service.js';

@Controller('valuation-policies')
export class ValuationPolicyController {
  constructor(private readonly policies: ValuationPolicyService) {}

  @Get('current')
  @Header('cache-control', 'public, max-age=300')
  findCurrent() {
    return this.policies.findCurrent();
  }

  @Get(':policyHash')
  @Header('cache-control', 'public, max-age=31536000, immutable')
  findOne(@Param('policyHash') policyHash: string) {
    return this.policies.findOne(policyHash);
  }
}
