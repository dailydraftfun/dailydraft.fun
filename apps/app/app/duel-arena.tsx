'use client';

import {
  ArrowCounterClockwiseIcon,
  ArrowsLeftRightIcon,
  CheckCircleIcon,
  CopyIcon,
  FireIcon,
  InfoIcon,
  LightningIcon,
  LinkIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  SwordIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XLogoIcon,
} from '@phosphor-icons/react';
import { Button, Card, CardContent, Input, Separator } from '@shipshitdev/ui';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { getRovingTabIndex } from './accessibility/focus-navigation';
import { trackProductEvent } from './analytics-client';
import {
  createDuelEntryDraft,
  DUEL_ENTRY_DRAFT_STORAGE_KEY,
  parseDuelEntryDraft,
} from './duel/duel-entry-flow';
import {
  classifyPostBroadcastRecovery,
  getDuelEntryCancellationTarget,
  restoreDuelEntry,
} from './duel/duel-entry-recovery';
import { DuelEntryStepper } from './duel/duel-entry-stepper';
import { type LiveDuelPhase, type LivePull, toLiveDuelState } from './duel/live-duel-state';
import {
  type CapabilityLoadState,
  capabilityForMode,
  DuelModeTabs,
  enabledPackForTier,
  isModeEnabled,
  isProductPlayable,
  PackTierChoices,
  ProductCapabilityPanel,
  resolveLobbySelection,
} from './duel-lobby-options';
import { journeyTestIds } from './e2e/journey-test-ids';
import {
  advanceDuelLifecycle,
  cancelDuel,
  cancelOpenMatchmaking,
  continueOpenMatchmaking,
  createDuel,
  type DuelOpponentType,
  type DuelTransactionIntent,
  type DurableDuel,
  getDuel,
  getOpenMatchmakingStatus,
  getProductCapabilities,
  joinDuel,
  type MatchmakingSession,
  prepareDuelIntent,
  reconcileDuelTransactions,
  searchOpenMatchmaking,
  selectHouseFallback,
  submitSignedDuelIntent,
  waitForDuelTransactions,
} from './solana/duel-client';
import { isDuelApiConfigured } from './solana/wallet-auth-client';
import { useWalletAuth } from './solana/wallet-auth-provider';
import { useSolanaWallet } from './solana/wallet-provider';
import { WalletTransactionNotBroadcastError } from './solana/wallet-transaction-error';

type Mode = DuelOpponentType;
type Phase = LiveDuelPhase;

export type DuelLobbyEntry = {
  action: 'accept' | 'rematch';
  duelId: string;
  mode: Mode;
  opponentAddress?: string;
  opponentLabel: string;
  tier: number;
};

const terminalDuelStatuses = new Set<DurableDuel['status']>([
  'cancelled',
  'refunded',
  'settled',
  'failed',
]);
const completedEntryStatuses = new Set<DurableDuel['status']>([
  'funded',
  'opening',
  'awaiting_assets',
  'settling',
  'settled',
]);

function Avatar({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="duel-avatar"
      style={{ '--avatar': color } as React.CSSProperties}
      role="img"
      aria-label={label}
    >
      <span />
    </span>
  );
}

function DuelCard({
  pull,
  side,
  phase,
  winner,
  tier,
  walletLabel,
}: {
  pull: LivePull | null;
  side: 'you' | 'opponent';
  phase: Phase;
  winner: boolean;
  tier: string;
  walletLabel: string;
}) {
  const visible = phase === 'result' && pull !== null;
  return (
    <article
      className={`reveal-column reveal-${side} ${winner && visible ? 'reveal-winner' : ''}`}
      data-testid={journeyTestIds.pull[side === 'you' ? 'you' : 'opponent']}
    >
      <div className="player-label">
        <Avatar
          color={side === 'you' ? '#b8ff5a' : '#a78bfa'}
          label={side === 'you' ? 'Your wallet' : 'Opponent wallet'}
        />
        <div>
          <small>{side === 'you' ? 'You' : 'Opponent'}</small>
          <strong>{walletLabel}</strong>
        </div>
        {winner && visible ? (
          <span
            className="winner-chip"
            data-testid={journeyTestIds.winner[side === 'you' ? 'you' : 'opponent']}
          >
            <TrophyIcon size={12} weight="fill" /> Winner
          </span>
        ) : null}
      </div>

      <div className={`card-stage card-stage-${phase}`}>
        <div className="pack-shell" aria-hidden={visible}>
          <div className="pack-glint" />
          <div className="pack-brand">
            <span>PACK</span>
            <strong>DUEL</strong>
            <small>COMMITTED PACK</small>
          </div>
          <Image
            src="https://images.pokemontcg.io/cardback.png"
            alt=""
            fill
            sizes="(max-width: 768px) 42vw, 260px"
            className="pack-art"
          />
          <span className="pack-tier">{visible ? '—' : tier}</span>
        </div>
        <div className="pull-shell" aria-hidden={!visible}>
          {pull?.image ? (
            <Image
              src={pull.image}
              alt={pull.name}
              fill
              sizes="(max-width: 768px) 42vw, 260px"
              className="pull-image"
              priority
            />
          ) : pull ? (
            <div className="pack-brand">
              <span>VERIFIED PULL</span>
              <strong>{pull.name}</strong>
              <small>{pull.label}</small>
            </div>
          ) : null}
        </div>
        {phase === 'opening' ? (
          <div className="opening-status" role="status">
            <span /> Opening pack
          </div>
        ) : null}
      </div>

      <div className={visible ? 'pull-meta pull-meta-visible' : 'pull-meta'}>
        <span className="grade-chip" data-testid={journeyTestIds.provider[side]}>
          {pull?.provider ?? 'Pending'}
        </span>
        <div>
          <strong data-testid={journeyTestIds.pullName[side]}>
            {pull?.name ?? 'Result pending'}
          </strong>
          <small>{pull?.label ?? 'No outcome committed yet'}</small>
        </div>
        <span className="pull-value" data-testid={journeyTestIds.pullValue[side]}>
          {pull?.value ?? '—'}
        </span>
      </div>
    </article>
  );
}

