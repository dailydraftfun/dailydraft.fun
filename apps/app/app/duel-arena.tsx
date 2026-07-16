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
  SparkleIcon,
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
import { trackProductEvent } from './analytics-client';
import { type LiveDuelPhase, type LivePull, toLiveDuelState } from './duel/live-duel-state';
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
  type ProductCapabilities,
  prepareDuelIntent,
  reconcileDuelTransactions,
  searchOpenMatchmaking,
  selectHouseFallback,
  submitSignedDuelIntent,
  waitForDuelTransactions,
} from './solana/duel-client';
import { TransactionIntentReview } from './solana/transaction-intent-review';
import { isDuelApiConfigured } from './solana/wallet-auth-client';
import { useWalletAuth } from './solana/wallet-auth-provider';
import { useSolanaWallet } from './solana/wallet-provider';

type Mode = DuelOpponentType;
type Phase = LiveDuelPhase;
type DuelCardStage = 'opening' | 'revealed' | 'sealed';

export type DuelLobbyEntry = {
  action: 'accept' | 'rematch';
  duelId: string;
  mode: Mode;
  opponentAddress?: string;
  opponentLabel: string;
  tier: number;
};

const tiers = [25, 50, 100] as const;
const terminalDuelStatuses = new Set<DurableDuel['status']>([
  'cancelled',
  'refunded',
  'settled',
  'failed',
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

function TierCard({
  value,
  selected,
  disabled,
  onSelect,
}: {
  value: number;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={selected ? 'tier-card tier-card-selected' : 'tier-card'}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      disabled={disabled}
    >
      <span className="tier-orb" aria-hidden="true">
        <SparkleIcon size={value === 100 ? 25 : 21} weight="fill" />
      </span>
      <span>
        <strong>${value}</strong>
        <small>{value === 25 ? 'Silver' : value === 50 ? 'Gold' : 'Water'} Pack</small>
      </span>
      <span className="tier-ev">Devnet</span>
      {selected ? <CheckCircleIcon className="tier-check" size={18} weight="fill" /> : null}
    </button>
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
          <span className={`result-chip result-${resolution}`}>
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
        <span className="grade-chip">{displayPull?.provider ?? 'Pending'}</span>
        <div>
          <strong>{displayPull?.name ?? 'Result pending'}</strong>
          <small>{displayPull?.label ?? 'No outcome committed yet'}</small>
        </div>
        <span className="pull-value">{displayPull?.value ?? '—'}</span>
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
  const [intent, setIntent] = useState<DuelTransactionIntent | null>(null);
  const [intentPending, setIntentPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [persistedDuel, setPersistedDuel] = useState<DurableDuel | null>(null);
  const [matchmakingSession, setMatchmakingSession] = useState<MatchmakingSession | null>(null);
  const [matchmakingRestorePending, setMatchmakingRestorePending] = useState(false);
  const [capabilities, setCapabilities] = useState<ProductCapabilities | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [revealClock, setRevealClock] = useState(() => Date.now());
  const [revealTimeline, setRevealTimeline] = useState<StoredRevealTimeline | null>(null);
  const matchmakingRestoreKey = useRef<string | null>(null);
  const lifecycleAdvanceKey = useRef<string | null>(null);
  const liveDuel = persistedDuel ? toLiveDuelState(persistedDuel, walletConnection.address) : null;
  const phase: Phase = liveDuel?.phase ?? 'lobby';
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
  const houseEnabled = capabilities?.modes.house.enabled === true;
  const houseFallbackAction = matchmakingSession?.availableActions.find(
    (action) => action.action === 'house_fallback',
  );

  function chooseMode(nextMode: Mode) {
    if (nextMode === mode) return;
    if (nextMode === 'house' && !houseEnabled) {
      setActionError('House play remains hidden until API readiness is verified.');
      return;
    }
    if (matchmakingRestorePending) {
      setActionError('Checking this wallet for an active public matchmaking ticket.');
      return;
    }
    if (matchmakingSession) {
      setActionError('Cancel the active public search before starting a different duel mode.');
      return;
    }
    setActiveEntry(undefined);
    setMode(nextMode);
    if (nextMode !== 'direct') setWallet('');
  }

  function chooseTier(nextTier: number) {
    setTier(nextTier);
    const trackedTier = toTrackedTier(nextTier);
    if (trackedTier) trackProductEvent({ name: 'tier_selected', tier: trackedTier });
    if (activeEntry?.action === 'accept') setActiveEntry(undefined);
  }

  useEffect(() => {
    trackProductEvent({ name: 'lobby_viewed' });
  }, []);

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
    if (!isDuelApiConfigured()) return;
    let active = true;
    getProductCapabilities()
      .then((nextCapabilities) => {
        if (active) setCapabilities(nextCapabilities);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'house' || houseEnabled) return;
    setMode('matchmaking');
    setActiveEntry(undefined);
    setActionNotice(
      capabilities?.modes.house.reason ??
        'House readiness could not be verified, so house play remains hidden.',
    );
  }, [capabilities, houseEnabled, mode]);

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
    if (nextMode === 'house' && !houseEnabled) {
      setActionError('House play is unavailable until devnet treasury readiness is verified.');
      return;
    }
    if (isDuelApiConfigured() && !authentication.sessionToken) {
      setActionError(
        'Authenticate wallet ownership from the top-right wallet menu before creating or joining a duel.',
      );
      return;
    }
    if (isDuelApiConfigured() && nextTier !== 50) {
      setActionError('Durable devnet matchmaking currently supports the $50 Pokémon pack only.');
      return;
    }

    setIntentPending(true);
    try {
      if (isDuelApiConfigured() && authentication.sessionToken && walletConnection.address) {
        if (nextMode === 'matchmaking') {
          const session = await searchOpenMatchmaking(
            walletConnection.address,
            authentication.sessionToken,
          );
          setMatchmakingSession(session);
          setActionNotice(
            session.state === 'matched'
              ? 'Opponent found. Preparing the creator funding review.'
              : 'Searching the exact $50 tier and valuation-policy queue.',
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

  async function cancelPersistedDuel(): Promise<void> {
    if (!persistedDuel || !authentication.sessionToken || !walletConnection.address) return;
    setIntentPending(true);
    setActionError(null);
    try {
      if (persistedDuel.matchmakingMode === 'open' && matchmakingSession) {
        await cancelOpenMatchmaking(walletConnection.address, authentication.sessionToken);
        setMatchmakingSession(null);
        setPersistedDuel(null);
        setActionNotice('Public matchmaking cancelled before funding.');
        return;
      }
      const cancelled = await cancelDuel(
        persistedDuel.id,
        walletConnection.address,
        authentication.sessionToken,
        'player_cancelled_before_funding',
      );
      setPersistedDuel(cancelled);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not cancel the persisted devnet duel.',
      );
    } finally {
      setIntentPending(false);
    }
  }

  async function continueMatchmaking(): Promise<void> {
    if (!authentication.sessionToken || !walletConnection.address) return;
    setIntentPending(true);
    setActionError(null);
    try {
      const session = await continueOpenMatchmaking(
        walletConnection.address,
        authentication.sessionToken,
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
    if (!houseEnabled) {
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
    setActionError(null);
    try {
      const binary = window.atob(intent.serializedTransactionBase64);
      const transaction = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const signature = await walletConnection.signAndSendTransaction(transaction);
      await submitSignedDuelIntent(
        intent.duelId,
        intent.id,
        signature,
        authentication.sessionToken,
      );
      setActionNotice('Funding broadcast on Solana devnet. Verifying finalized escrow state…');
      const reconciliation = await waitForDuelTransactions(
        intent.duelId,
        authentication.sessionToken,
      );
      setIntent(null);
      const refreshed = await getDuel(intent.duelId);
      setPersistedDuel(refreshed);
      setActionNotice(
        fundingReconciliationNotice(refreshed, reconciliation.activeTransactionCount),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The wallet did not approve the transaction.',
      );
    } finally {
      setIntentPending(false);
    }
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
      <main className="duel-experience">
        <div className="duel-topline">
          <button type="button" className="text-button" onClick={() => resetDuel()}>
            <ArrowCounterClockwiseIcon size={15} /> Back to lobby
          </button>
          <div className="duel-proof">
            <ShieldCheckIcon size={15} weight="fill" />
            <span>Devnet settlement</span>
            <code>{shortReference(liveDuel.settlementReference) ?? 'Awaiting escrow'}</code>
          </div>
        </div>

        <section className="battle-shell" aria-live="polite">
          <div className="battle-heading">
            <div>
              <span className="eyebrow">
                <SwordIcon size={14} weight="fill" /> {liveDuel.tier} Pack Duel
              </span>
              <h1>{presentationHeadline}</h1>
            </div>
            <div
              className={`phase-indicator phase-${showResolution ? 'result' : phase === 'result' ? 'opening' : phase}`}
            >
              <span />
              {presentationIndicator}
            </div>
          </div>
          {actionError ? (
            <p className="duel-action-error" role="alert">
              <WarningCircleIcon size={14} weight="fill" /> {actionError}
            </p>
          ) : null}
          {actionNotice ? <p className="signing-note">{actionNotice}</p> : null}

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
                  <strong>{liveDuel.margin ?? '—'}</strong>
                </div>
                <Separator orientation="vertical" className="h-9 bg-border" />
                <div>
                  <small>Total haul</small>
                  <strong>{liveDuel.totalValue ?? '—'}</strong>
                </div>
              </div>
              <div className="result-actions">
                {persistedDuel.status === 'settled' ? (
                  <Button type="button" variant="ghost" onClick={() => resetDuel(true)}>
                    <ArrowsLeftRightIcon size={16} /> Rematch
                  </Button>
                ) : null}
                <Button type="button" className="share-button" onClick={shareResult}>
                  <XLogoIcon size={16} weight="fill" /> Share result
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
    <main className="lobby-shell">
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
            <div className="mode-tabs" role="tablist" aria-label="Duel mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'direct'}
                onClick={() => chooseMode('direct')}
              >
                <UserPlusIcon size={17} weight="bold" />
                <span className="mode-tab-copy">
                  <strong className="mode-tab-title">Challenge</strong>
                  <small className="mode-tab-caption">Invite a wallet</small>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'matchmaking'}
                onClick={() => chooseMode('matchmaking')}
              >
                <UsersThreeIcon size={17} weight="fill" />
                <span className="mode-tab-copy">
                  <strong className="mode-tab-title">Matchmake</strong>
                  <small className="mode-tab-caption">Find a wallet</small>
                </span>
              </button>
              {houseEnabled ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'house'}
                  onClick={() => chooseMode('house')}
                >
                  <LightningIcon size={17} weight="fill" />
                  <span className="mode-tab-copy">
                    <strong className="mode-tab-title">Instant</strong>
                    <small className="mode-tab-caption">Play the house</small>
                  </span>
                </button>
              ) : null}
            </div>

            <div className="match-card-body">
              <div className="section-label-row">
                <span>Choose pack tier</span>
                <span>Both players open one</span>
              </div>
              <div className="tier-grid">
                {tiers.map((value) => (
                  <TierCard
                    key={value}
                    value={value}
                    selected={tier === value}
                    disabled={activeEntry?.action === 'accept'}
                    onSelect={() => chooseTier(value)}
                  />
                ))}
              </div>

              {mode === 'direct' ? (
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
                    />
                  </div>
                </div>
              ) : null}

              {mode === 'house' ? (
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
              ) : null}

              {mode === 'matchmaking' ? (
                <div className="opponent-disclosure">
                  <UsersThreeIcon size={18} weight="fill" />
                  <span>
                    <strong>Public wallet matchmaking</strong>
                    We match the exact tier and valuation policy. You can continue searching or
                    cancel before funding. House play is never selected automatically.
                  </span>
                </div>
              ) : null}

              <div className="fee-summary">
                <span>
                  Pack tier <strong>${tier.toFixed(2)}</strong>
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
                onClick={() => reviewDuel()}
                disabled={
                  intentPending ||
                  matchmakingRestorePending ||
                  Boolean(matchmakingSession) ||
                  (mode === 'direct' && wallet.trim().length === 0)
                }
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
                <InfoIcon size={13} /> Every devnet signature is preceded by an explicit transaction
                review.
              </p>
              {actionError ? (
                <p className="duel-action-error" role="alert">
                  <WarningCircleIcon size={14} weight="fill" /> {actionError}
                </p>
              ) : null}
              {actionNotice ? <p className="signing-note">{actionNotice}</p> : null}
            </div>
          </CardContent>
        </Card>
      </section>

      {persistedDuel ? (
        <section className="persisted-duel-panel" role="status">
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
              >
                {intentPending ? <SpinnerGapIcon className="wallet-spinner" size={16} /> : null}
                Continue search
              </Button>
            ) : null}
            {matchmakingSession?.state === 'searching' &&
            houseFallbackAction?.available &&
            houseEnabled ? (
              <Button
                type="button"
                variant="ghost"
                onClick={chooseHouseFallback}
                disabled={intentPending}
              >
                <ShieldCheckIcon size={16} weight="fill" /> Select disclosed house
              </Button>
            ) : null}
            {(persistedDuel.status === 'matched' &&
              persistedDuel.creatorWallet === walletConnection.address) ||
            (persistedDuel.status === 'committing' &&
              persistedDuel.opponentWallet === walletConnection.address) ? (
              <Button type="button" onClick={reviewPersistedFunding} disabled={intentPending}>
                {intentPending ? <SpinnerGapIcon className="wallet-spinner" size={16} /> : null}
                Review platform fee
              </Button>
            ) : null}
            {persistedDuel.status === 'waiting' && !matchmakingSession ? (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  const challengeUrl = `${window.location.origin}/overview?challenge=${encodeURIComponent(persistedDuel.id)}`;
                  await navigator.clipboard.writeText(challengeUrl);
                  trackProductEvent({
                    duelId: persistedDuel.id,
                    mode: persistedDuel.matchmakingMode,
                    name: 'duel_shared',
                    status: persistedDuel.status,
                    tier: 50,
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
                onClick={cancelPersistedDuel}
                disabled={intentPending}
              >
                {intentPending ? <SpinnerGapIcon className="wallet-spinner" size={16} /> : null}
                Cancel duel
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setPersistedDuel(null)}>
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
        <button type="button">
          <ShareNetworkIcon size={15} /> Full rules
        </button>
      </section>
      {intent ? (
        <TransactionIntentReview
          intent={intent}
          pending={intentPending}
          error={actionError}
          onClose={() => {
            if (!intentPending) setIntent(null);
          }}
          onConfirm={approveIntent}
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
