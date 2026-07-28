export type GameRulesMode = 'crash' | 'duel' | 'flip';

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
    canonicalHref: '/games/crash#rules',
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
          'Each fixture stage offers Continue or Cash out. The next committed fixture stage either adds its displayed card value or busts the run.',
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
        detail: 'Inspect the fixture card, displayed pot, and next committed stage boundary.',
      },
      {
        label: 'Choose once',
        detail: 'Continue the fixture run or stop at the displayed fixture amount.',
      },
      {
        label: 'Resolve',
        detail: 'The next fixture stage adds its card or ends the simulated run as a bust.',
      },
      {
        label: 'Inspect',
        detail: 'Review the terminal reason and fixture receipt without any asset movement.',
      },
    ],
    name: 'Card Streak',
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
        detail: 'The fixture sequence and next demonstration state are fixed for the preview.',
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
      'Build a card streak, then stop or risk the next committed fixture stage. This surface demonstrates the decision rhythm—not live economics.',
    wallet:
      'No wallet is needed for the fixture. Live Crash will require an approved wallet, funding, custody, and recovery contract; those requirements are intentionally not invented here.',
  },
  duel: {
    canonicalHref: '/games/duel#rules',
    custody:
      'The devnet contract can hold test assets while the duel resolves. Production Collector Crypt custody is not active.',
    eyebrow: 'Card Duel · rules docket 01',
    facts: [
      {
        label: 'Eligibility',
        detail:
          'A server capability check must enable both the chosen opponent mode and pack tier. A direct challenge also needs a complete opponent wallet.',
      },
      {
        label: 'Comparison rule',
        detail:
          'The higher server-verified value snapshot wins both demo cards. Equal values return each original card and both platform fees.',
      },
      {
        label: 'Probability source',
        detail:
          'The devnet preview uses a server-provided DailyDraft Pokémon demo pool. Collector Crypt production packs and commercial odds are not active.',
      },
    ],
    gates: [
      'Current server capability must enable the chosen opponent mode and pack tier.',
      'Solana devnet and the transaction-preparation service must be healthy.',
      'Real-value play remains disabled until legal, geography, age, responsible-play, AML, and fee policy are approved.',
      'Production packs require approved Collector Crypt inventory, custody, valuation, and settlement integrations.',
    ],
    loop: [
      {
        label: 'Choose',
        detail: 'Select an enabled pack tier and a direct, public, or disclosed house opponent.',
      },
      {
        label: 'Review',
        detail: 'Connect and verify a Solana wallet, then inspect the exact devnet platform fee.',
      },
      {
        label: 'Open',
        detail: 'After both wallets pay, both hidden demo pulls open on the same reveal beat.',
      },
      {
        label: 'Settle',
        detail: 'Higher verified value receives both demo cards; a tie returns each original card.',
      },
    ],
    name: 'Card Duel',
    previewHref: '#duel-lobby',
    previewLabel: 'Check live duel options',
    receipt:
      'The public receipt separates the committed result from Solana transaction references and final card ownership.',
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
        detail: 'Card ownership changes only after the required devnet transfer completes.',
      },
      {
        label: 'Final',
        detail: 'The public receipt exposes completed settlement or refund references separately.',
      },
    ],
    statusLabel: 'Runtime checked · devnet',
    summary:
      'Two wallets fund the same enabled tier. Both demo pulls stay hidden, reveal together, and the higher verified value wins both cards.',
    wallet:
      'Browsing needs no wallet. To enter, use a Wallet Standard Solana wallet on devnet, sign a no-value ownership message, then separately approve the exact displayed test-SOL transaction.',
  },
  flip: {
    canonicalHref: '/games/marketplace-flip#rules',
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
          'The fixture shows disclosed Floor, Core, and Chase bands against a sealed demonstration pool. It does not claim commercial odds or expected value.',
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
        detail: 'Select a fixture inventory band with its displayed size and demonstration price.',
      },
      {
        label: 'Commit',
        detail: 'Seal the fixture pool snapshot and disclosed probability bands before selection.',
      },
      {
        label: 'Reveal',
        detail: 'Show the reproducibly selected fixture card and keep acquisition status explicit.',
      },
      {
        label: 'Inspect',
        detail: 'Review selection, purchase, ownership, and finality as separate receipt facts.',
      },
    ],
    name: 'Marketplace Flip',
    previewHref: '#preview-lab',
    previewLabel: 'Run no-value fixture',
    receipt:
      'The fixture receipt proves only the demonstration selection. Purchase, transfer, ownership, and settlement remain “not submitted.”',
    refund:
      'Nothing is charged, so there is nothing to refund. Live reselection, substitute, or refund behavior awaits explicit commercial approval.',
    settlement:
      'The reveal is a fixture state, not settlement. A live result cannot be final until acquisition and transfer policy succeed.',
    state: 'fixture-preview',
    stateLegend: [
      {
        label: 'Committed',
        detail: 'The fixture pool and probability bands are sealed before the demonstration draw.',
      },
      {
        label: 'Owned',
        detail: 'No selected listing is purchased or transferred; ownership never changes.',
      },
      {
        label: 'Final',
        detail:
          'Only the fixture selection completes. No marketplace or chain finality is claimed.',
      },
    ],
    statusLabel: 'Commercial + provider gated',
    summary:
      'Commit an eligible marketplace pool, select within disclosed fixture bands, and keep selection, acquisition, and ownership visibly separate.',
    wallet:
      'No wallet is needed for the fixture. A future live flow will require an approved Solana wallet and explicit transaction review, but no funding CTA is exposed before the commercial contract exists.',
  },
} as const satisfies Record<GameRulesMode, GameRules>;

export function canonicalRulesHref(mode: GameRulesMode): GameRules['canonicalHref'] {
  return gameRules[mode].canonicalHref;
}
