import { Module } from '@nestjs/common';

import { PokemonTcgClient } from '../providers/pokemon-tcg.client.js';
import { DevnetDemoSignerService } from '../transactions/devnet-demo-signer.service.js';
import { SolanaRpcClient, SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import { DevnetSportsPackGachaProvider } from './devnet-sports-pack-gacha.provider.js';
import { GachaController } from './gacha.controller.js';
import { gachaDevnetModeEnabled } from './gacha-capability.js';
import { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
import { GachaPaymentService } from './gacha-payment.service.js';
import { GachaRipService } from './gacha-rip.service.js';
import {
  FixtureSportsPackGachaProvider,
  gachaFixtureModeEnabled,
} from './sports-pack-gacha.fixture.js';
import {
  CollectorCryptSportsPackGachaProvider,
  SportsPackGachaProvider,
} from './sports-pack-gacha.provider.js';

@Module({
  controllers: [GachaController],
  exports: [
    GachaInventorySnapshotService,
    GachaPaymentService,
    GachaRipService,
    SportsPackGachaProvider,
  ],
  providers: [
    CollectorCryptSportsPackGachaProvider,
    DevnetSportsPackGachaProvider,
    FixtureSportsPackGachaProvider,
    GachaInventorySnapshotService,
    GachaPaymentService,
    GachaRipService,
    // The devnet provider's two collaborators are dependency-free `@Injectable()`s,
    // so this module registers them directly rather than importing
    // `TransactionsModule` — the same reasoning that keeps the RPC gateway local.
    DevnetDemoSignerService,
    PokemonTcgClient,
    // Every module that reads the chain registers its own gateway rather than
    // importing a shared one, matching `transactions` and `treasury`.
    { provide: SolanaRpcGateway, useClass: SolanaRpcClient },
    {
      inject: [
        CollectorCryptSportsPackGachaProvider,
        DevnetSportsPackGachaProvider,
        FixtureSportsPackGachaProvider,
      ],
      provide: SportsPackGachaProvider,
      // Fixture wins over devnet: a deployment that turns fixtures on is asking
      // for deterministic inventory even when devnet credentials are present.
      // `snapshotInputForMode` resolves its policy in the same order.
      useFactory: (
        collectorCrypt: CollectorCryptSportsPackGachaProvider,
        devnet: DevnetSportsPackGachaProvider,
        fixture: FixtureSportsPackGachaProvider,
      ) => {
        if (gachaFixtureModeEnabled()) return fixture;
        return gachaDevnetModeEnabled() ? devnet : collectorCrypt;
      },
    },
  ],
})
export class GachaModule {}
