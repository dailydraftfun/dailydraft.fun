import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SharedOpponentControl } from './duel-shared-opponent';

const callbacks = {
  onLocalWalletChange: () => undefined,
  onStartFreshDuel: () => undefined,
};

describe('shared duel opponent control', () => {
  test('renders invitation identity as a pseudonymous read-only value with a reason', () => {
    const markup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{ action: 'accept', opponentLabel: 'Creator abcd…wxyz', tier: 50 }}
        localWallet=""
        rematchPending={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(markup).toContain('value="Creator abcd…wxyz"');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('The creator wallet stays private on this public route.');
  });

  test('gives disconnected and non-participant rematch viewers a fresh-duel path', () => {
    const markup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{
          action: 'rematch',
          participantLabels: { creator: 'Creator', opponent: 'Opponent' },
          tier: 50,
        }}
        localWallet=""
        rematchPending={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(markup).toContain('Fresh duel available');
    expect(markup).toContain('Start a fresh duel');
    expect(markup).toContain('public matchmaking');
    expect(markup).not.toContain('readOnly=""');
  });

  test('locks a verified rematch opponent and leaves fresh direct entry editable', () => {
    const resolvedMarkup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{
          action: 'rematch',
          participantLabels: { creator: 'Creator', opponent: 'Opponent' },
          tier: 50,
        }}
        localWallet=""
        rematchPending={false}
        resolvedOpponentLabel="Opponent abcd…wxyz"
      />,
    );
    const freshMarkup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        localWallet="editable_wallet"
        rematchPending={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(resolvedMarkup).toContain('readOnly=""');
    expect(resolvedMarkup).toContain('verified as an original participant');
    expect(freshMarkup).toContain('value="editable_wallet"');
    expect(freshMarkup).not.toContain('readOnly=""');
  });
});
