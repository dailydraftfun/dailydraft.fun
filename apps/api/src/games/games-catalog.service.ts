import {
  GAME_CATALOG_SCHEMA_VERSION,
  type GameCatalog,
  type GameCatalogAction,
  type GameCatalogMode,
} from '@dailydraft/contracts';
import { Injectable } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AdminService, readRiskLimits } from '../admin/admin.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaRipService } from '../gacha/gacha-rip.service.js';
import { publicProductCapabilities } from '../health/health.controller.js';

type Readiness = Awaited<ReturnType<AdminService['getReadiness']>>;
type GachaCapability = ReturnType<GachaRipService['capability']>;
type DuelAdmission = Readonly<{
  allowedTiers: readonly number[];
  paused: boolean;
}>;

const DUEL_ROUTE = '/games/duel' as const;
const GACHA_ROUTE = '/games/gacha' as const;

@Injectable()
export class GamesCatalogService {
  constructor(
    private readonly admin: AdminService,
    private readonly gacha: GachaRipService,
  ) {}

  async getCatalog(asOf: Date = new Date()): Promise<GameCatalog> {
    const [duelCapability, gachaCapability] = await Promise.allSettled([
      Promise.all([this.admin.getReadiness(), this.admin.getEmergencyPause()]).then(
        ([readiness, pause]) => ({
          admission: {
            allowedTiers: readRiskLimits().allowedTiers,
            paused: pause.paused,
          },
          readiness,
        }),
      ),
      Promise.resolve().then(() => this.gacha.capability()),
    ]);

    return {
      asOf: asOf.toISOString(),
      modes: [
        duelCapability.status === 'fulfilled'
          ? resolveDuelCatalogMode(duelCapability.value.readiness, duelCapability.value.admission)
          : degradedDuelCatalogMode(),
        gachaCapability.status === 'fulfilled'
          ? resolveGachaCatalogMode(gachaCapability.value)
          : degradedGachaCatalogMode(),
        previewMode({
          description:
            'Walk through a scripted local marketplace UI with a fixed result while inventory, selection, custody, pricing, and settlement remain disabled.',
          href: '/games/marketplace-flip',
          id: 'flip',
          name: 'Marketplace Flip',
          reason:
            'Fixture preview only. Marketplace inventory, custody, pricing, and settlement are not live.',
        }),
        previewMode({
          description:
            'Walk through a fixed four-stage card script; only an attempt past the final stage triggers its local bust state.',
          href: '/games/crash',
          id: 'crash',
          name: 'Card Streak',
          reason:
            'Fixture preview only. Live card-stage economics, custody, and settlement are not enabled.',
        }),
      ],
      network: 'solana-devnet',
      schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
    };
  }
}

export function resolveDuelCatalogMode(
  readiness: Readiness,
  admission: DuelAdmission,
): GameCatalogMode {
  const capabilities = publicProductCapabilities(readiness);
  const packReady = capabilities.packs.some(
    (pack) => pack.enabled && admission.allowedTiers.includes(pack.tier),
  );
  const availableActions: GameCatalogAction[] = [];

  if (!admission.paused && packReady && capabilities.modes.direct.enabled) {
    availableActions.push({
      href: DUEL_ROUTE,
      id: 'direct-challenge',
      label: 'Challenge a wallet',
    });
  }
  if (!admission.paused && packReady && capabilities.modes.open.enabled) {
    availableActions.push({
      href: DUEL_ROUTE,
      id: 'open-matchmaking',
      label: 'Find a rival',
    });
  }
  if (!admission.paused && packReady && capabilities.modes.house.enabled) {
    availableActions.push({
      href: DUEL_ROUTE,
      id: 'house-opponent',
      label: 'Play the house',
    });
  }

  const fullyPlayable =
    !admission.paused &&
    packReady &&
    capabilities.modes.direct.enabled &&
    capabilities.modes.open.enabled;
  const partiallyPlayable = availableActions.length > 0;

  return {
    availableActions,
    capabilitySource: {
      kind: 'runtime',
      name: 'duel-readiness',
      status: 'verified',
    },
    description:
      'Open the same sports pack tier against another wallet or an explicitly enabled house opponent.',
    id: 'duel',
    name: 'Card Duel',
    reason: admission.paused
      ? 'New Duel exposure is paused by an operator.'
      : admission.allowedTiers.length === 0
        ? 'No supported Duel tier is admitted by devnet risk controls.'
        : fullyPlayable
          ? 'Direct challenges and open matchmaking are ready on Solana devnet.'
          : partiallyPlayable
            ? 'Only the listed Duel actions are currently ready on Solana devnet.'
            : (capabilities.modes.direct.reason ??
              capabilities.modes.open.reason ??
              'No admitted Duel pack tier is currently ready on Solana devnet.'),
    state: fullyPlayable ? 'playable' : partiallyPlayable ? 'degraded' : 'unavailable',
  };
}

export function resolveGachaCatalogMode(capability: GachaCapability): GameCatalogMode {
  const playable = capability.availability === 'playable';

  return {
    availableActions: playable
      ? [{ href: GACHA_ROUTE, id: 'rip-pack', label: 'Rip a sports pack' }]
      : [],
    capabilitySource: {
      kind: 'runtime',
      name: 'gacha-capability',
      status: 'verified',
    },
    description:
      'Rip from a sealed sports-card inventory pool with committed odds and a verified deposit before reveal.',
    id: 'gacha',
    name: 'Sports Pack Gacha',
    reason: capability.reason,
    state: playable ? 'playable' : 'preview',
  };
}

function degradedDuelCatalogMode(): GameCatalogMode {
  return {
    availableActions: [],
    capabilitySource: { kind: 'runtime', name: 'duel-readiness', status: 'degraded' },
    description:
      'Open the same sports pack tier against another wallet or an explicitly enabled house opponent.',
    id: 'duel',
    name: 'Card Duel',
    reason: 'Duel readiness could not be verified. No Duel action is available.',
    state: 'degraded',
  };
}

function degradedGachaCatalogMode(): GameCatalogMode {
  return {
    availableActions: [],
    capabilitySource: { kind: 'runtime', name: 'gacha-capability', status: 'degraded' },
    description:
      'Rip from a sealed sports-card inventory pool with committed odds and a verified deposit before reveal.',
    id: 'gacha',
    name: 'Sports Pack Gacha',
    reason: 'Gacha capability could not be verified. No rip action is available.',
    state: 'degraded',
  };
}

function previewMode(input: {
  description: string;
  href: '/games/crash' | '/games/marketplace-flip';
  id: 'crash' | 'flip';
  name: string;
  reason: string;
}): GameCatalogMode {
  return {
    availableActions: [{ href: input.href, id: 'view-preview', label: 'View fixture preview' }],
    capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
    description: input.description,
    id: input.id,
    name: input.name,
    reason: input.reason,
    state: 'preview',
  };
}
