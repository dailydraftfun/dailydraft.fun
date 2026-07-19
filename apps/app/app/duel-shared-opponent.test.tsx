import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SharedOpponentControl } from './duel-shared-opponent';

const callbacks = {
  onLocalWalletChange: () => undefined,
  onRetryRematch: () => undefined,
  onStartFreshDuel: () => undefined,
};

describe('shared duel opponent control', () => {
  test('renders invitation identity as a pseudonymous read-only value with a reason', () => {
    const markup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{ action: 'accept', opponentLabel: 'Creator abcd…wxyz', tier: 50 }}
        localWallet=""
        rematchNeedsConnection={false}
        rematchPending={false}
        rematchResolutionFailed={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(markup).toContain('value="Creator abcd…wxyz"');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('The creator wallet stays private on this public route.');
  });

  test('asks disconnected rematch viewers to connect an original wallet', () => {
    const markup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{
          action: 'rematch',
          participantLabels: { creator: 'Creator', opponent: 'Opponent' },
          tier: 50,
        }}
        localWallet=""
        rematchNeedsConnection={true}
        rematchPending={false}
        rematchResolutionFailed={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(markup).toContain('Connect the original wallet');
    expect(markup).toContain('Connect and authenticate an original participant wallet');
    expect(markup).not.toContain('Fresh duel available');
  });

  test('gives connected non-participant rematch viewers a fresh-duel path', () => {
    const markup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{
          action: 'rematch',
          participantLabels: { creator: 'Creator', opponent: 'Opponent' },
          tier: 50,
        }}
        localWallet=""
        rematchNeedsConnection={false}
        rematchPending={false}
        rematchResolutionFailed={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(markup).toContain('Fresh duel available');
    expect(markup).toContain('Start a fresh duel');
    expect(markup).toContain('public matchmaking');
    expect(markup).not.toContain('readOnly=""');
  });

  test('offers a retry instead of declaring ineligibility after verification fails', () => {
    const markup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        entry={{
          action: 'rematch',
          participantLabels: { creator: 'Creator', opponent: 'Opponent' },
          tier: 50,
        }}
        localWallet=""
        rematchNeedsConnection={false}
        rematchPending={false}
        rematchResolutionFailed={true}
        resolvedOpponentLabel={null}
      />,
    );

    expect(markup).toContain('Could not verify rematch');
    expect(markup).toContain('Retry rematch check');
    expect(markup).not.toContain('Fresh duel available');
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
        rematchNeedsConnection={false}
        rematchPending={false}
        rematchResolutionFailed={false}
        resolvedOpponentLabel="Opponent abcd…wxyz"
      />,
    );
    const freshMarkup = renderToStaticMarkup(
      <SharedOpponentControl
        {...callbacks}
        localWallet="editable_wallet"
        rematchNeedsConnection={false}
        rematchPending={false}
        rematchResolutionFailed={false}
        resolvedOpponentLabel={null}
      />,
    );

    expect(resolvedMarkup).toContain('readOnly=""');
    expect(resolvedMarkup).toContain('verified as an original participant');
    expect(freshMarkup).toContain('value="editable_wallet"');
    expect(freshMarkup).not.toContain('readOnly=""');
  });
});
