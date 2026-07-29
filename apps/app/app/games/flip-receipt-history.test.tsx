import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlipReceiptHistory, flipPublicReceipts } from './flip-receipt-history';

describe('Marketplace Flip public receipt and history', () => {
  test('shows a complete acquired receipt with proof, economics, and ownership state', () => {
    const markup = renderToStaticMarkup(<FlipReceiptHistory />);

    expect(markup).toContain('Acquisition evidence');
    expect(markup).toContain('Charizard · Base Set');
    expect(markup).toContain('flip-pool-17');
    expect(markup).toContain('Chase · 7.5%');
    expect(markup).toContain('selection-proof-v1');
    expect(markup).toContain('Provider-confirmed · sensitive payload redacted');
    expect(markup).toContain('Ownership confirmed');
    expect(markup).toContain('Keep fixture card');
    expect(markup).toContain('Listing unavailable');
    expect(markup).toContain('aria-disabled="true"');
  });

  test('defines purchase, transfer, refund, dispute, failure, and acquired paths', () => {
    expect(flipPublicReceipts.map((receipt) => receipt.status)).toEqual([
      'acquired',
      'purchase_pending',
      'transfer_pending',
      'refunded',
      'disputed',
      'failed',
    ]);
    expect(flipPublicReceipts.every((receipt) => receipt.nextAction.length > 0)).toBe(true);
  });

  test('renders bounded history with a status filter and pagination control', () => {
    const markup = renderToStaticMarkup(<FlipReceiptHistory />);

    expect(markup).toContain('Every terminal path stays clear');
    expect(markup).toContain('All statuses');
    expect(markup).toContain('data-flip-history-count="3"');
    expect(markup).toContain('Load older receipts');
  });

  test('never serializes provider secrets, signatures, tokens, or transaction payloads', () => {
    const serialized = JSON.stringify(flipPublicReceipts);

    expect(serialized).not.toMatch(
      /api[_-]?key|authorization|bearer|credential|private[_-]?key|provider[_-]?secret|raw[_-]?transaction|signature|token/i,
    );
    expect(serialized).not.toContain('walletAddress');
    expect(serialized).not.toContain('providerOrderId');
  });
});
