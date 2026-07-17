import {
  CheckCircleIcon,
  LightningIcon,
  SparkleIcon,
  SpinnerGapIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { DuelOpponentType, ProductCapabilities } from './solana/duel-client';

export type CapabilityLoadState =
  | { status: 'error'; message: string; retryable: boolean }
  | { status: 'loading' }
  | { status: 'ready'; value: ProductCapabilities };

type Mode = DuelOpponentType;

export function ProductCapabilityPanel({
  state,
  onRetry,
}: {
  state: CapabilityLoadState;
  onRetry: () => void;
}) {
  if (state.status === 'ready' && isProductPlayable(state.value)) return null;

  if (state.status === 'loading') {
    return (
      <div className="capability-panel" role="status">
        <SpinnerGapIcon className="wallet-spinner" size={22} />
        <div>
          <strong>Checking duel availability</strong>
          <p>Pack Duel is verifying playable modes and pack tiers before showing an action.</p>
        </div>
      </div>
    );
  }

  const message =
    state.status === 'error'
      ? state.message
      : (unavailableReason(state.value) ?? 'No duel option is currently playable.');

  return (
    <div className="capability-panel capability-panel-error" role="alert">
      <WarningCircleIcon size={22} weight="fill" />
      <div>
        <strong>Duel play unavailable</strong>
        <p>{message}</p>
        {state.status === 'error' && !state.retryable ? null : (
          <button type="button" onClick={onRetry}>
            Check availability again
          </button>
        )}
      </div>
    </div>
  );
}

export function DuelModeTabs({
  capabilities,
  disabled,
  mode,
  onSelect,
}: {
  capabilities: ProductCapabilities;
  disabled: boolean;
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <div className="mode-tabs" role="tablist" aria-label="Duel mode">
      <ModeTab
        caption="Invite a wallet"
        capability={capabilities.modes.direct}
        disabled={disabled}
        icon={<UserPlusIcon size={17} weight="bold" />}
        label="Challenge"
        mode="direct"
        selected={mode === 'direct'}
        onSelect={onSelect}
      />
      <ModeTab
        caption="Find a wallet"
        capability={capabilities.modes.open}
        disabled={disabled}
        icon={<UsersThreeIcon size={17} weight="fill" />}
        label="Matchmake"
        mode="matchmaking"
        selected={mode === 'matchmaking'}
        onSelect={onSelect}
      />
      <ModeTab
        caption="Play the house"
        capability={capabilities.modes.house}
        disabled={disabled}
        icon={<LightningIcon size={17} weight="fill" />}
        label="Instant"
        mode="house"
        selected={mode === 'house'}
        onSelect={onSelect}
      />
    </div>
  );
}

export function PackTierChoices({
  capabilities,
  locked,
  onSelect,
  selectedTier,
}: {
  capabilities: ProductCapabilities;
  locked: boolean;
  onSelect: (tier: number) => void;
  selectedTier: number;
}) {
  const enabledCount = capabilities.packs.filter((pack) => pack.enabled).length;

  return (
    <>
      <div className="section-label-row">
        <span>{enabledCount === 1 ? 'Available pack' : 'Choose pack tier'}</span>
        <span>{enabledCount === 1 ? 'Selected automatically' : 'Both players open one'}</span>
      </div>
      <div className="tier-grid">
        {capabilities.packs.map((pack) => {
          const selected = pack.enabled && selectedTier === pack.tier;
          const fixedSelection = pack.enabled && enabledCount === 1;
          return (
            <button
              key={pack.id}
              className={[
                'tier-card',
                selected ? 'tier-card-selected' : '',
                fixedSelection ? 'tier-card-fixed' : '',
                !pack.enabled ? 'tier-card-unavailable' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              onClick={() => onSelect(pack.tier)}
              aria-pressed={selected}
              disabled={locked || !pack.enabled || fixedSelection}
              title={
                pack.reason ??
                (fixedSelection ? 'The only playable tier is selected automatically.' : undefined)
              }
            >
              <span className="tier-orb" aria-hidden="true">
                <SparkleIcon size={pack.tier === 100 ? 25 : 21} weight="fill" />
              </span>
              <span>
                <strong>${pack.tier}</strong>
                <small>{pack.name}</small>
              </span>
              <span className="tier-availability">
                {pack.enabled ? 'Playable now' : 'Coming soon'}
              </span>
              {selected ? <CheckCircleIcon className="tier-check" size={18} weight="fill" /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function enabledPackForTier(
  capabilities: ProductCapabilities,
  tier: number,
): ProductCapabilities['packs'][number] | undefined {
  return capabilities.packs.find((pack) => pack.enabled && pack.tier === tier);
}

export function firstEnabledPack(
  capabilities: ProductCapabilities,
): ProductCapabilities['packs'][number] | undefined {
  return capabilities.packs.find((pack) => pack.enabled);
}

export function isModeEnabled(capabilities: ProductCapabilities, mode: Mode): boolean {
  return capabilityForMode(capabilities, mode).enabled;
}

export function isProductPlayable(capabilities: ProductCapabilities): boolean {
  return (
    capabilities.packs.some((pack) => pack.enabled) &&
    (capabilities.modes.direct.enabled ||
      capabilities.modes.open.enabled ||
      capabilities.modes.house.enabled)
  );
}

export function resolveLobbySelection(
  capabilities: ProductCapabilities,
  selection: { mode: Mode; tier: number },
): {
  mode: Mode;
  modeReason: string | null;
  pack: ProductCapabilities['packs'][number] | undefined;
  tier: number;
} {
  const currentMode = capabilityForMode(capabilities, selection.mode);
  const fallbackMode: Mode | undefined = capabilities.modes.direct.enabled
    ? 'direct'
    : capabilities.modes.open.enabled
      ? 'matchmaking'
      : capabilities.modes.house.enabled
        ? 'house'
        : undefined;
  const pack = enabledPackForTier(capabilities, selection.tier) ?? firstEnabledPack(capabilities);

  return {
    mode: currentMode.enabled ? selection.mode : (fallbackMode ?? selection.mode),
    modeReason: currentMode.enabled ? null : currentMode.reason,
    pack,
    tier: pack?.tier ?? selection.tier,
  };
}

function ModeTab({
  capability,
  caption,
  disabled,
  icon,
  label,
  mode,
  onSelect,
  selected,
}: {
  capability: { enabled: boolean; reason: string | null };
  caption: string;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  mode: Mode;
  onSelect: (mode: Mode) => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled || !capability.enabled}
      onClick={() => onSelect(mode)}
      title={capability.reason ?? undefined}
    >
      {icon}
      <span className="mode-tab-copy">
        <strong className="mode-tab-title">{label}</strong>
        <small className="mode-tab-caption">{capability.enabled ? caption : 'Coming soon'}</small>
      </span>
    </button>
  );
}

export function capabilityForMode(
  capabilities: ProductCapabilities,
  mode: Mode,
): { enabled: boolean; reason: string | null } {
  if (mode === 'matchmaking') return capabilities.modes.open;
  return capabilities.modes[mode];
}

function unavailableReason(capabilities: ProductCapabilities): string | null {
  return (
    capabilities.modes.direct.reason ??
    capabilities.modes.open.reason ??
    capabilities.packs.find((pack) => pack.reason)?.reason ??
    null
  );
}
