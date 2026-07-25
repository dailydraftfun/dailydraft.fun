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
  ShareNetworkIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  SwordIcon,
  TrophyIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XLogoIcon,
} from '@phosphor-icons/react';
import { Button, Card, CardContent, Separator } from '@shipshitdev/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getRovingTabIndex } from './accessibility/focus-navigation';
import { trackProductEvent } from './analytics-client';
import {
  clearStoredActiveDuel,
  readStoredActiveDuel,
  storeActiveDuel,
} from './duel/active-duel-storage';
import {
  battleEyebrowLabel,
  DUEL_SHARE_RESULT_TITLE,
  opponentWalletLabel,
} from './duel/duel-battle-copy';
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
import {
  type DuelGrowthParticipant,
  type DuelGrowthParticipants,
  rematchLabel,
  resolveRematchOpponent,
  resultShareText,
  viewerResult,
} from './duel/duel-growth';
import {
  duelRules,
  getDuelPlayerStatus,
  getFundingStatusNotice,
  getLobbyEconomicsCopy,
  getMatchmakingSearchCopy,
  getPlayerActionError,
} from './duel/duel-player-copy';
import { type LiveDuelPhase, type LivePull, toLiveDuelState } from './duel/live-duel-state';
import { shareNativeResult } from './duel/result-sharing';
import {
  parseStoredRevealTimeline,
  type RevealSideResolution,
  recoverRevealStartedAt,
  revealCommitmentCopy,
  revealPresentationAt,
  revealSideResolution,
  revealStorageKey,
  type StoredRevealTimeline,
} from './duel/reveal-presentation';
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
import { SharedOpponentControl, type SharedOpponentEntry } from './duel-shared-opponent';
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
  getPrivateRematchOpponent,
  getProductCapabilities,
  isRetryableDuelRequestError,
  joinDuel,
  type MatchmakingSession,
  prepareDuelIntent,
  reconcileDuelTransactions,
  recordRejectedDuelIntent,
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
type DuelCardStage = 'opening' | 'revealed' | 'sealed';

type DuelLobbyEntryBase = {
  duelId: string;
  mode: Mode;
};

