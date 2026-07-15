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
  SwordIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersThreeIcon,
  XLogoIcon,
} from '@phosphor-icons/react';
import { Button, Card, CardContent, Input, Separator } from '@shipshitdev/ui';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

type Mode = 'quick' | 'wallet';
type Phase = 'lobby' | 'matching' | 'opening' | 'result';

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
  onSelect,
}: {
  value: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={selected ? 'tier-card tier-card-selected' : 'tier-card'}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
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
}: {
  pull: Pull;
  side: 'you' | 'opponent';
  phase: Phase;
  winner: boolean;
  tier: number;
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
          <strong>{side === 'you' ? '8xK4…p2Te' : 'Boba.sol'}</strong>
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

export function DuelArena() {
  const [mode, setMode] = useState<Mode>('quick');
  const [tier, setTier] = useState(50);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [wallet, setWallet] = useState('');
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const timers = useRef<number[]>([]);
  const match = useMemo(() => getMatch(tier, nonce), [tier, nonce]);
  const winner = match.left.value >= match.right.value ? 'you' : 'opponent';
  const fee = tier * 0.025;

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

  function resetDuel(rematch = false) {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setNonce((value) => value + 1);
    setPhase('lobby');
    if (rematch) window.setTimeout(() => startDuel(), 80);
  }

  async function copyChallenge() {
    const value = 'https://packduel.gg/challenge/demo-50';
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
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://packduel.gg/duel/demo')}`,
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
            <span>Demo settlement</span>
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
            <LightningIcon size={14} weight="fill" /> Live on Solana · UI demo
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
                aria-selected={mode === 'quick'}
                onClick={() => setMode('quick')}
              >
                <LightningIcon size={17} weight="fill" />
                <span className="mode-tab-copy">
                  <strong className="mode-tab-title">Quick Duel</strong>
                  <small className="mode-tab-caption">Match instantly</small>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'wallet'}
                onClick={() => setMode('wallet')}
              >
                <UserPlusIcon size={17} weight="bold" />
                <span className="mode-tab-copy">
                  <strong className="mode-tab-title">Challenge Wallet</strong>
                  <small className="mode-tab-caption">Invite a friend</small>
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
                    onSelect={() => setTier(value)}
                  />
                ))}
              </div>

              {mode === 'wallet' ? (
                <div className="wallet-challenge-panel">
                  <label htmlFor="opponent-wallet">Opponent wallet</label>
                  <div className="wallet-input-row">
                    <Input
                      id="opponent-wallet"
                      value={wallet}
                      onChange={(event) => setWallet(event.target.value)}
                      placeholder="Wallet address or .sol name"
                      className="wallet-input"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={copyChallenge}
                      title="Copy challenge link"
                    >
                      {copied ? (
                        <CheckCircleIcon size={18} weight="fill" />
                      ) : (
                        <CopyIcon size={18} />
                      )}
                    </Button>
                  </div>
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
                onClick={() => startDuel()}
                disabled={mode === 'wallet' && wallet.trim().length === 0}
              >
                {mode === 'quick' ? (
                  <LightningIcon size={18} weight="fill" />
                ) : (
                  <LinkIcon size={18} weight="bold" />
                )}
                {mode === 'quick' ? `Find a $${tier} duel` : `Create $${tier} challenge`}
              </Button>
              <p className="signing-note">
                <InfoIcon size={13} /> Demo only — no wallet signature or transaction will be
                requested.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

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
              <Button type="button" variant="ghost" onClick={() => startDuel(duel.tier)}>
                Join duel
              </Button>
            </article>
          ))}
        </div>
      </section>

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
    </main>
  );
}
