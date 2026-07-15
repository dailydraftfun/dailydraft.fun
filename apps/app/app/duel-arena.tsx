'use client';

import {
  ArrowCounterClockwiseIcon,
  ArrowsLeftRightIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelDuel,
  createDuel,
  type DuelOpponentType,
  type DuelTransactionIntent,
  type DurableDuel,
  joinDuel,
  prepareDuelIntent,
  submitSignedDuelIntent,
} from './solana/duel-client';
import { TransactionIntentReview } from './solana/transaction-intent-review';
import { isDuelApiConfigured } from './solana/wallet-auth-client';
import { useWalletAuth } from './solana/wallet-auth-provider';
import { useSolanaWallet } from './solana/wallet-provider';

type Mode = DuelOpponentType;
type Phase = 'lobby' | 'matching' | 'opening' | 'result';

export type DuelLobbyEntry = {
  action: 'accept' | 'rematch';
  duelId: string;
  mode: Mode;
  opponentAddress?: string;
  opponentLabel: string;
  tier: number;
};

type Pull = {
  id: string;
  name: string;
  set: string;
  grade: string;
  image: string;
  value: number;
};

type Match = {
  opponent: string;
  opponentAvatar: string;
  tier: number;
  left: Pull;
  right: Pull;
};

const tiers = [25, 50, 100] as const;

const pulls: Pull[] = [
  {
    id: 'base1-4',
    name: 'Charizard',
    set: 'Base Set · Holo',
    grade: 'PSA 8',
    image: 'https://images.pokemontcg.io/base1/4_hires.png',
    value: 472,
  },
  {
    id: 'swsh7-215',
    name: 'Umbreon VMAX',
    set: 'Evolving Skies · Alt Art',
    grade: 'PSA 10',
    image: 'https://images.pokemontcg.io/swsh7/215_hires.png',
    value: 1380,
  },
  {
    id: 'base1-2',
    name: 'Blastoise',
    set: 'Base Set · Holo',
    grade: 'PSA 9',
    image: 'https://images.pokemontcg.io/base1/2_hires.png',
    value: 615,
  },
  {
    id: 'base1-15',
    name: 'Venusaur',
    set: 'Base Set · Holo',
    grade: 'PSA 9',
    image: 'https://images.pokemontcg.io/base1/15_hires.png',
    value: 344,
  },
  {
    id: 'sm115-69',
    name: 'Mewtwo GX',
    set: 'Shining Legends · Secret',
    grade: 'PSA 10',
    image: 'https://images.pokemontcg.io/sm115/69_hires.png',
    value: 287,
  },
  {
    id: 'base1-10',
    name: 'Mewtwo',
    set: 'Base Set · Holo',
    grade: 'PSA 9',
    image: 'https://images.pokemontcg.io/base1/10_hires.png',
    value: 168,
  },
];

const waitingDuels = [
  { wallet: '7Lqk…mP2z', tier: 25, wait: '8s', color: '#b8ff5a' },
  { wallet: 'Boba.sol', tier: 50, wait: '21s', color: '#a78bfa' },
  { wallet: '4gHn…Q8ws', tier: 100, wait: '46s', color: '#f7c948' },
] as const;

function getMatch(tier: number, nonce: number): Match {
  const offset = (nonce * 2 + tiers.indexOf(tier as (typeof tiers)[number])) % pulls.length;
  const left = pulls[offset];
  const right = pulls[(offset + 1) % pulls.length];
  return {
    opponent: waitingDuels[nonce % waitingDuels.length].wallet,
    opponentAvatar: waitingDuels[nonce % waitingDuels.length].color,
    tier,
    left,
    right,
  };
}

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
      <span className="tier-ev">EV ${(value * 1.09).toFixed(2)}</span>
      {selected ? <CheckCircleIcon className="tier-check" size={18} weight="fill" /> : null}
    </button>
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
  pull: Pull;
  side: 'you' | 'opponent';
  phase: Phase;
  winner: boolean;
  tier: number;
  walletLabel: string;
}) {
  const visible = phase === 'result';
  return (
    <article className={`reveal-column reveal-${side} ${winner && visible ? 'reveal-winner' : ''}`}>
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
          <span className="winner-chip">
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
            <small>AUTHENTICATED PULL</small>
          </div>
          <Image
            src="https://images.pokemontcg.io/cardback.png"
            alt=""
            fill
            sizes="(max-width: 768px) 42vw, 260px"
            className="pack-art"
          />
          <span className="pack-tier">${visible ? '—' : tier}</span>
        </div>
        <div className="pull-shell" aria-hidden={!visible}>
          <Image
            src={pull.image}
            alt={`${pull.name} ${pull.set}`}
            fill
            sizes="(max-width: 768px) 42vw, 260px"
            className="pull-image"
            priority
          />
        </div>
        {phase === 'opening' ? (
          <div className="opening-status" role="status">
            <span /> Opening pack
          </div>
        ) : null}
      </div>

      <div className={visible ? 'pull-meta pull-meta-visible' : 'pull-meta'}>
        <span className="grade-chip">{pull.grade}</span>
        <div>
          <strong>{pull.name}</strong>
          <small>{pull.set}</small>
        </div>
        <span className="pull-value">${pull.value.toLocaleString()}</span>
      </div>
    </article>
  );
}