export type DuelLobbyEntry = DuelLobbyEntryBase & SharedOpponentEntry;

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
const STILL_RECONCILING_PAYMENT =
  'The previous payment is still reconciling on Solana devnet. Retry shortly; no wallet prompt will open until it is safe.';

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
  stage,
  resolution,
  tier,
  walletLabel,
}: {
  pull: LivePull | null;
  side: 'you' | 'opponent';
  stage: DuelCardStage;
  resolution: RevealSideResolution | null;
  tier: string;
  walletLabel: string;
}) {
  const visible = stage === 'revealed' && pull !== null;
  const displayPull = visible ? pull : null;
  return (
    <article
      className={`reveal-column reveal-${side} ${resolution === 'winner' && visible ? 'reveal-winner' : ''}`}
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
        {resolution && visible ? (
          <span
            className={`result-chip result-${resolution}`}
            data-testid={
              resolution === 'winner'
                ? journeyTestIds.winner[side === 'you' ? 'you' : 'opponent']
                : undefined
            }
          >
            {resolution === 'winner' ? <TrophyIcon size={12} weight="fill" /> : null}
            {resolution === 'tie' ? <ArrowsLeftRightIcon size={12} weight="bold" /> : null}
            {resolution === 'winner' ? 'Winner' : resolution === 'tie' ? 'Tie' : 'Runner-up'}
          </span>
        ) : null}
      </div>

      <div className={`card-stage card-stage-${stage}`}>
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
          {displayPull?.image ? (
            <Image
              src={displayPull.image}
              alt={displayPull.name}
              fill
              sizes="(max-width: 768px) 42vw, 260px"
              className="pull-image"
              priority
            />
          ) : displayPull ? (
            <div className="pack-brand">
              <span>VERIFIED PULL</span>
              <strong>{displayPull.name}</strong>
              <small>{displayPull.label}</small>
            </div>
          ) : null}
        </div>
        {stage === 'opening' ? (
          <div className="opening-status" role="status">
            <span /> Opening pack
          </div>
        ) : null}
      </div>

      <div className={visible ? 'pull-meta pull-meta-visible' : 'pull-meta'} aria-hidden={!visible}>
        <span className="grade-chip" data-testid={journeyTestIds.provider[side]}>
          {displayPull?.provider ?? 'Pending'}
        </span>
        <div>
          <strong data-testid={journeyTestIds.pullName[side]}>
            {displayPull?.name ?? 'Result pending'}
          </strong>
          <small>{displayPull?.label ?? 'No outcome committed yet'}</small>
        </div>
        <span className="pull-value" data-testid={journeyTestIds.pullValue[side]}>
          {displayPull?.value ?? '—'}
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
  const [wallet, setWallet] = useState('');
  const [copied, setCopied] = useState(false);
  const [entryFlowOpen, setEntryFlowOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [recoveryDuelId, setRecoveryDuelId] = useState<string | null>(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [restoreDraftPending, setRestoreDraftPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [intent, setIntent] = useState<DuelTransactionIntent | null>(null);
  const [rejectedIntentId, setRejectedIntentId] = useState<string | null>(null);
  const [intentPending, setIntentPending] = useState(false);
  const [fundingPhase, setFundingPhase] = useState<
    'idle' | 'signing' | 'confirming' | 'recovering'
  >('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [persistedDuel, setPersistedDuel] = useState<DurableDuel | null>(null);
  const [duelRestorePending, setDuelRestorePending] = useState(true);
  const [resolvedRematchOpponent, setResolvedRematchOpponent] = useState<
    | (DuelGrowthParticipant & {
        duelId: string;
        resolutionAttempt: number;
        viewerWallet: string;
      })
    | null
  >(null);
  const [rematchResolutionPending, setRematchResolutionPending] = useState(false);
  const [rematchResolutionFailed, setRematchResolutionFailed] = useState(false);
  const [rematchResolutionAttempt, setRematchResolutionAttempt] = useState(0);
  const [matchmakingSession, setMatchmakingSession] = useState<MatchmakingSession | null>(null);
  const [matchmakingRestorePending, setMatchmakingRestorePending] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [revealClock, setRevealClock] = useState(() => Date.now());
  const [revealTimeline, setRevealTimeline] = useState<StoredRevealTimeline | null>(null);
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
  const linkedOpponent =
    activeEntry?.action === 'rematch' &&
    resolvedRematchOpponent?.duelId === activeEntry.duelId &&
    resolvedRematchOpponent.viewerWallet === walletConnection.address
      ? resolvedRematchOpponent
      : null;
  const opponentWallet =
    activeEntry?.action === 'rematch' ? (linkedOpponent?.address ?? '') : wallet;
  const currentViewerResult = liveDuel?.winner ? viewerResult(liveDuel.winner) : null;
  const duelId = persistedDuel?.id ?? null;
  const resultKey = persistedDuel?.result?.resultHash ?? null;
  const committedResultReady = Boolean(
    phase === 'result' && duelId && resultKey && liveDuel?.left && liveDuel.right,
  );
  const revealStartedAt = revealTimeline?.resultKey === resultKey ? revealTimeline.startedAt : null;
  const revealPresentation =
    committedResultReady && revealStartedAt !== null
      ? revealPresentationAt(revealClock - revealStartedAt, reducedMotion)
      : null;
  const playerStatus = persistedDuel
    ? getDuelPlayerStatus(persistedDuel.status, matchmakingSession?.state === 'searching')
    : null;
  const matchmakingSearchCopy = matchmakingSession
    ? getMatchmakingSearchCopy(matchmakingSession)
    : null;
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
    setResolvedRematchOpponent(null);
    setRematchResolutionFailed(false);
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

  function startFreshDuel(): void {
    setActiveEntry(undefined);
    setResolvedRematchOpponent(null);
    setRematchResolutionFailed(false);
    setWallet('');
    setActionError(null);
    setActionNotice('Choose a wallet, public matchmaking, or an available house for a fresh duel.');
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
      setRejectedIntentId(draft.rejectedIntentId);
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
          rejectedIntentId,
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
    rejectedIntentId,
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
    const recoveryKey = `${recoveryDuelId}:${walletConnection.address}:${authentication.sessionToken}:${fundingPhase}:${rejectedIntentId ?? 'none'}:${recoveryAttempt}`;
    if (duelRecoveryKey.current === recoveryKey) return;
    duelRecoveryKey.current = recoveryKey;
    let active = true;
    setRestorePending(true);
    setActionError(null);
    restoreDuelEntry({
      abandonRejectedIntent: recordRejectedDuelIntent,
      duelId: recoveryDuelId,
      fundingPossiblyBroadcast: fundingPhase === 'recovering',
      loadDuel: (duelId) => getDuel(duelId, authentication.sessionToken as string),
      prepareIntent: prepareDuelIntent,
      reconcileTransactions: reconcileDuelTransactions,
      rejectedIntentId,
      sessionToken: authentication.sessionToken,
      wallet: walletConnection.address,
    })
      .then(({ duel, intent: restoredIntent, recoveryState }) => {
        if (!active) return;
        setRestorePending(false);
        setRestoreDraftPending(false);
        setPersistedDuel(duel);
        setIntent(restoredIntent);
        if (recoveryState === 'still-reconciling') {
          setActionNotice(null);
          setActionError(STILL_RECONCILING_PAYMENT);
        } else if (restoredIntent) {
          setRejectedIntentId(null);
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
    rejectedIntentId,
    restoreDraftPending,
    walletConnection.address,
  ]);

  useEffect(() => {
    if (!persistedDuel || !completedEntryStatuses.has(persistedDuel.status)) {
      return;
    }
    window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
    setRecoveryDuelId(null);
    setRejectedIntentId(null);
  }, [persistedDuel]);

  useEffect(() => {
    if (entry) {
      setDuelRestorePending(false);
      return;
    }
    if (!authentication.sessionToken) {
      setDuelRestorePending(false);
      return;
    }

    const storedDuel = readStoredActiveDuel(window.sessionStorage);
    if (!storedDuel) {
      setDuelRestorePending(false);
      return;
    }

    let active = true;
    getDuel(storedDuel.duelId, authentication.sessionToken)
      .then((duel) => {
        if (active) setPersistedDuel(duel);
      })
      .catch(() => {
        if (active) {
          setActionError(
            'Could not restore your active duel. Refresh to retry, or start another duel.',
          );
        }
      })
      .finally(() => {
        if (active) setDuelRestorePending(false);
      });

    return () => {
      active = false;
    };
  }, [authentication.sessionToken, entry]);

  useEffect(() => {
    if (
      activeEntry?.action !== 'rematch' ||
      !walletConnection.address ||
      !authentication.sessionToken
    ) {
      setResolvedRematchOpponent(null);
      setRematchResolutionPending(false);
      setRematchResolutionFailed(false);
      return;
    }

    const viewerWallet = walletConnection.address;
    if (
      resolvedRematchOpponent?.duelId === activeEntry.duelId &&
      resolvedRematchOpponent.viewerWallet === viewerWallet
    ) {
      setRematchResolutionPending(false);
      setRematchResolutionFailed(false);
      return;
    }

    let active = true;
    const duelId = activeEntry.duelId;
    setResolvedRematchOpponent(null);
    setRematchResolutionPending(true);
    setRematchResolutionFailed(false);
    getPrivateRematchOpponent(duelId, authentication.sessionToken)
      .then((opponent) => {
        if (!active) return;
        setResolvedRematchOpponent({
          address: opponent.wallet,
          duelId,
          label: activeEntry.participantLabels[opponent.side],
          resolutionAttempt: rematchResolutionAttempt,
          viewerWallet,
        });
      })
      .catch((error) => {
        if (!active) return;
        setResolvedRematchOpponent(null);
        setRematchResolutionFailed(isRetryableDuelRequestError(error));
      })
      .finally(() => {
        if (active) setRematchResolutionPending(false);
      });

    return () => {
      active = false;
    };
  }, [
    activeEntry,
    authentication.sessionToken,
    rematchResolutionAttempt,
    resolvedRematchOpponent,
    walletConnection.address,
  ]);

  useEffect(() => {
    if (persistedDuel) {
      storeActiveDuel(window.sessionStorage, persistedDuel.id);
    }
  }, [persistedDuel]);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(motionQuery.matches);
    updatePreference();
    motionQuery.addEventListener('change', updatePreference);
    return () => motionQuery.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (!committedResultReady || !duelId || !resultKey) {
      setRevealTimeline(null);
      return;
    }

    const now = Date.now();
    const storageKey = revealStorageKey(duelId);
    let stored: StoredRevealTimeline | null = null;
    try {
      stored = parseStoredRevealTimeline(window.sessionStorage.getItem(storageKey));
    } catch {
      stored = null;
    }
    const startedAt = recoverRevealStartedAt(stored, resultKey, now);
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify({ resultKey, startedAt }));
    } catch {
      // A denied storage write only disables reload recovery; it never changes the result.
    }
    setRevealClock(now);
    setRevealTimeline({ resultKey, startedAt });
  }, [committedResultReady, duelId, resultKey]);

  useEffect(() => {
    if (!committedResultReady || revealStartedAt === null || revealPresentation?.isComplete) return;
    const interval = window.setInterval(() => setRevealClock(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [committedResultReady, revealPresentation?.isComplete, revealStartedAt]);

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
    if (
      !persistedDuel ||
      terminalDuelStatuses.has(persistedDuel.status) ||
      !authentication.sessionToken
    ) {
      return;
    }
    let active = true;
    const interval = window.setInterval(() => {
      getDuel(persistedDuel.id, authentication.sessionToken as string)
        .then((duel) => {
          if (active) setPersistedDuel(duel);
        })
        .catch(() => undefined);
    }, 3_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authentication.sessionToken, persistedDuel]);

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
        setActionNotice('Both wallets paid. Opening both packs now.');
      })
      .catch((error: unknown) => {
        if (!active) return;
        lifecycleAdvanceKey.current = null;
        setActionError(getPlayerActionError(error, 'Could not open both packs.'));
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
        .then(() => getDuel(persistedDuel.id, authentication.sessionToken as string))
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
          setActionNotice('Your active public search is ready to continue.');
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
            const duel = await getDuel(
              matchmakingSession.duelId,
              authentication.sessionToken as string,
            ).catch(() => null);
            if (!active) return;
            setMatchmakingSession(null);
            setPersistedDuel(duel);
            setActionNotice(
              duel && duel.status !== 'cancelled'
                ? `${getDuelPlayerStatus(duel.status).headline}.`
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
    getDuel(matchmakingSession.duelId, authentication.sessionToken)
      .then(async (duel) => {
        if (!active) return;
        setPersistedDuel(duel);
        if (matchmakingSession.state !== 'matched') return;
        if (duel.creatorWallet === walletConnection.address && duel.status === 'matched') {
          const restored = await restoreDuelEntry({
            abandonRejectedIntent: recordRejectedDuelIntent,
            duelId: duel.id,
            fundingPossiblyBroadcast: false,
            loadDuel: (duelId) => getDuel(duelId, authentication.sessionToken as string),
            prepareIntent: prepareDuelIntent,
            reconcileTransactions: reconcileDuelTransactions,
            rejectedIntentId,
            sessionToken: authentication.sessionToken as string,
            wallet: walletConnection.address,
          });
          if (!active) return;
          setPersistedDuel(restored.duel);
          setIntent(restored.intent);
          if (restored.recoveryState === 'still-reconciling') {
            setActionNotice(null);
            setActionError(STILL_RECONCILING_PAYMENT);
          } else if (restored.intent) {
            setRejectedIntentId(null);
          }
        } else if (active) {
          setActionNotice(
            'Opponent found. The challenge creator pays first; you will be prompted next.',
          );
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setActionError(getPlayerActionError(error, 'Could not restore matchmaking.'));
        }
      });
    return () => {
      active = false;
    };
  }, [authentication.sessionToken, matchmakingSession, rejectedIntentId, walletConnection.address]);

  async function reviewDuel(nextTier = tier, nextMode = mode) {
    setActionError(null);
    setActionNotice(null);
    if (duelRestorePending) {
      setActionError('Wait while we restore your active duel.');
      return;
    }
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
      setActionError('Solana devnet is unavailable. Check your connection, then retry.');
      return;
    }
    if (activeEntry?.action === 'rematch' && !linkedOpponent) {
      setActionError('This wallet did not play in the original duel. Open a new duel instead.');
      return;
    }
    if (
      activeEntry?.action !== 'accept' &&
      nextMode === 'direct' &&
      opponentWallet.trim().length < 32
    ) {
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
              ? 'Opponent found. Preparing the first payment review.'
              : `Searching for another wallet using the same $${nextPack.tier} pack.`,
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
                  ...(nextMode === 'direct' ? { opponentWallet: opponentWallet.trim() } : {}),
                  packId: nextPack.id,
                },
                authentication.sessionToken,
              );
        setPersistedDuel(duel);
        if (duel.status === 'matched' && duel.creatorWallet === walletConnection.address) {
          const prepared = await prepareDuelIntent(
            duel.id,
            walletConnection.address,
            authentication.sessionToken,
          );
          setIntent(prepared);
          setRejectedIntentId(null);
        } else if (duel.status === 'matched') {
          setActionNotice(
            'Challenge accepted. The challenge creator pays first; you will be prompted next.',
          );
        }
        return;
      }
      setActionError('This devnet preview is not available right now. Nothing was submitted.');
      return;
    } catch (error) {
      setActionError(getPlayerActionError(error, 'Could not prepare the payment review.'));
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
      const restored = await restoreDuelEntry({
        abandonRejectedIntent: recordRejectedDuelIntent,
        duelId: persistedDuel.id,
        fundingPossiblyBroadcast: false,
        loadDuel: (duelId) => getDuel(duelId, authentication.sessionToken as string),
        prepareIntent: prepareDuelIntent,
        reconcileTransactions: reconcileDuelTransactions,
        rejectedIntentId,
        sessionToken: authentication.sessionToken,
        wallet: walletConnection.address,
      });
      setPersistedDuel(restored.duel);
      setIntent(restored.intent);
      if (restored.recoveryState === 'still-reconciling') {
        setActionError(STILL_RECONCILING_PAYMENT);
      } else if (restored.intent) {
        setRejectedIntentId(null);
      } else {
        setActionNotice(getFundingStatusNotice(restored.duel, 0));
      }
    } catch (error) {
      setActionError(getPlayerActionError(error, 'Could not prepare the payment review.'));
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
        clearActiveDuel();
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
      setActionError(getPlayerActionError(error, 'Could not cancel this duel.'));
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
      setActionNotice('Searching again for another wallet using the same selected pack.');
    } catch (error) {
      setActionError(getPlayerActionError(error, 'Could not continue matchmaking.'));
    } finally {
      setIntentPending(false);
    }
  }

  async function chooseHouseFallback(): Promise<void> {
    if (!authentication.sessionToken || !walletConnection.address) return;
    if (!houseFallbackEnabled) {
      setActionError('House play is not available in this devnet preview. Continue matchmaking.');
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
      setActionNotice('House opponent selected. Preparing your payment review.');
    } catch (error) {
      setActionError(getPlayerActionError(error, 'House play could not be selected.'));
    } finally {
      setIntentPending(false);
    }
  }

  async function approveIntent() {
    if (!intent || !authentication.sessionToken) return;
    setIntentPending(true);
    setFundingPhase('signing');
    setRejectedIntentId(null);
    setActionError(null);
    window.localStorage.setItem(
      DUEL_ENTRY_DRAFT_STORAGE_KEY,
      JSON.stringify(
        createDuelEntryDraft({
          broadcastPending: true,
          duelId: persistedDuel?.id ?? intent.duelId,
          mode,
          opponentAddress: wallet,
          rejectedIntentId: null,
          tier: toDraftTier(tier),
        }),
      ),
    );
    let transactionMayHaveBeenSubmitted = false;
    let transactionWasSubmitted = false;
    try {
      const binary = window.atob(intent.serializedTransactionBase64);
      const transaction = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      transactionMayHaveBeenSubmitted = true;
      const signature = await walletConnection.signAndSendTransaction(transaction);
      transactionWasSubmitted = true;
      setFundingPhase('confirming');
      await submitSignedDuelIntent(
        intent.duelId,
        intent.id,
        signature,
        authentication.sessionToken,
      );
      setActionNotice('Payment sent on Solana devnet. Checking that it completed…');
      await reconcileBroadcastFunding(intent.duelId, authentication.sessionToken);
    } catch (error) {
      if (error instanceof WalletTransactionNotBroadcastError) {
        setFundingPhase('idle');
        setRejectedIntentId(intent.id);
        window.localStorage.setItem(
          DUEL_ENTRY_DRAFT_STORAGE_KEY,
          JSON.stringify(
            createDuelEntryDraft({
              broadcastPending: false,
              duelId: persistedDuel?.id ?? intent.duelId,
              mode,
              opponentAddress: wallet,
              rejectedIntentId: intent.id,
              tier: toDraftTier(tier),
            }),
          ),
        );
        try {
          const prepared = await recoverRejectedFundingIntent(
            intent.duelId,
            intent.id,
            authentication.sessionToken,
          );
          setActionNotice(
            prepared
              ? 'Nothing was broadcast. Review the fresh unsigned transaction before trying again.'
              : 'Nothing was broadcast. This duel no longer needs a new payment review.',
          );
        } catch (recoveryError) {
          setActionError(
            recoveryError instanceof Error
              ? `Nothing was broadcast. ${recoveryError.message}`
              : 'Nothing was broadcast. Resume to reset the rejected review and try again.',
          );
        }
      } else {
        setFundingPhase('recovering');
        setActionError(
          getPlayerActionError(
            error,
            'The payment did not complete.',
            transactionMayHaveBeenSubmitted,
            transactionWasSubmitted,
          ),
        );
      }
    } finally {
      setIntentPending(false);
    }
  }

  async function recoverRejectedFundingIntent(
    duelId: string,
    rejectedId: string,
    sessionToken: string,
  ): Promise<boolean> {
    if (!walletConnection.address) throw new Error('Reconnect the funding wallet to continue.');
    const restored = await restoreDuelEntry({
      abandonRejectedIntent: recordRejectedDuelIntent,
      duelId,
      fundingPossiblyBroadcast: false,
      loadDuel: (restoredDuelId) => getDuel(restoredDuelId, sessionToken),
      prepareIntent: prepareDuelIntent,
      reconcileTransactions: reconcileDuelTransactions,
      rejectedIntentId: rejectedId,
      sessionToken,
      wallet: walletConnection.address,
    });
    setPersistedDuel(restored.duel);
    setIntent(restored.intent);
    if (restored.recoveryState === 'still-reconciling') {
      throw new Error(STILL_RECONCILING_PAYMENT);
    }
    setRejectedIntentId(null);
    setFundingPhase('idle');
    return Boolean(restored.intent);
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
      setActionError(getPlayerActionError(error, 'The payment did not complete.', true, true));
    } finally {
      setIntentPending(false);
    }
  }

  async function reconcileBroadcastFunding(duelId: string, sessionToken: string): Promise<void> {
    const reconciliation = await waitForDuelTransactions(duelId, sessionToken);
    const refreshed = await getDuel(duelId, sessionToken);
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
      setRejectedIntentId(null);
      setFundingPhase('idle');
      setActionNotice(
        'No broadcast funding remains active. Review the fresh fee before choosing whether to sign again.',
      );
      return;
    }
    setIntent(null);
    setRejectedIntentId(null);
    setFundingPhase('idle');
    setActionNotice(getFundingStatusNotice(refreshed, 0));
  }

  async function cancelGuidedEntry(): Promise<void> {
    if (persistedDuel || matchmakingSession) {
      const cancelled = await cancelPersistedDuel();
      if (!cancelled) return;
    }
    window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
    setRecoveryDuelId(null);
    setRejectedIntentId(null);
    setIntent(null);
    clearActiveDuel();
    setMatchmakingSession(null);
    setEntryFlowOpen(false);
    setActionNotice(persistedDuel || matchmakingSession ? 'Duel entry cancelled.' : null);
  }

  async function resumeGuidedEntry(): Promise<void> {
    if (rejectedIntentId) {
      const duelId = intent?.duelId ?? persistedDuel?.id ?? recoveryDuelId;
      if (!duelId || !authentication.sessionToken) return;
      setIntentPending(true);
      setActionError(null);
      try {
        const prepared = await recoverRejectedFundingIntent(
          duelId,
          rejectedIntentId,
          authentication.sessionToken,
        );
        setActionNotice(
          prepared
            ? 'The rejected review was reset. Review the fresh unsigned transaction before trying again.'
            : 'The rejected review was reset. This duel no longer needs a new payment review.',
        );
      } catch (error) {
        setActionError(
          error instanceof Error
            ? `Nothing was broadcast. ${error.message}`
            : 'Nothing was broadcast. The rejected review could not be reset yet.',
        );
      } finally {
        setIntentPending(false);
      }
      return;
    }
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
      if (persistedDuel?.opponentWallet && !persistedDuel.houseOpponent) {
        const participants: DuelGrowthParticipants = {
          creator: {
            address: persistedDuel.creatorWallet,
            label: shortReference(persistedDuel.creatorWallet) ?? 'Creator wallet',
          },
          opponent: {
            address: persistedDuel.opponentWallet,
            label: shortReference(persistedDuel.opponentWallet) ?? 'Opponent wallet',
          },
        };
        const viewerWallet = walletConnection.address;
        const opponent = resolveRematchOpponent(participants, viewerWallet);
        setResolvedRematchOpponent(
          opponent && viewerWallet
            ? {
                ...opponent,
                duelId: persistedDuel.id,
                resolutionAttempt: rematchResolutionAttempt,
                viewerWallet,
              }
            : null,
        );
        setActiveEntry({
          action: 'rematch',
          duelId: persistedDuel.id,
          mode: 'direct',
          participantLabels: {
            creator: participants.creator.label,
            opponent: participants.opponent.label,
          },
          tier,
        });
        setMode('direct');
      }
      setActionNotice('Rematch ready. Review and approve a fresh transaction to continue.');
    }
    clearActiveDuel();
    setMatchmakingSession(null);
    setIntent(null);
    setRejectedIntentId(null);
    setEntryFlowOpen(false);
    setRecoveryDuelId(null);
    window.localStorage.removeItem(DUEL_ENTRY_DRAFT_STORAGE_KEY);
  }

  function clearActiveDuel(): void {
    setPersistedDuel(null);
    clearStoredActiveDuel(window.sessionStorage);
  }

  async function shareResult(destination: 'native' | 'x') {
    if (!persistedDuel || !liveDuel?.left || !liveDuel.right || !liveDuel.winner) return;
    const winningPull =
      liveDuel.winner === 'you'
        ? liveDuel.left
        : liveDuel.winner === 'opponent'
          ? liveDuel.right
          : null;
    const text = resultShareText({
      result: viewerResult(liveDuel.winner),
      tier: liveDuel.tier,
      winningPull,
    });
    const shareUrl = `${window.location.origin}/duel/${encodeURIComponent(persistedDuel.id)}`;

    if (destination === 'x') {
      window.open(
        `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
        '_blank',
        'noopener,noreferrer',
      );
    } else {
      try {
        const outcome = await shareNativeResult(
          { text, title: DUEL_SHARE_RESULT_TITLE, url: shareUrl },
          {
            ...(navigator.share ? { share: navigator.share.bind(navigator) } : {}),
            writeClipboard: (value) => navigator.clipboard.writeText(value),
          },
        );
        if (outcome === 'cancelled') return;
        if (outcome === 'copied') {
          setActionNotice('Result link copied with its status-aware social preview.');
        }
      } catch {
        setActionError('Could not share this result. Open the verified receipt and copy its URL.');
        return;
      }
    }
    const trackedTier = toTrackedTier(tier);
    trackProductEvent({
      ...(persistedDuel ? { duelId: persistedDuel.id, status: persistedDuel.status } : {}),
      mode: toTrackedMode(mode),
      name: 'duel_shared',
      ...(trackedTier ? { tier: trackedTier } : {}),
    });
  }

  if (phase !== 'lobby' && liveDuel && persistedDuel) {
    const showResolution = revealPresentation?.showResolution ?? false;
    const leftStage: DuelCardStage =
      phase === 'result'
        ? revealPresentation?.showLeft
          ? 'revealed'
          : 'sealed'
        : phase === 'opening'
          ? 'opening'
          : 'sealed';
    const rightStage: DuelCardStage =
      phase === 'result'
        ? revealPresentation?.showRight
          ? 'revealed'
          : 'sealed'
        : phase === 'opening'
          ? 'opening'
          : 'sealed';
    const presentationHeadline =
      phase === 'result' && !showResolution
        ? (revealPresentation?.headline ?? 'Outcome committed. Preparing reveal…')
        : liveDuel.headline;
    const presentationIndicator =
      phase === 'result' && !showResolution
        ? (revealPresentation?.indicator ?? 'Outcome committed')
        : liveDuel.indicator;

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
                <SwordIcon size={14} weight="fill" /> {battleEyebrowLabel(liveDuel.tier)}
              </span>
              <h1 data-testid={journeyTestIds.duelHeadline}>{presentationHeadline}</h1>
            </div>
            <div
              className={`phase-indicator phase-${showResolution ? 'result' : phase === 'result' ? 'opening' : phase}`}
              data-testid={journeyTestIds.duelPhase}
            >
              <span />
              {presentationIndicator}
            </div>
          </div>
          {actionError ? (
            <p className="duel-action-error" role="alert" data-testid={journeyTestIds.error}>
              <WarningCircleIcon size={14} weight="fill" /> {actionError}
            </p>
          ) : null}
          {actionNotice ? <p className="signing-note">{actionNotice}</p> : null}
          {matchmakingSession?.cancellationRule ? (
            <p className="signing-note">
              <strong>Cancellation:</strong> {matchmakingSession.cancellationRule}
            </p>
          ) : null}

          {committedResultReady ? (
            <div className="commitment-banner">
              <ShieldCheckIcon size={17} weight="fill" />
              <span>
                <strong>{revealCommitmentCopy}</strong>
                <small>Result hash {shortReference(resultKey) ?? 'verified'}</small>
              </span>
            </div>
          ) : null}

          {revealPresentation?.countdown ? (
            <div className="reveal-countdown" role="status" aria-atomic="true">
              <small>Committed reveal</small>
              <strong>{revealPresentation.countdown}</strong>
              <span>Both outcomes are locked</span>
            </div>
          ) : null}

          <div className={`reveal-grid reveal-grid-${revealPresentation?.phase ?? phase}`}>
            <DuelCard
              pull={liveDuel.left}
              side="you"
              stage={leftStage}
              resolution={showResolution ? revealSideResolution(liveDuel.winner, 'you') : null}
              tier={liveDuel.tier}
              walletLabel={walletConnection.shortAddress ?? 'Your wallet'}
            />
            <div className="versus-mark" aria-hidden="true">
              <span>VS</span>
            </div>
            <DuelCard
              pull={liveDuel.right}
              side="opponent"
              stage={rightStage}
              resolution={showResolution ? revealSideResolution(liveDuel.winner, 'opponent') : null}
              tier={liveDuel.tier}
              walletLabel={opponentWalletLabel({
                creatorWallet: persistedDuel.creatorWallet,
                houseOpponent: persistedDuel.houseOpponent,
                opponentWallet: persistedDuel.opponentWallet,
                shortenWallet: shortReference,
                viewerAddress: walletConnection.address,
              })}
            />
          </div>

          {showResolution ? (
            <div className="result-panel">
              <div className="result-summary">
                <TrophyIcon size={24} weight="fill" />
                <div>
                  <small>Winner</small>
                  <strong>{resultWinnerLabel(liveDuel.winner)}</strong>
                </div>
                <Separator orientation="vertical" className="h-9 bg-border" />
                <div>
                  <small>Winning margin</small>
                  <strong data-testid={journeyTestIds.resultMargin}>
                    {liveDuel.margin ?? '—'}
                  </strong>
                </div>
                <Separator orientation="vertical" className="h-9 bg-border" />
                <div>
                  <small>Total haul</small>
                  <strong data-testid={journeyTestIds.resultTotalValue}>
                    {liveDuel.totalValue ?? '—'}
                  </strong>
                </div>
              </div>
              <div className="result-actions">
                <Button
                  type="button"
                  className="share-button"
                  onClick={() => shareResult('native')}
                  data-testid={journeyTestIds.resultShare}
                >
                  <ShareNetworkIcon size={16} weight="fill" /> Share result
                </Button>
                {persistedDuel.status === 'settled' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => resetDuel(true)}
                    data-testid={journeyTestIds.resultRematch}
                  >
                    <ArrowsLeftRightIcon size={16} />{' '}
                    {currentViewerResult ? rematchLabel(currentViewerResult) : 'Run a rematch'}
                  </Button>
                ) : null}
                <Link
                  className="result-receipt-action"
                  href={`/duel/${encodeURIComponent(persistedDuel.id)}`}
                >
                  <ShieldCheckIcon size={16} /> Verified receipt
                </Link>
                <Button type="button" variant="ghost" onClick={() => shareResult('x')}>
                  <XLogoIcon size={16} weight="fill" /> X
                </Button>
              </div>
            </div>
          ) : revealPresentation ? (
            <div
              className="opening-timeline reveal-timeline"
              role="status"
              aria-label="Reveal progress"
            >
              <span className="timeline-complete">
                <CheckCircleIcon size={14} weight="fill" /> Committed
              </span>
              <span className="timeline-line">
                <i />
              </span>
              <span
                className={revealPresentation.showLeft ? 'timeline-complete' : 'timeline-active'}
              >
                <FireIcon size={14} weight="fill" /> Your pull
              </span>
              <span className="timeline-line">
                <i />
              </span>
              <span
                className={
                  revealPresentation.showRight
                    ? 'timeline-complete'
                    : revealPresentation.showLeft
                      ? 'timeline-active'
                      : ''
                }
              >
                <FireIcon size={14} weight="fill" /> Rival pull
              </span>
              <span className="timeline-line">
                <i />
              </span>
              <span className={revealPresentation.showRight ? 'timeline-active' : ''}>
                <TrophyIcon size={14} /> Resolve
              </span>
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
          <p>{getLobbyEconomicsCopy()}</p>
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
                    <SharedOpponentControl
                      entry={activeEntry}
                      localWallet={wallet}
                      onLocalWalletChange={setWallet}
                      onRetryRematch={() => setRematchResolutionAttempt((attempt) => attempt + 1)}
                      onStartFreshDuel={startFreshDuel}
                      rematchNeedsConnection={
                        activeEntry?.action === 'rematch' &&
                        (!walletConnection.address || !authentication.sessionToken)
                      }
                      rematchResolutionFailed={rematchResolutionFailed}
                      rematchPending={rematchResolutionPending}
                      resolvedOpponentLabel={linkedOpponent?.label ?? null}
                    />
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
                        We match you with another wallet using the same selected pack. You can
                        continue searching or cancel before funding starts. House play is never
                        selected automatically.
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
                      Platform fee <strong>Shown before approval</strong>
                    </span>
                    <span>
                      Pack tier{' '}
                      <strong data-testid={journeyTestIds.entryTier}>${tier.toFixed(2)}</strong>
                    </span>
                    <span>
                      Pack purchase <strong>Not charged now</strong>
                    </span>
                    <span>
                      Winner gets <strong>Both cards</strong>
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
                      duelRestorePending ||
                      matchmakingRestorePending ||
                      Boolean(matchmakingSession) ||
                      !selectedPack ||
                      !selectedModeEnabled ||
                      (activeEntry?.action === 'rematch' && !linkedOpponent) ||
                      (activeEntry?.action !== 'accept' &&
                        mode === 'direct' &&
                        opponentWallet.trim().length === 0)
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
                      ? 'Preparing payment review'
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
                    <InfoIcon size={13} /> You will see the exact fee and purpose before your wallet
                    opens.
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

      {persistedDuel && playerStatus ? (
        <section
          className="persisted-duel-panel"
          role="status"
          data-testid={journeyTestIds.persistedDuel}
        >
          <div>
            <span className="eyebrow">
              <ShieldCheckIcon size={14} weight="fill" /> Devnet duel
            </span>
            <h2>{playerStatus.headline}</h2>
            <p>{playerStatus.detail}</p>
            {playerStatus.nextAction ? (
              <p className="duel-next-action">
                <strong>Next:</strong> {playerStatus.nextAction}
              </p>
            ) : null}
            {matchmakingSearchCopy ? (
              <>
                <p>{matchmakingSearchCopy}</p>
                {houseFallbackAction?.disclosure ? <p>{houseFallbackAction.disclosure}</p> : null}
              </>
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
                  const challengeUrl = `${window.location.origin}/duel/${encodeURIComponent(persistedDuel.id)}`;
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
                onClick={clearActiveDuel}
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
      <details className="rules-disclosure">
        <summary>
          <ShareNetworkIcon size={15} /> Full rules, odds, fees, and cancellations
        </summary>
        <div className="rules-disclosure-grid">
          {duelRules.map((rule) => (
            <article key={rule.title}>
              <strong>{rule.title}</strong>
              <p>{rule.body}</p>
            </article>
          ))}
        </div>
      </details>
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

function resultWinnerLabel(winner: 'opponent' | 'tie' | 'you' | null): string {
  if (winner === 'you') return 'You';
  if (winner === 'opponent') return 'Opponent';
  if (winner === 'tie') return 'Tie';
  return 'Pending';
}
