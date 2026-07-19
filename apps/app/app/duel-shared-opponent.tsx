import { UserPlusIcon } from '@phosphor-icons/react';
import { Button, Input } from '@shipshitdev/ui';
import { journeyTestIds } from './e2e/journey-test-ids';

export type SharedOpponentEntry =
  | {
      action: 'accept';
      opponentLabel: string;
      tier: number;
    }
  | {
      action: 'rematch';
      participantLabels: {
        creator: string;
        opponent: string;
      };
      tier: number;
    };

export function SharedOpponentControl({
  entry,
  localWallet,
  onLocalWalletChange,
  onRetryRematch,
  onStartFreshDuel,
  rematchNeedsConnection,
  rematchPending,
  rematchResolutionFailed,
  resolvedOpponentLabel,
}: {
  entry?: SharedOpponentEntry;
  localWallet: string;
  onLocalWalletChange: (wallet: string) => void;
  onRetryRematch: () => void;
  onStartFreshDuel: () => void;
  rematchNeedsConnection: boolean;
  rematchPending: boolean;
  rematchResolutionFailed: boolean;
  resolvedOpponentLabel: string | null;
}) {
  if (entry?.action === 'accept') {
    return (
      <div className="wallet-challenge-panel">
        <OpponentDisclosure
          detail={`This invitation reserves the $${entry.tier} direct-wallet seat. Choose another mode to leave it.`}
          headline={`Challenge from ${entry.opponentLabel}`}
        />
        <label htmlFor="opponent-wallet">Challenge creator</label>
        <Input
          aria-describedby="shared-opponent-reason"
          className="wallet-input"
          data-testid={journeyTestIds.opponentWallet}
          id="opponent-wallet"
          readOnly
          value={entry.opponentLabel}
        />
        <p className="signing-note" id="shared-opponent-reason">
          Locked by the invitation. The creator wallet stays private on this public route.
        </p>
      </div>
    );
  }

  if (entry?.action === 'rematch') {
    if (resolvedOpponentLabel) {
      return (
        <div className="wallet-challenge-panel">
          <OpponentDisclosure
            detail={`The original $${entry.tier} tier and opponent are ready for a fresh commitment.`}
            headline={`Rematch against ${resolvedOpponentLabel}`}
          />
          <label htmlFor="opponent-wallet">Original opponent</label>
          <Input
            aria-describedby="shared-opponent-reason"
            className="wallet-input"
            data-testid={journeyTestIds.opponentWallet}
            id="opponent-wallet"
            readOnly
            value={resolvedOpponentLabel}
          />
          <p className="signing-note" id="shared-opponent-reason">
            Locked after the connected wallet was verified as an original participant.
          </p>
        </div>
      );
    }

    return (
      <div className="wallet-challenge-panel">
        <OpponentDisclosure
          detail={
            rematchNeedsConnection
              ? 'Connect and authenticate an original participant wallet from the wallet menu to unlock this private rematch.'
              : rematchPending
                ? 'Checking whether the connected wallet played in the original duel.'
                : rematchResolutionFailed
                  ? 'The private rematch could not be verified. Retry the participant check without leaving this page.'
                  : 'Connect an original participant wallet for the private rematch, or leave the link and choose any duel mode.'
          }
          headline={
            rematchNeedsConnection
              ? 'Connect the original wallet'
              : rematchPending
                ? 'Checking rematch eligibility'
                : rematchResolutionFailed
                  ? 'Could not verify rematch'
                  : 'Fresh duel available'
          }
        />
        {rematchResolutionFailed ? (
          <Button type="button" variant="ghost" onClick={onRetryRematch}>
            Retry rematch check
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onStartFreshDuel}>
          Start a fresh duel
        </Button>
        <p className="signing-note">
          A fresh duel can use an editable wallet, public matchmaking, or an available house.
        </p>
      </div>
    );
  }

  return (
    <div className="wallet-challenge-panel">
      <label htmlFor="opponent-wallet">Opponent wallet</label>
      <div className="wallet-input-row">
        <Input
          className="wallet-input"
          data-testid={journeyTestIds.opponentWallet}
          id="opponent-wallet"
          onChange={(event) => onLocalWalletChange(event.target.value)}
          placeholder="Solana wallet address"
          value={localWallet}
        />
      </div>
    </div>
  );
}

function OpponentDisclosure({ detail, headline }: { detail: string; headline: string }) {
  return (
    <div className="opponent-disclosure">
      <UserPlusIcon size={18} weight="fill" />
      <span>
        <strong>{headline}</strong>
        {detail}
      </span>
    </div>
  );
}
