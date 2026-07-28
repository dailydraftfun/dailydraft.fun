import {
  PUBLIC_GAME_TAXONOMY_BY_ID,
  type PublicGameTaxonomyId,
} from '@dailydraft/contracts/public-game-taxonomy';

export type GameRulesMode = Exclude<PublicGameTaxonomyId, 'gacha'>;

type RuleFact = {
  detail: string;
  label: string;
};

type RuleStep = {
  detail: string;
  label: string;
};

export type GameRules = {
  canonicalHref: `/games/${string}#rules`;
  custody: string;
  eyebrow: string;
  facts: readonly RuleFact[];
  gates: readonly string[];
  loop: readonly RuleStep[];
  name: string;
  previewHref: `#${string}`;
  previewLabel: string;
  receipt: string;
  refund: string;
  settlement: string;
  state: 'devnet-runtime' | 'fixture-preview';
  stateLegend: readonly RuleFact[];
  statusLabel: string;
  summary: string;
  wallet: string;
};

export const gameRules = {
  crash: {
    canonicalHref: PUBLIC_GAME_TAXONOMY_BY_ID.crash.rulesHref,
    custody:
      'No cards or funds enter custody in this preview. The displayed pot is a fixture, not an entitlement.',
    eyebrow: 'Card Streak · rules docket 03',
    facts: [
      {
        label: 'Eligibility',
        detail:
          'Anyone can browse and run the fixture. Live entry stays unavailable until one approved architecture defines stake, limits, custody, and supported players.',
      },
      {
        label: 'Continue or cash out',
        detail:
          'The local script contains four fixed card stages. Continue reveals the next fixed card through stage four; attempting to continue past stage four ends the script.',
      },
      {
        label: 'Probability rule',
        detail:
          'The preview follows a fixed demonstration sequence. It does not publish or imply commercial bust odds, expected value, or a live payout.',
      },
    ],
    gates: [
      'Approve one Crash architecture and versioned economic rules.',
      'Approve custody, timeout, liquidation, treasury, and risk limits.',
      'Close Collector Crypt and legal-commercial approval for the selected mechanic.',
      'Enable a server-owned session engine, settlement path, and production policy flag.',
    ],
    loop: [
      {
        label: 'Read the stage',
        detail: 'Inspect the current fixed card, displayed fixture pot, and scripted stage number.',
      },
      {
        label: 'Choose once',
        detail: 'Continue the fixture run or stop at the displayed fixture amount.',
      },
      {
        label: 'Resolve',
        detail:
          'Stages two through four reveal their fixed cards. Only an attempt past the final stage triggers the scripted bust state.',
      },
      {
        label: 'Inspect',
        detail: 'Review the terminal reason and fixture receipt without any asset movement.',
      },
    ],
    name: PUBLIC_GAME_TAXONOMY_BY_ID.crash.name,
    previewHref: '#preview-lab',
    previewLabel: 'Run no-value fixture',
    receipt:
      'The preview receipt records fixture decisions, stages, and terminal reason only. It is not a payment, ownership, or settlement receipt.',
    refund:
      'Nothing is charged, so there is nothing to refund. A future live mode must disclose timeout and recovery rules before a wallet can approve entry.',
    settlement:
      'Cash-out and bust are presentation states only. No on-chain settlement or transfer is submitted.',
    state: 'fixture-preview',
    stateLegend: [
      {
        label: 'Committed',
        detail:
          'No commitment or random draw is created. The four-card local sequence is fixed in the interface.',
      },
      {
        label: 'Owned',
        detail: 'Every displayed card remains a presentation asset; the player owns none of them.',
      },
      {
        label: 'Final',
        detail: 'Only the local fixture run ends. No financial or on-chain finality is claimed.',
      },
    ],
    statusLabel: 'Architecture + policy gated',
    summary:
      'Walk through a fixed four-stage card script, then cash out or attempt past the final stage. The bust state occurs only after that final attempt.',
    wallet:
      'No wallet is needed for the fixture. Live Crash will require an approved wallet, funding, custody, and recovery contract; those requirements are intentionally not invented here.',
  },
  duel: {
    canonicalHref: PUBLIC_GAME_TAXONOMY_BY_ID.duel.rulesHref,
    custody:
      'Each participant separately escrows only the displayed test-SOL platform fee. The tier’s demo-pool value is not charged or purchased.',
    eyebrow: 'Card Duel · rules docket 01',
    facts: [
      {
        label: 'Eligibility',
        detail:
          'A server capability check must enable both the chosen opponent mode and demo-pool tier. A direct challenge also needs a complete opponent wallet.',
      },
      {
        label: 'Comparison rule',
        detail:
          'The server compares its demo outcomes using a verified value snapshot. The public receipt—not this overview—is authoritative for the result, fee, asset, and refund states.',
      },
      {
        label: 'Probability source',
        detail:
          'The devnet preview uses a server-provided DailyDraft Pokémon demo pool. Collector Crypt production packs and commercial odds are not active.',
      },
    ],
    gates: [
      'Current server capability must enable the chosen opponent mode and demo-pool tier.',
      'Solana devnet and the transaction-preparation service must be healthy.',
      'Real-value play remains disabled until legal, geography, age, responsible-play, AML, and fee policy are approved.',
      'Production packs require approved Collector Crypt inventory, custody, valuation, and settlement integrations.',
    ],
    loop: [
      {
        label: 'Choose',
        detail:
          'Select an enabled demo-pool tier and a direct, public, or disclosed house opponent. The tier is a pool label, not an amount charged.',
      },
      {
        label: 'Review',
        detail:
          'Connect and verify a Solana wallet, then separately inspect and approve your exact test-SOL platform fee.',
      },
      {
        label: 'Open',
        detail:
          'Opening begins only after both participants’ platform-fee transactions finalize on devnet.',
      },
      {
        label: 'Settle',
        detail:
          'The receipt exposes the comparison outcome separately from payment, demo-asset, and refund finality.',
      },
    ],
    name: PUBLIC_GAME_TAXONOMY_BY_ID.duel.name,
    previewHref: '#duel-lobby',
    previewLabel: 'Check live duel options',
    receipt:
      'The public receipt separates the committed result, each participant’s fee references, and current demo-asset or refund status. It does not claim production ownership.',
    refund:
      'A challenge can be cancelled before funding starts. After either wallet pays, it follows opening, settlement, or the safe-refund path.',
    settlement:
      'A committed comparison can be final while card transfers or refunds are still finishing. The receipt names both states.',
    state: 'devnet-runtime',
    stateLegend: [
      {
        label: 'Committed',
        detail: 'The comparison snapshot and result are fixed before the result is shown.',
      },
      {
        label: 'Owned',
        detail:
          'Do not infer ownership from the reveal. Check the public receipt for the current demo-asset state.',
      },
      {
        label: 'Final',
        detail: 'The public receipt exposes completed settlement or refund references separately.',
      },
    ],
    statusLabel: 'Capability check required',
    summary:
      'The tier selects a server-provided demo pool; its value is not charged or purchased. Each participant separately escrows the displayed test-SOL fee, and opening waits for both fees to finalize.',
    wallet:
      'Browsing needs no wallet. To enter, use a Wallet Standard Solana wallet on devnet, sign a no-value ownership message, then separately approve the exact displayed test-SOL transaction.',
  },
  flip: {
    canonicalHref: PUBLIC_GAME_TAXONOMY_BY_ID.flip.rulesHref,
    custody:
      'No marketplace card is reserved, bought, escrowed, or transferred. Every image and value belongs to the fixture.',
    eyebrow: 'Marketplace Flip · rules docket 02',
    facts: [
      {
        label: 'Eligibility',
        detail:
          'Anyone can browse and run the fixture. Live entry remains unavailable until an approved collection, tier, listing freshness, liquidity, and exposure policy all pass.',
      },
      {
        label: 'Probability rule',
        detail:
          'Floor, Core, and Chase are display controls only. They do not change the fixed card result and are not odds, probability bands, or a draw.',
      },
      {
        label: 'Acquisition rule',
        detail:
          'A future live reveal cannot be final until the selected listing is acquired or the predetermined failure policy completes.',
      },
    ],
    gates: [
      'Obtain Collector Crypt permission for marketplace inventory in a chance-based partner game.',
      'Approve reservation, repricing, acquisition-failure, buyback, and liquidation policy.',
      'Approve live collections, tiers, probability bands, fees, liquidity, and exposure limits.',
      'Enable provider credentials, purchase and transfer orchestration, settlement, and the production policy flag.',
    ],
    loop: [
      {
        label: 'Choose',
        detail:
          'Choose a display band for the walkthrough. The control does not affect the fixed result.',
      },
      {
        label: 'Advance',
        detail:
          'Advance a scripted local state. No pool snapshot, seed, commitment, or selection proof is created.',
      },
      {
        label: 'Reveal',
        detail:
          'Show the same fixed example card every time. No marketplace selection or acquisition occurs.',
      },
      {
        label: 'Inspect',
        detail: 'Review selection, purchase, ownership, and finality as separate receipt facts.',
      },
    ],
    name: PUBLIC_GAME_TAXONOMY_BY_ID.flip.name,
    previewHref: '#preview-lab',
    previewLabel: 'Run no-value fixture',
    receipt:
      'The local summary records only which scripted screen was shown. It provides no selection proof; purchase, transfer, ownership, and settlement remain “not submitted.”',
    refund:
      'Nothing is charged, so there is nothing to refund. Live reselection, substitute, or refund behavior awaits explicit commercial approval.',
    settlement:
      'The reveal is a fixture state, not settlement. A live result cannot be final until acquisition and transfer policy succeed.',
    state: 'fixture-preview',
    stateLegend: [
      {
        label: 'Committed',
        detail:
          'Nothing is committed or sealed. A click only advances the local scripted interface.',
      },
      {
        label: 'Owned',
        detail: 'No selected listing is purchased or transferred; ownership never changes.',
      },
      {
        label: 'Final',
        detail:
          'Only the local script ends. No selection, marketplace, payment, or chain finality is claimed.',
      },
    ],
    statusLabel: 'Commercial + provider gated',
    summary:
      'Walk through a scripted local marketplace UI with a fixed result. There is no sealed pool, random draw, reproducible selection proof, purchase, or ownership change.',
    wallet:
      'No wallet is needed for the fixture. A future live flow will require an approved Solana wallet and explicit transaction review, but no funding CTA is exposed before the commercial contract exists.',
  },
} as const satisfies Record<GameRulesMode, GameRules>;

export function canonicalRulesHref(mode: GameRulesMode): GameRules['canonicalHref'] {
  return gameRules[mode].canonicalHref;
}