export function DuelArena({ entry }: { entry?: DuelLobbyEntry }) {
  const walletConnection = useSolanaWallet();
  const authentication = useWalletAuth();
  const [activeEntry, setActiveEntry] = useState(entry);
  const [mode, setMode] = useState<Mode>(
    entry?.mode === 'house' ? 'matchmaking' : (entry?.mode ?? 'matchmaking'),
  );
  const [tier, setTier] = useState(entry?.tier ?? 50);
  const [wallet, setWallet] = useState(entry?.opponentAddress ?? '');
  const [copied, setCopied] = useState(false);
  const [entryFlowOpen, setEntryFlowOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [recoveryDuelId, setRecoveryDuelId] = useState<string | null>(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [restoreDraftPending, setRestoreDraftPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [intent, setIntent] = useState<DuelTransactionIntent | null>(null);
  const [intentPending, setIntentPending] = useState(false);
  const [fundingPhase, setFundingPhase] = useState<
    'idle' | 'signing' | 'confirming' | 'recovering'
  >('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [persistedDuel, setPersistedDuel] = useState<DurableDuel | null>(null);
  const [matchmakingSession, setMatchmakingSession] = useState<MatchmakingSession | null>(null);
  const [matchmakingRestorePending, setMatchmakingRestorePending] = useState(false);
  const [capabilityState, setCapabilityState] = useState<CapabilityLoadState>({
    status: 'loading',
  });
  const [capabilityReload, setCapabilityReload] = useState(0);
  const matchmakingRestoreKey = useRef<string | null>(null);
  const duelRecoveryKey = useRef<string | null>(null);
  const lifecycleAdvanceKey = useRef<string | null>(null);
  const modeTabRefs = useRef<Partial<Record<Mode, HTMLButtonElement>>>({});
  const liveDuel = persistedDuel ? toLiveDuelState(persistedDuel, walletConnection.address) : null;
  const phase: Phase = liveDuel?.phase ?? 'lobby';
  const capabilities = capabilityState.status === 'ready' ? capabilityState.value : null;
  const houseFallbackEnabled = capabilities?.modes.house.enabled === true;
  const capabilityFormReady = capabilities ? isProductPlayable(capabilities) : false;
  const selectedPack = capabilities ? enabledPackForTier(capabilities, tier) : undefined;
  const selectedModeEnabled = capabilities ? isModeEnabled(capabilities, mode) : false;
  const houseFallbackAction = matchmakingSession?.availableActions.find(
    (action) => action.action === 'house_fallback',
  );
  const availableModes: Mode[] = [];
  if (capabilities?.modes.direct.enabled) availableModes.push('direct');
  if (capabilities?.modes.open.enabled) availableModes.push('matchmaking');
  if (capabilities?.modes.house.enabled) availableModes.push('house');

  function chooseMode(nextMode: Mode): boolean {
    if (nextMode === mode) return true;
    if (capabilityState.status !== 'ready') {
      setActionError('Duel availability must be verified before choosing a mode.');
      return false;
    }
    const nextCapability = capabilityForMode(capabilityState.value, nextMode);
    if (!nextCapability.enabled) {
      setActionError(nextCapability.reason ?? 'That duel mode is not currently playable.');
      return false;
    }
    if (matchmakingRestorePending) {
      setActionError('Checking this wallet for an active public matchmaking ticket.');
      return false;
    }
    if (matchmakingSession) {
      setActionError('Cancel the active public search before starting a different duel mode.');
      return false;
    }
    setActiveEntry(undefined);
    setMode(nextMode);
    if (nextMode !== 'direct') setWallet('');
    return true;
  }

  function chooseTier(nextTier: number) {
    if (
      capabilityState.status !== 'ready' ||
      !enabledPackForTier(capabilityState.value, nextTier)
    ) {
      setActionError('That pack tier is not currently playable.');
      return;
    }
    setTier(nextTier);
    const trackedTier = toTrackedTier(nextTier);
    if (trackedTier) trackProductEvent({ name: 'tier_selected', tier: trackedTier });
    if (activeEntry?.action === 'accept') setActiveEntry(undefined);
  }

  function handleModeTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentMode: Mode) {
    const currentIndex = availableModes.indexOf(currentMode);
    const nextIndex = getRovingTabIndex(currentIndex, event.key, availableModes.length);
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = availableModes[nextIndex];
    if (!nextMode) return;
    if (chooseMode(nextMode)) {
      window.requestAnimationFrame(() => modeTabRefs.current[nextMode]?.focus());
    }
  }

  useEffect(() => {
    trackProductEvent({ name: 'lobby_viewed' });
  }, []);

  useEffect(() => {
    const storedDraft = window.localStorage.getItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
    const draft = parseDuelEntryDraft(storedDraft);
    if (draft) {
      setMode(draft.mode);
      setTier(draft.tier);
      setWallet(draft.opponentAddress);
      setRecoveryDuelId(draft.duelId);
      setRestoreDraftPending(Boolean(draft.duelId));
      setFundingPhase(draft.broadcastPending ? 'recovering' : 'idle');
      setEntryFlowOpen(true);
      setActionNotice(
        draft.duelId
          ? 'Your saved duel entry was restored. Reconnect and verify ownership to resume safely.'
          : 'Your selected duel entry was restored. Continue from the last safe step.',
      );
    } else if (storedDraft) {
      window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
    }
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!draftRestored || (!entryFlowOpen && !persistedDuel && !matchmakingSession)) return;
    if (persistedDuel && completedEntryStatuses.has(persistedDuel.status)) return;
    const nextDuelId = persistedDuel?.id ?? matchmakingSession?.duelId ?? recoveryDuelId;
    window.localStorage.setItem(
      DUEL_ENTRY_DRAFT_STORAGE_KEY,
      JSON.stringify(
        createDuelEntryDraft({
          broadcastPending:
            fundingPhase === 'signing' ||
            fundingPhase === 'confirming' ||
            fundingPhase === 'recovering',
          duelId: nextDuelId,
          mode,
          opponentAddress: wallet,
          tier: toDraftTier(tier),
        }),
      ),
    );
    if (nextDuelId && nextDuelId !== recoveryDuelId) setRecoveryDuelId(nextDuelId);
  }, [
    draftRestored,
    entryFlowOpen,
    fundingPhase,
    matchmakingSession,
    mode,
    persistedDuel,
    recoveryDuelId,
    tier,
    wallet,
  ]);

  useEffect(() => {
    if (
      !recoveryDuelId ||
      !restoreDraftPending ||
      !authentication.sessionToken ||
      !walletConnection.address ||
      fundingPhase === 'signing' ||
      fundingPhase === 'confirming'
    ) {
      return;
    }
    const recoveryKey = `${recoveryDuelId}:${walletConnection.address}:${authentication.sessionToken}:${fundingPhase}:${recoveryAttempt}`;
    if (duelRecoveryKey.current === recoveryKey) return;
    duelRecoveryKey.current = recoveryKey;
    let active = true;
    setRestorePending(true);
    setActionError(null);
    restoreDuelEntry({
      duelId: recoveryDuelId,
      fundingPossiblyBroadcast: fundingPhase === 'recovering',
      loadDuel: getDuel,
      prepareIntent: prepareDuelIntent,
      sessionToken: authentication.sessionToken,
      wallet: walletConnection.address,
    })
      .then(({ duel, intent: restoredIntent }) => {
        if (!active) return;
        setRestorePending(false);
        setRestoreDraftPending(false);
        setPersistedDuel(duel);
        setIntent(restoredIntent);
        if (restoredIntent) {
          setActionNotice('Saved funding restored with a fresh, unsigned transaction review.');
        } else {
          setActionNotice(`Saved duel restored at ${duel.status.replaceAll('_', ' ')}.`);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRestorePending(false);
        duelRecoveryKey.current = null;
        setActionError(
          error instanceof Error ? error.message : 'The saved duel could not be restored.',
        );
      });
    return () => {
      active = false;
      setRestorePending(false);
    };
  }, [
    authentication.sessionToken,
    fundingPhase,
    recoveryAttempt,
    recoveryDuelId,
    restoreDraftPending,
    walletConnection.address,
  ]);

  useEffect(() => {
    if (!persistedDuel || !completedEntryStatuses.has(persistedDuel.status)) {
      return;
    }
    window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
    setRecoveryDuelId(null);
  }, [persistedDuel]);

  useEffect(() => {
    void capabilityReload;
    let active = true;
    setCapabilityState({ status: 'loading' });
    getProductCapabilities()
      .then((nextCapabilities) => {
        if (active) setCapabilityState({ status: 'ready', value: nextCapabilities });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCapabilityState({
          message:
            error instanceof Error ? error.message : 'Product capabilities could not be verified.',
          retryable: isDuelApiConfigured(),
          status: 'error',
        });
      });
    return () => {
      active = false;
    };
  }, [capabilityReload]);

  useEffect(() => {
    if (capabilityState.status !== 'ready') return;
    const nextCapabilities = capabilityState.value;
    const resolved = resolveLobbySelection(nextCapabilities, { mode, tier });

    if (resolved.mode !== mode) {
      setMode(resolved.mode);
      if (mode === 'house') setActiveEntry(undefined);
      setActionNotice(resolved.modeReason ?? 'The requested duel mode is not currently playable.');
    }

    if (resolved.tier !== tier) {
      if (activeEntry) {
        setActiveEntry(undefined);
        setActionError(
          resolved.pack
            ? `The shared $${tier} pack tier cannot be played. The supported $${resolved.pack.tier} pack is selected for a new duel.`
            : `The shared $${tier} pack tier is not currently playable.`,
        );
      }
      setTier(resolved.tier);
    }
  }, [activeEntry, capabilityState, mode, tier]);

  useEffect(() => {
    if (!persistedDuel) return;
    const trackedTier = toTrackedTier(tier);
    const trackedMode = toTrackedMode(mode);
    if (phase === 'opening') {
      trackProductEvent({
        duelId: persistedDuel.id,
        mode: trackedMode,
        name: 'pack_reveal_started',
        status: 'opening',
        ...(trackedTier ? { tier: trackedTier } : {}),
      });
    }
  }, [mode, persistedDuel, phase, tier]);

  useEffect(() => {
    if (!actionError) return;
    const trackedTier = toTrackedTier(tier);
    trackProductEvent({
      ...(persistedDuel ? { duelId: persistedDuel.id, status: persistedDuel.status } : {}),
      mode: toTrackedMode(mode),
      name: 'ui_error',
      ...(trackedTier ? { tier: trackedTier } : {}),
    });
  }, [actionError, mode, persistedDuel, tier]);

  useEffect(() => {
    if (!persistedDuel || terminalDuelStatuses.has(persistedDuel.status)) return;
    let active = true;
    const interval = window.setInterval(() => {
      getDuel(persistedDuel.id)
        .then((duel) => {
          if (active) setPersistedDuel(duel);
        })
        .catch(() => undefined);
    }, 3_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [persistedDuel]);

  useEffect(() => {
    if (
      persistedDuel?.status !== 'funded' ||
      !authentication.sessionToken ||
      !walletConnection.address ||
      ![persistedDuel.creatorWallet, persistedDuel.opponentWallet].includes(
        walletConnection.address,
      )
    ) {
      return;
    }
    const advanceKey = `${persistedDuel.id}:${persistedDuel.version}`;
    if (lifecycleAdvanceKey.current === advanceKey) return;
    lifecycleAdvanceKey.current = advanceKey;
    let active = true;
    advanceDuelLifecycle(persistedDuel.id, authentication.sessionToken)
      .then((duel) => {
        if (!active) return;
        setPersistedDuel(duel);
        setActionNotice('Both packs are funded. Opening the committed devnet outcomes.');
      })
      .catch((error: unknown) => {
        if (!active) return;
        lifecycleAdvanceKey.current = null;
        setActionError(error instanceof Error ? error.message : 'Could not open both packs.');
      });
    return () => {
      active = false;
    };
  }, [authentication.sessionToken, persistedDuel, walletConnection.address]);

  useEffect(() => {
    if (
      !persistedDuel ||
      !authentication.sessionToken ||
      !['committing', 'settling', 'cancelling', 'refunding'].includes(persistedDuel.status)
    ) {
      return;
    }
    let active = true;
    const poll = () => {
      reconcileDuelTransactions(persistedDuel.id, authentication.sessionToken as string)
        .then(() => getDuel(persistedDuel.id))
        .then((duel) => {
          if (active) setPersistedDuel(duel);
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(poll, 4_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authentication.sessionToken, persistedDuel]);

  useEffect(() => {
    if (
      matchmakingSession ||
      !authentication.sessionToken ||
      !walletConnection.address ||
      !isDuelApiConfigured()
    ) {
      return;
    }
    const restoreKey = `${walletConnection.address}:${authentication.sessionToken}`;
    if (matchmakingRestoreKey.current === restoreKey) return;
    matchmakingRestoreKey.current = restoreKey;
    let active = true;
    setMatchmakingRestorePending(true);
    getOpenMatchmakingStatus(walletConnection.address, authentication.sessionToken)
      .then((session) => {
        if (active && session) {
          setActiveEntry(undefined);
          setMode(session.houseOpponent ? 'house' : 'matchmaking');
          setMatchmakingSession((current) =>
            current?.duelId === session.duelId &&
            current.state === session.state &&
            current.opponentWallet === session.opponentWallet &&
            current.houseOpponent === session.houseOpponent
              ? current
              : session,
          );
          setActionNotice('Your existing public matchmaking ticket was restored.');
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (matchmakingRestoreKey.current === restoreKey) {
          setMatchmakingRestorePending(false);
        }
      });
    return () => {
      active = false;
    };
  }, [authentication.sessionToken, matchmakingSession, walletConnection.address]);

  useEffect(() => {
    if (!matchmakingSession || !authentication.sessionToken || !walletConnection.address) {
      return;
    }
    let active = true;
    const poll = () => {
      getOpenMatchmakingStatus(
        walletConnection.address as string,
        authentication.sessionToken as string,
      )
        .then(async (session) => {
          if (!active) return;
          if (!session) {
            const duel = await getDuel(matchmakingSession.duelId).catch(() => null);
            if (!active) return;
            setMatchmakingSession(null);
            setPersistedDuel(duel);
            setActionNotice(
              duel && duel.status !== 'cancelled'
                ? `Matchmaking completed with duel status: ${duel.status}.`
                : 'The matchmaking search ended before funding. Start a new search when ready.',
            );
            return;
          }
          setMatchmakingSession((current) =>
            current?.duelId === session.duelId &&
            current.state === session.state &&
            current.opponentWallet === session.opponentWallet &&
            current.houseOpponent === session.houseOpponent
              ? current
              : session,
          );
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(poll, 3_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authentication.sessionToken, matchmakingSession, walletConnection.address]);

  useEffect(() => {
    if (!matchmakingSession || !authentication.sessionToken || !walletConnection.address) return;
    let active = true;
    getDuel(matchmakingSession.duelId)
      .then(async (duel) => {
        if (!active) return;
        setPersistedDuel(duel);
        if (matchmakingSession.state !== 'matched') return;
        if (duel.creatorWallet === walletConnection.address && duel.status === 'matched') {
          const prepared = await prepareDuelIntent(
            duel.id,
            walletConnection.address,
            authentication.sessionToken as string,
          );
          if (active) setIntent(prepared);
        } else if (active) {
          setActionNotice('Opponent found. The creator must initialize and fund escrow first.');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setActionError(error instanceof Error ? error.message : 'Could not restore matchmaking.');
        }
      });
    return () => {
      active = false;
    };
  }, [authentication.sessionToken, matchmakingSession, walletConnection.address]);

  async function reviewDuel(nextTier = tier, nextMode = mode) {
    setActionError(null);
    setActionNotice(null);
    if (capabilityState.status !== 'ready') {
      setActionError('Duel availability could not be verified. Retry before continuing.');
      return;
    }
    const nextModeCapability = capabilityForMode(capabilityState.value, nextMode);
    if (!nextModeCapability.enabled) {
      setActionError(nextModeCapability.reason ?? 'That duel mode is not currently playable.');
      return;
    }
    const nextPack = enabledPackForTier(capabilityState.value, nextTier);
    if (!nextPack) {
      setActionError('That pack tier is not currently playable.');
      return;
    }
    setTier(nextTier);
    setMode(nextMode);
    const expectedRestoreKey =
      walletConnection.address && authentication.sessionToken
        ? `${walletConnection.address}:${authentication.sessionToken}`
        : null;
    if (
      isDuelApiConfigured() &&
      expectedRestoreKey &&
      matchmakingRestoreKey.current !== expectedRestoreKey
    ) {
      setActionError('Wait while we check this wallet for an active matchmaking ticket.');
      return;
    }
    if (matchmakingRestorePending) {
      setActionError('Wait while we restore any active public matchmaking ticket.');
      return;
    }
    if (matchmakingSession) {
      setActionError('Use or cancel the active matchmaking session before starting another duel.');
      return;
    }
    if (!walletConnection.address) {
      setActionError('Connect a Solana wallet from the top-right button before funding a duel.');
      return;
    }
    if (walletConnection.networkStatus === 'offline') {
      setActionError(
        'Solana devnet RPC is unavailable. Wait for the network to recover and retry.',
      );
      return;
    }
    if (nextMode === 'direct' && wallet.trim().length < 32) {
      setActionError('Enter a complete Solana wallet address for the opponent.');
      return;
    }
    if (isDuelApiConfigured() && !authentication.sessionToken) {
      setActionError(
        'Authenticate wallet ownership from the top-right wallet menu before creating or joining a duel.',
      );
      return;
    }
    setIntentPending(true);
    try {
      if (isDuelApiConfigured() && authentication.sessionToken && walletConnection.address) {
        if (nextMode === 'matchmaking') {
          const session = await searchOpenMatchmaking(
            walletConnection.address,
            authentication.sessionToken,
            nextPack.id,
          );
          setMatchmakingSession(session);
          setActionNotice(
            session.state === 'matched'
              ? 'Opponent found. Preparing the creator funding review.'
              : `Searching the exact $${nextPack.tier} tier and valuation-policy queue.`,
          );
          return;
        }
        const duel =
          activeEntry?.action === 'accept'
            ? await joinDuel(
                activeEntry.duelId,
                walletConnection.address,
                authentication.sessionToken,
              )
            : await createDuel(
                {
                  creatorWallet: walletConnection.address,
                  matchmakingMode: nextMode,
                  ...(nextMode === 'direct' ? { opponentWallet: wallet.trim() } : {}),
                  packId: nextPack.id,
                },
                authentication.sessionToken,
              );
        setPersistedDuel(duel);
        if (duel.status === 'matched' && duel.creatorWallet === walletConnection.address) {
          setIntent(
            await prepareDuelIntent(duel.id, walletConnection.address, authentication.sessionToken),
          );
        } else if (duel.status === 'matched') {
          setActionNotice('Challenge accepted. The creator must initialize and fund escrow first.');
        }
        return;
      }
      throw new Error('The devnet duel API is not configured. No transaction was prepared.');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not prepare the devnet transaction intent.',
      );
    } finally {
      setIntentPending(false);
    }
  }

  async function reviewPersistedFunding(): Promise<void> {
    if (!persistedDuel || !authentication.sessionToken || !walletConnection.address) return;
    setIntentPending(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const refreshed = await getDuel(persistedDuel.id);
      setPersistedDuel(refreshed);
      setIntent(
        await prepareDuelIntent(
          refreshed.id,
          walletConnection.address,
          authentication.sessionToken,
        ),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not prepare the funding transaction.',
      );
    } finally {
      setIntentPending(false);
    }
  }

  async function cancelPersistedDuel(): Promise<boolean> {
    if (!authentication.sessionToken || !walletConnection.address) return false;
    setIntentPending(true);
    setActionError(null);
    try {
      const target = getDuelEntryCancellationTarget(persistedDuel, Boolean(matchmakingSession));
      if (target === 'matchmaking') {
        await cancelOpenMatchmaking(walletConnection.address, authentication.sessionToken);
        setMatchmakingSession(null);
        setPersistedDuel(null);
        setActionNotice('Public matchmaking cancelled before funding.');
        return true;
      }
      if (target !== 'duel' || !persistedDuel) return false;
      const cancelled = await cancelDuel(
        persistedDuel.id,
        walletConnection.address,
        authentication.sessionToken,
        'player_cancelled_before_funding',
      );
      setPersistedDuel(cancelled);
      return true;
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not cancel the persisted devnet duel.',
      );
      return false;
    } finally {
      setIntentPending(false);
    }
  }

  async function continueMatchmaking(): Promise<void> {
    if (!authentication.sessionToken || !walletConnection.address || !matchmakingSession) return;
    setIntentPending(true);
    setActionError(null);
    try {
      const session = await continueOpenMatchmaking(
        walletConnection.address,
        authentication.sessionToken,
        matchmakingSession.queue.packId,
      );
      setMatchmakingSession(session);
      setActionNotice('Search continues in the same exact queue.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not continue matchmaking.');
    } finally {
      setIntentPending(false);
    }
  }

  async function chooseHouseFallback(): Promise<void> {
    if (!authentication.sessionToken || !walletConnection.address) return;
    if (!houseFallbackEnabled) {
      setActionError('House fallback is unavailable until API readiness is verified.');
      return;
    }
    setIntentPending(true);
    setActionError(null);
    try {
      const session = await selectHouseFallback(
        walletConnection.address,
        authentication.sessionToken,
      );
      setMatchmakingSession(session);
      setMode('house');
      setActionNotice('House opponent explicitly selected. Preparing creator funding review.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'House fallback is unavailable.');
    } finally {
      setIntentPending(false);
    }
  }

  async function approveIntent() {
    if (!intent || !authentication.sessionToken) return;
    setIntentPending(true);
    setFundingPhase('signing');
    setActionError(null);
    window.localStorage.setItem(
      DUEL_ENTRY_DRAFT_STORAGE_KEY,
      JSON.stringify(
        createDuelEntryDraft({
          broadcastPending: true,
          duelId: persistedDuel?.id ?? intent.duelId,
          mode,
          opponentAddress: wallet,
          tier: toDraftTier(tier),
        }),
      ),
    );
    try {
      const binary = window.atob(intent.serializedTransactionBase64);
      const transaction = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const signature = await walletConnection.signAndSendTransaction(transaction);
      setFundingPhase('confirming');
      await submitSignedDuelIntent(
        intent.duelId,
        intent.id,
        signature,
        authentication.sessionToken,
      );
      setActionNotice('Funding broadcast on Solana devnet. Verifying finalized escrow state…');
      await reconcileBroadcastFunding(intent.duelId, authentication.sessionToken);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The wallet did not approve the transaction.',
      );
      if (error instanceof WalletTransactionNotBroadcastError) {
        setFundingPhase('idle');
        window.localStorage.setItem(
          DUEL_ENTRY_DRAFT_STORAGE_KEY,
          JSON.stringify(
            createDuelEntryDraft({
              broadcastPending: false,
              duelId: persistedDuel?.id ?? intent.duelId,
              mode,
              opponentAddress: wallet,
              tier: toDraftTier(tier),
            }),
          ),
        );
      } else {
        setFundingPhase('recovering');
      }
    } finally {
      setIntentPending(false);
    }
  }

  async function resumeBroadcastConfirmation(): Promise<void> {
    const duelId = intent?.duelId ?? recoveryDuelId;
    if (!duelId || !authentication.sessionToken) return;
    setIntentPending(true);
    setFundingPhase('confirming');
    setActionError(null);
    try {
      await reconcileBroadcastFunding(duelId, authentication.sessionToken);
    } catch (error) {
      setFundingPhase('recovering');
      setActionError(
        error instanceof Error
          ? error.message
          : 'The broadcast transaction could not be reconciled yet.',
      );
    } finally {
      setIntentPending(false);
    }
  }

  async function reconcileBroadcastFunding(duelId: string, sessionToken: string): Promise<void> {
    const reconciliation = await waitForDuelTransactions(duelId, sessionToken);
    const refreshed = await getDuel(duelId);
    setPersistedDuel(refreshed);
    const outcome = classifyPostBroadcastRecovery(
      refreshed,
      reconciliation.activeTransactionCount,
      reconciliation.unboundTransactionCount,
    );
    if (outcome === 'still-confirming') {
      setFundingPhase('recovering');
      setActionNotice(
        'The original transaction is still pending. Resume confirmation later without signing again.',
      );
      return;
    }
    if (outcome === 'retry-safe') {
      if (!walletConnection.address) throw new Error('Reconnect the funding wallet to continue.');
      const refreshedIntent = await prepareDuelIntent(
        duelId,
        walletConnection.address,
        sessionToken,
      );
      setIntent(refreshedIntent);
      setFundingPhase('idle');
      setActionNotice(
        'No broadcast funding remains active. Review the fresh fee before choosing whether to sign again.',
      );
      return;
    }
    setIntent(null);
    setFundingPhase('idle');
    setActionNotice(fundingReconciliationNotice(refreshed, 0));
  }

  async function cancelGuidedEntry(): Promise<void> {
    if (persistedDuel || matchmakingSession) {
      const cancelled = await cancelPersistedDuel();
      if (!cancelled) return;
    }
    window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
    setRecoveryDuelId(null);
    setIntent(null);
    setPersistedDuel(null);
    setMatchmakingSession(null);
    setEntryFlowOpen(false);
    setActionNotice(persistedDuel || matchmakingSession ? 'Duel entry cancelled.' : null);
  }

  async function resumeGuidedEntry(): Promise<void> {
    if (fundingPhase === 'recovering') {
      await resumeBroadcastConfirmation();
      return;
    }
    if (persistedDuel) {
      await reviewPersistedFunding();
      return;
    }
    if (recoveryDuelId) {
      duelRecoveryKey.current = null;
      setRestoreDraftPending(true);
      setRecoveryAttempt((current) => current + 1);
      return;
    }
    await reviewDuel();
  }

  function resetDuel(rematch = false) {
    if (rematch) {
      const trackedTier = toTrackedTier(tier);
      trackProductEvent({
        ...(persistedDuel ? { duelId: persistedDuel.id } : {}),
        mode: toTrackedMode(mode),
        name: 'duel_rematched',
        ...(trackedTier ? { tier: trackedTier } : {}),
      });
      setActionNotice('Rematch ready. Review and approve a fresh transaction to continue.');
    }
    setPersistedDuel(null);
    setMatchmakingSession(null);
    setIntent(null);
    setEntryFlowOpen(false);
    setRecoveryDuelId(null);
    window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
  }

  function shareResult() {
    if (!persistedDuel || !liveDuel?.left || !liveDuel.right || !liveDuel.winner) return;
    const winningPull =
      liveDuel.winner === 'you'
        ? liveDuel.left
        : liveDuel.winner === 'opponent'
          ? liveDuel.right
          : null;
    const text = winningPull
      ? `${liveDuel.winner === 'you' ? 'I just won' : 'This duel was decided'} with ${winningPull.name} valued at ${winningPull.value} in a ${liveDuel.tier} Pack Duel.`
      : `This ${liveDuel.tier} Pack Duel ended in a tie.`;
    const shareUrl = `${window.location.origin}/duel/${encodeURIComponent(persistedDuel.id)}?status=${persistedDuel.status}`;
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'noopener,noreferrer',
    );
    const trackedTier = toTrackedTier(tier);
    trackProductEvent({
      ...(persistedDuel ? { duelId: persistedDuel.id, status: persistedDuel.status } : {}),
      mode: toTrackedMode(mode),
      name: 'duel_shared',
      ...(trackedTier ? { tier: trackedTier } : {}),
    });
  }

  if (phase !== 'lobby' && liveDuel && persistedDuel) {
    return (
      <main className="duel-experience" data-testid={journeyTestIds.battle}>
        <div className="duel-topline">
          <button
            type="button"
            className="text-button"
            onClick={() => resetDuel()}
            data-testid={journeyTestIds.battleBack}
          >
            <ArrowCounterClockwiseIcon size={15} /> Back to lobby
          </button>
          <div className="duel-proof">
            <ShieldCheckIcon size={15} weight="fill" />
            <span>Devnet settlement</span>
            <code data-testid={journeyTestIds.settlementReference}>
              {shortReference(liveDuel.settlementReference) ?? 'Awaiting escrow'}
            </code>
          </div>
        </div>

        <section className="battle-shell" aria-live="polite">
          <div className="battle-heading">
            <div>
              <span className="eyebrow">
                <SwordIcon size={14} weight="fill" /> {liveDuel.tier} Pack Duel
              </span>
              <h1 data-testid={journeyTestIds.duelHeadline}>{liveDuel.headline}</h1>
            </div>
            <div
              className={`phase-indicator phase-${phase}`}
              data-testid={journeyTestIds.duelPhase}
            >
              <span />
              {liveDuel.indicator}
            </div>
          </div>
          {actionError ? (
            <p className="duel-action-error" role="alert" data-testid={journeyTestIds.error}>
              <WarningCircleIcon size={14} weight="fill" /> {actionError}
            </p>
          ) : null}
          {actionNotice ? <p className="signing-note">{actionNotice}</p> : null}

          <div className="reveal-grid">
            <DuelCard
              pull={liveDuel.left}
              side="you"
              phase={phase}
              winner={liveDuel.winner === 'you'}
              tier={liveDuel.tier}
              walletLabel={walletConnection.shortAddress ?? 'Your wallet'}
            />
            <div className="versus-mark" aria-hidden="true">
              <span>VS</span>
            </div>
            <DuelCard
              pull={liveDuel.right}
              side="opponent"
              phase={phase}
              winner={liveDuel.winner === 'opponent'}
              tier={liveDuel.tier}
              walletLabel={
                persistedDuel.houseOpponent
                  ? 'Pack Duel House'
                  : (shortReference(
                      walletConnection.address === persistedDuel.opponentWallet
                        ? persistedDuel.creatorWallet
                        : persistedDuel.opponentWallet,
                    ) ?? 'Opponent wallet')
              }
            />
          </div>

          {phase === 'result' ? (
            <div className="result-panel">
              <div className="result-summary">
                <TrophyIcon size={24} weight="fill" />
                <div>
                  <small>Winning margin</small>
                  <strong data-testid={journeyTestIds.resultMargin}>
                    {liveDuel.margin ?? '—'}
                  </strong>
                </div>
                <Separator orientation="vertical" className="h-9 bg-border" />
                <div>
                  <small>Total prize value</small>
                  <strong data-testid={journeyTestIds.resultTotalValue}>
                    {liveDuel.totalValue ?? '—'}
                  </strong>
                </div>
              </div>
              <div className="result-actions">
                {persistedDuel.status === 'settled' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => resetDuel(true)}
                    data-testid={journeyTestIds.resultRematch}
                  >
                    <ArrowsLeftRightIcon size={16} /> Rematch
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="share-button"
                  onClick={shareResult}
                  data-testid={journeyTestIds.resultShare}
                >
                  <XLogoIcon size={16} weight="fill" /> Share result
                </Button>
              </div>
            </div>
          ) : (
            <div className="opening-timeline" aria-hidden="true">
              <span className="timeline-complete">
                <CheckCircleIcon size={14} weight="fill" /> Matched
              </span>
              <span className="timeline-line">
                <i />
              </span>
              <span className={phase === 'opening' ? 'timeline-active' : ''}>
                <FireIcon size={14} weight="fill" /> Opening
              </span>
              <span className="timeline-line">
                <i />
              </span>
              <span>
                <LockKeyIcon size={14} /> Settle
              </span>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="lobby-shell" data-testid={journeyTestIds.lobby}>
      <section className="lobby-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <LightningIcon size={14} weight="fill" /> Solana devnet MVP
          </span>
          <h1>
            Rip together.
            <br />
            <em>Winner takes all.</em>
          </h1>
          <p>
            Two wallets. Two authenticated packs. The higher-value pull wins every card in the duel.
          </p>
          <div className="hero-proof-row">
            <span>
              <LockKeyIcon size={15} /> Devnet escrow
            </span>
            <span>
              <ShieldCheckIcon size={15} /> Committed card value
            </span>
            <span>
              <FireIcon size={15} /> Synchronized reveal
            </span>
          </div>
        </div>

        <Card className="match-card border-border bg-secondary">
          <CardContent className="p-0">
            {capabilities && capabilityFormReady ? (
              <>
                <DuelModeTabs
                  capabilities={capabilities}
                  disabled={false}
                  mode={mode}
                  onSelect={chooseMode}
                  onKeyDown={handleModeTabKeyDown}
                  registerTab={(tabMode, element) => {
                    modeTabRefs.current[tabMode] = element ?? undefined;
                  }}
                />

                <div className="match-card-body">
                  <PackTierChoices
                    capabilities={capabilities}
                    locked={activeEntry?.action === 'accept'}
                    onSelect={chooseTier}
                    selectedTier={tier}
                  />

                  <div
                    id="mode-panel-direct"
                    className="mode-panel"
                    role="tabpanel"
                    aria-labelledby="mode-tab-direct"
                    tabIndex={mode === 'direct' ? 0 : -1}
                    hidden={mode !== 'direct'}
                  >
                    <div className="wallet-challenge-panel">
                      {activeEntry ? (
                        <div className="opponent-disclosure">
                          <UserPlusIcon size={18} weight="fill" />
                          <span>
                            <strong>
                              {activeEntry.action === 'accept'
                                ? `Challenge from ${activeEntry.opponentLabel}`
                                : `Rematch against ${activeEntry.opponentLabel}`}
                            </strong>
                            {activeEntry.action === 'accept'
                              ? `This link reserves the $${activeEntry.tier} direct-wallet seat. Choose another mode to leave it.`
                              : `The original $${activeEntry.tier} tier and opponent are ready for a fresh commitment.`}
                          </span>
                        </div>
                      ) : null}
                      <label htmlFor="opponent-wallet">
                        {activeEntry ? 'Opponent from shared duel' : 'Opponent wallet'}
                      </label>
                      <div className="wallet-input-row">
                        <Input
                          id="opponent-wallet"
                          value={wallet}
                          onChange={(event) => setWallet(event.target.value)}
                          placeholder="Solana wallet address"
                          className="wallet-input"
                          readOnly={Boolean(activeEntry)}
                          data-testid={journeyTestIds.opponentWallet}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    id="mode-panel-matchmaking"
                    className="mode-panel"
                    role="tabpanel"
                    aria-labelledby="mode-tab-matchmaking"
                    tabIndex={mode === 'matchmaking' ? 0 : -1}
                    hidden={mode !== 'matchmaking'}
                  >
                    <div className="opponent-disclosure">
                      <UsersThreeIcon size={18} weight="fill" />
                      <span>
                        <strong>Public wallet matchmaking</strong>
                        We match the exact tier and valuation policy. You can continue searching or
                        cancel before funding. House play is never selected automatically.
                      </span>
                    </div>
                  </div>

                  <div
                    id="mode-panel-house"
                    className="mode-panel"
                    role="tabpanel"
                    aria-labelledby="mode-tab-house"
                    tabIndex={mode === 'house' ? 0 : -1}
                    hidden={mode !== 'house'}
                  >
                    <div className="opponent-disclosure">
                      <ShieldCheckIcon size={18} weight="fill" />
                      <span>
                        <strong>
                          {activeEntry?.action === 'rematch'
                            ? 'House rematch ready'
                            : 'Instant house opponent'}
                        </strong>
                        {activeEntry?.action === 'rematch'
                          ? `The original $${activeEntry.tier} house tier is preselected for a fresh commitment.`
                          : 'The house funds the matching pack and must precommit before either reveal.'}
                      </span>
                    </div>
                  </div>

                  <div className="fee-summary">
                    <span>
                      Pack tier{' '}
                      <strong data-testid={journeyTestIds.entryTier}>${tier.toFixed(2)}</strong>
                    </span>
                    <span>
                      Pack purchase <strong>Later</strong>
                    </span>
                    <span>
                      Escrow now <strong>Fee only</strong>
                    </span>
                  </div>

                  <Button
                    type="button"
                    className="duel-cta"
                    onClick={() => {
                      setActionError(null);
                      setEntryFlowOpen(true);
                    }}
                    disabled={
                      intentPending ||
                      matchmakingRestorePending ||
                      Boolean(matchmakingSession) ||
                      !selectedPack ||
                      !selectedModeEnabled ||
                      (mode === 'direct' && wallet.trim().length === 0)
                    }
                    data-testid={journeyTestIds.primaryAction}
                  >
                    {intentPending ? (
                      <SpinnerGapIcon className="wallet-spinner" size={18} />
                    ) : mode === 'matchmaking' || mode === 'house' ? (
                      <LightningIcon size={18} weight="fill" />
                    ) : (
                      <LinkIcon size={18} weight="bold" />
                    )}
                    {intentPending
                      ? 'Preparing devnet intent'
                      : mode === 'direct'
                        ? activeEntry?.action === 'accept'
                          ? `Accept $${tier} challenge`
                          : activeEntry?.action === 'rematch'
                            ? `Review $${tier} rematch`
                            : `Create $${tier} challenge`
                        : mode === 'house'
                          ? activeEntry?.action === 'rematch'
                            ? `Review $${tier} house rematch`
                            : `Play house for $${tier}`
                          : `Find a $${tier} duel`}
                  </Button>
                  <p className="signing-note">
                    <InfoIcon size={13} /> Every devnet signature is preceded by an explicit
                    transaction review.
                  </p>
                  {actionError ? (
                    <p
                      className="duel-action-error"
                      role="alert"
                      data-testid={journeyTestIds.error}
                    >
                      <WarningCircleIcon size={14} weight="fill" /> {actionError}
                    </p>
                  ) : null}
                  {actionNotice ? <p className="signing-note">{actionNotice}</p> : null}
                </div>
              </>
            ) : (
              <div className="match-card-body">
                <ProductCapabilityPanel
                  state={capabilityState}
                  onRetry={() => {
                    setActionError(null);
                    setCapabilityReload((value) => value + 1);
                  }}
                />
            </div>
            )}
          </CardContent>
        </Card>
      </section>

      {persistedDuel ? (
        <section
          className="persisted-duel-panel"
          role="status"
          data-testid={journeyTestIds.persistedDuel}
        >
          <div>
            <span className="eyebrow">
              <ShieldCheckIcon size={14} weight="fill" /> Durable devnet duel
            </span>
            <h2>{persistedStatusHeadline(persistedDuel.status, Boolean(matchmakingSession))}</h2>
            <p>
              <code>{persistedDuel.id}</code> is persisted by the API. This screen follows its
              canonical status and displays card outcomes only after the API commits both results.
            </p>
            {matchmakingSession ? (
              <p>
                Queue: ${matchmakingSession.queue.tier} · {matchmakingSession.queue.regionSegment} ·{' '}
                {matchmakingSession.queue.riskSegment}. {matchmakingSession.cancellationRule}{' '}
                {houseFallbackAction?.disclosure}
              </p>
            ) : null}
          </div>
          <div className="persisted-duel-actions">
            {matchmakingSession?.state === 'searching' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={continueMatchmaking}
                disabled={intentPending}
                data-testid={journeyTestIds.persistedDuelContinue}
              >
                {intentPending ? <SpinnerGapIcon className="wallet-spinner" size={16} /> : null}
                Continue search
              </Button>
            ) : null}
            {matchmakingSession?.state === 'searching' &&
            houseFallbackAction?.available &&
            houseFallbackEnabled ? (
              <Button
                type="button"
                variant="ghost"
                onClick={chooseHouseFallback}
                disabled={intentPending}
                data-testid={journeyTestIds.persistedDuelHouse}
              >
                <ShieldCheckIcon size={16} weight="fill" /> Select disclosed house
              </Button>
            ) : null}
            {(persistedDuel.status === 'matched' &&
              persistedDuel.creatorWallet === walletConnection.address) ||
            (persistedDuel.status === 'committing' &&
              persistedDuel.opponentWallet === walletConnection.address) ? (
              <Button
                type="button"
                onClick={async () => {
                  setEntryFlowOpen(true);
                  await reviewPersistedFunding();
                }}
                disabled={intentPending}
                data-testid={journeyTestIds.persistedDuelFund}
              >
                {intentPending ? <SpinnerGapIcon className="wallet-spinner" size={16} /> : null}
                Review platform fee
              </Button>
            ) : null}
            {persistedDuel.status === 'waiting' && !matchmakingSession ? (
              <Button
                type="button"
                variant="ghost"
                data-testid={journeyTestIds.persistedDuelCopy}
                onClick={async () => {
                  const challengeUrl = `${window.location.origin}/overview?challenge=${encodeURIComponent(persistedDuel.id)}`;
                  await navigator.clipboard.writeText(challengeUrl);
                  const trackedTier = toTrackedTier(tier);
                  trackProductEvent({
                    duelId: persistedDuel.id,
                    mode: persistedDuel.matchmakingMode,
                    name: 'duel_shared',
                    status: persistedDuel.status,
                    ...(trackedTier ? { tier: trackedTier } : {}),
                  });
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <CheckCircleIcon size={16} weight="fill" /> : <CopyIcon size={16} />}
                {copied ? 'Copied challenge' : 'Copy challenge'}
              </Button>
            ) : null}
            {persistedDuel.status === 'waiting' || persistedDuel.status === 'matched' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={cancelGuidedEntry}
                disabled={intentPending}
                data-testid={journeyTestIds.persistedDuelCancel}
              >
                {intentPending ? <SpinnerGapIcon className="wallet-spinner" size={16} /> : null}
                Cancel duel
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPersistedDuel(null)}
                data-testid={journeyTestIds.persistedDuelRestart}
              >
                Start another duel
              </Button>
            )}
          </div>
        </section>
      ) : null}

      <section className="rules-strip">
        <div>
          <span>01</span>
          <strong>Pick a pack</strong>
          <small>Both wallets fund the same tier</small>
        </div>
        <div>
          <span>02</span>
          <strong>Rip together</strong>
          <small>Pulls reveal on the same beat</small>
        </div>
        <div>
          <span>03</span>
          <strong>Winner takes all</strong>
          <small>Higher verified value gets both cards</small>
        </div>
      </section>
      {entryFlowOpen ? (
        <DuelEntryStepper
          mode={mode}
          tier={tier}
          intent={intent}
          pending={intentPending || restorePending}
          fundingPhase={fundingPhase}
          error={actionError}
          notice={actionNotice}
          onClose={() => {
            if (
              !intentPending &&
              !restorePending &&
              fundingPhase !== 'signing' &&
              fundingPhase !== 'confirming'
            ) {
              setEntryFlowOpen(false);
            }
          }}
          onCancel={cancelGuidedEntry}
          onPrepare={() => reviewDuel()}
          onConfirm={approveIntent}
          onResume={resumeGuidedEntry}
          persistedDuel={persistedDuel}
        />
      ) : null}
    </main>
  );
}

function fundingReconciliationNotice(duel: DurableDuel, activeTransactionCount: number): string {
  if (activeTransactionCount > 0) {
    return 'Funding is still confirming on Solana devnet. This wallet can resume verification without a background worker.';
  }
  if (duel.status === 'funded') return 'Both escrow deposits are finalized. The duel is funded.';
  if (duel.status === 'committing') {
    return 'Your escrow deposit is finalized. Waiting for the other wallet to fund.';
  }
  return `Funding reconciliation completed with duel status: ${duel.status}.`;
}

function toTrackedMode(mode: Mode): 'direct' | 'house' | 'open' {
  return mode === 'matchmaking' ? 'open' : mode;
}

function toTrackedTier(tier: number): 25 | 50 | 100 | undefined {
  if (tier === 25 || tier === 50 || tier === 100) return tier;
  return undefined;
}

function toDraftTier(tier: number): 25 | 50 | 100 {
  return toTrackedTier(tier) ?? 50;
}

function shortReference(value?: string | null): string | null {
  if (!value) return null;
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function persistedStatusHeadline(
  status: DurableDuel['status'],
  hasMatchmakingSession: boolean,
): string {
  const headlines: Record<DurableDuel['status'], string> = {
    awaiting_assets: 'Pulls committed; card assets pending',
    cancelled: 'Duel cancelled before settlement',
    cancelling: 'Duel cancellation is finalizing',
    committing: 'Escrow funding in progress',
    failed: 'Duel requires recovery',
    funded: 'Both platform fees finalized',
    matched: 'Both wallets are matched',
    opening: 'Both packs are opening',
    refunded: 'Both deposits were refunded',
    refunding: 'Refund transactions are finalizing',
    settled: 'Duel settled from committed outcomes',
    settling: 'Winner settlement is finalizing',
    waiting: hasMatchmakingSession
      ? 'Searching the exact public queue'
      : 'Challenge created and waiting',
  };
  return headlines[status];
}
