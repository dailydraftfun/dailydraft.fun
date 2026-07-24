import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityPreview } from './activity-preview';

describe('activity preview', () => {
  test('defaults to explicit receipt examples without claiming live activity', () => {
    const markup = renderToStaticMarkup(<ActivityPreview />);

    expect(markup).toContain('Proof makes the lobby feel alive');
    expect(markup).toContain('Duel receipt demo');
    expect(markup).toContain('Refund receipt demo');
    expect(markup).toContain('Open leaderboard model');
    expect(markup).toContain('Example wallet');
    expect(markup).not.toContain('Flip preview');
  });

  test('can render fixture previews without claiming they are verified', () => {
    const markup = renderToStaticMarkup(<ActivityPreview initialProof="all" />);

    expect(markup).toContain('Flip preview');
    expect(markup).toContain('Crash preview');
    expect(markup).toContain('Fixture player');
    expect(markup).toContain('Open preview');
    expect(markup).toContain('No fabricated live counts');
    expect(markup).not.toContain('min ago');
  });

  test('renders honest loading, degraded, and empty states', () => {
    const loading = renderToStaticMarkup(<ActivityPreview initialHealth="loading" />);
    const degraded = renderToStaticMarkup(<ActivityPreview initialHealth="degraded" />);
    const empty = renderToStaticMarkup(<ActivityPreview initialHealth="empty" />);

    expect(loading).toContain('Checking activity projection');
    expect(degraded).toContain('Activity service degraded');
    expect(empty).toContain('No activity to show');
    expect(empty).toContain('does not invent participation or volume');
  });
});