export function DuelArena({ entry }: { entry?: DuelLobbyEntry }) {
  const walletConnection = useSolanaWallet();
  const authentication = useWalletAuth();
  const [activeEntry, setActiveEntry] = useState(entry);
  const [mode, setMode] = useState<Mode>(entry?.mode ?? 'matchmaking');
  const [tier, setTier] = useState(entry?.tier ?? 50);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [wallet, setWallet] = useState(entry?.opponentAddress ?? '');
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const [intent, setIntent] = useState<DuelTransactionIntent | null>(null);
  const [intentPending, setIntentPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [persistedDuel, setPersistedDuel] = useState<DurableDuel | null>(null);
  const timers = useRef<number[]>([]);
  const match = useMemo(() => getMatch(tier, nonce), [tier, nonce]);
  const winner = match.left.value >= match.right.value ? 'you' : 'opponent';
  const fee = tier * 0.025;

  function chooseMode(nextMode: Mode) {
    if (nextMode === mode) return;
    setActiveEntry(undefined);
    setMode(nextMode);
    if (nextMode !== 'direct') setWallet('');
  }

  function chooseTier(nextTier: number) {
    setTier(nextTier);
    if (activeEntry?.action === 'accept') setActiveEntry(undefined);
  }

  useEffect(() => {
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    };
  }, []);

  function startDuel(nextTier = tier) {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setTier(nextTier);
    setPhase('matching');
    timers.current.push(window.setTimeout(() => setPhase('opening'), 900));
    timers.current.push(window.setTimeout(() => setPhase('result'), 3100));
  }

  async function reviewDuel(nextTier = tier, nextMode = mode) {
    setActionError(null);
    setTier(nextTier);
    setMode(nextMode);
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
    if (isDuelApiConfigured() && nextTier !== 50) {
      setActionError('Durable devnet matchmaking currently supports the $50 Pokémon pack only.');
      return;
    }

    setIntentPending(true);
    try {
      if (isDuelApiConfigured() && authentication.sessionToken && walletConnection.address) {
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
                  matchmakingMode: nextMode === 'matchmaking' ? 'open' : nextMode,
                  ...(nextMode === 'direct' ? { opponentWallet: wallet.trim() } : {}),
                },
                authentication.sessionToken,
              );
        setPersistedDuel(duel);
        return;
      }
      const preparedIntent = await prepareDuelIntent({
        walletAddress: walletConnection.address,
        opponentType: nextMode,
        opponentAddress: nextMode === 'direct' ? wallet.trim() : undefined,
        packTierUsd: nextTier,
        platformFeeUsd: nextTier * 0.025,
      });
      setIntent(preparedIntent);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not prepare the devnet transaction intent.',
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

  async function approveIntent() {
    if (!intent) return;
    setIntentPending(true);
    setActionError(null);
    try {
      if (intent.serializedTransactionBase64) {
        const binary = window.atob(intent.serializedTransactionBase64);
        const transaction = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const signedTransaction = await walletConnection.signTransaction(transaction);
        await submitSignedDuelIntent(intent.id, signedTransaction);
      }
      setIntent(null);
      startDuel(intent.packTierUsd);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The wallet did not approve the transaction.',
      );
    } finally {
      setIntentPending(false);
    }
  }

  function resetDuel(rematch = false) {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setNonce((value) => value + 1);
    setPhase('lobby');
    if (rematch)
      setActionError('Rematch ready. Review and approve a fresh transaction to continue.');
  }

  async function copyChallenge() {
    const value = `${window.location.origin}/duel/devnet-${tier}?status=waiting`;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be unavailable in preview frames; the visual state remains useful.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function shareResult() {
    const winningPull = winner === 'you' ? match.left : match.right;
    const text = `${winner === 'you' ? 'I just won' : 'This duel was decided'} with ${winningPull.name} worth $${winningPull.value} in a $${tier} Pack Duel. Think you can beat it?`;
    const shareUrl = `${window.location.origin}/duel/demo-${tier}?status=${winner === 'you' ? 'won' : 'lost'}`;
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  if (phase !== 'lobby') {
    return (
      <main className="duel-experience">
        <div className="duel-topline">
          <button type="button" className="text-button" onClick={() => resetDuel()}>
            <ArrowCounterClockwiseIcon size={15} /> Back to lobby
          </button>
          <div className="duel-proof">
            <ShieldCheckIcon size={15} weight="fill" />
            <span>Devnet settlement</span>
            <code>5tE4…7qkP</code>
          </div>
        </div>

        <section className="battle-shell" aria-live="polite">
          <div className="battle-heading">
            <div>
              <span className="eyebrow">
                <SwordIcon size={14} weight="fill" /> ${tier} Pack Duel
              </span>
              <h1>
                {phase === 'matching'
                  ? 'Opponent found'
                  : phase === 'opening'
                    ? 'Ripping packs…'
                    : winner === 'you'
                      ? 'You won both pulls'
                      : 'Opponent takes the vault'}
              </h1>
            </div>
            <div className={`phase-indicator phase-${phase}`}>
              <span />
              {phase === 'matching'
                ? 'Escrow funded'
                : phase === 'opening'
                  ? 'Reveal in progress'
                  : 'Settled'}
            </div>
          </div>

          <div className="reveal-grid">
            <DuelCard
              pull={match.left}
              side="you"
              phase={phase}
              winner={winner === 'you'}
              tier={tier}
              walletLabel={walletConnection.shortAddress ?? 'Your wallet'}
            />
            <div className="versus-mark" aria-hidden="true">
              <span>VS</span>
            </div>
            <DuelCard
              pull={match.right}
              side="opponent"
              phase={phase}
              winner={winner === 'opponent'}
              tier={tier}
              walletLabel={mode === 'house' ? 'Pack Duel House' : match.opponent}
            />
          </div>

          {phase === 'result' ? (
            <div className="result-panel">
              <div className="result-summary">
                <TrophyIcon size={24} weight="fill" />
                <div>
                  <small>Winning margin</small>
                  <strong>
                    ${Math.abs(match.left.value - match.right.value).toLocaleString()}
                  </strong>
                </div>
                <Separator orientation="vertical" className="h-9 bg-border" />
                <div>
                  <small>Total prize value</small>
                  <strong>${(match.left.value + match.right.value).toLocaleString()}</strong>
                </div>
              </div>
              <div className="result-actions">
                <Button type="button" variant="ghost" onClick={() => resetDuel(true)}>
                  <ArrowsLeftRightIcon size={16} /> Rematch
                </Button>
                <Button type="button" className="share-button" onClick={shareResult}>
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
              <LockKeyIcon size={15} /> Non-custodial escrow
            </span>
            <span>
              <ShieldCheckIcon size={15} /> Verified card value
            </span>
            <span>
              <FireIcon size={15} /> Instant reveal
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
                    {!activeEntry ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={copyChallenge}
                        title="Copy devnet challenge preview"
                      >
                        {copied ? (
                          <CheckCircleIcon size={18} weight="fill" />
                        ) : (
                          <CopyIcon size={18} />
                        )}
                      </Button>
                    ) : null}
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
                    We match the same tier. You can cancel before both wallets commit.
                  </span>
                </div>
              ) : null}

              <div className="fee-summary">
                <span>
                  Pack <strong>${tier.toFixed(2)}</strong>
                </span>
                <span>
                  Platform fee <strong>${fee.toFixed(2)}</strong>
                </span>
                <span>
                  You fund <strong>${(tier + fee).toFixed(2)}</strong>
                </span>
              </div>

              <Button
                type="button"
                className="duel-cta"
                onClick={() => reviewDuel()}
                disabled={intentPending || (mode === 'direct' && wallet.trim().length === 0)}
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
            <h2>
              {persistedDuel.status === 'waiting'
                ? 'Challenge created and waiting'
                : persistedDuel.status === 'matched'
                  ? 'Both wallets are matched'
                  : 'Duel cancelled before funding'}
            </h2>
            <p>
              <code>{persistedDuel.id}</code> is persisted by the API. Escrow transaction
              preparation is not live yet, so no funds moved and no pack was opened.
            </p>
          </div>
          <div className="persisted-duel-actions">
            {persistedDuel.status === 'waiting' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  const challengeUrl = `${window.location.origin}/overview?challenge=${encodeURIComponent(persistedDuel.id)}`;
                  await navigator.clipboard.writeText(challengeUrl);
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

      {!isDuelApiConfigured() ? (
        <section className="queue-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                <UsersThreeIcon size={14} weight="fill" /> Open duels
              </span>
              <h2>Someone is ready to rip</h2>
            </div>
            <span className="queue-count">
              <span /> 3 waiting now
            </span>
          </div>
          <div className="queue-grid">
            {waitingDuels.map((duel) => (
              <article className="queue-card" key={duel.wallet}>
                <div className="queue-player">
                  <Avatar color={duel.color} label={`${duel.wallet} avatar`} />
                  <div>
                    <strong>{duel.wallet}</strong>
                    <small>
                      <ClockCountdownIcon size={12} /> Waiting {duel.wait}
                    </small>
                  </div>
                </div>
                <div className="queue-stake">
                  <small>Pack tier</small>
                  <strong>${duel.tier}</strong>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => reviewDuel(duel.tier, 'matchmaking')}
                >
                  Join duel
                </Button>
              </article>
            ))}
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
