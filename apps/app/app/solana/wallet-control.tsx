'use client';

import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CopyIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WalletIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Button } from '@shipshitdev/ui';
import Image from 'next/image';
import { useState } from 'react';
import { useDialogFocus } from '../accessibility/use-dialog-focus';
import { journeyTestIds } from '../e2e/journey-test-ids';
import { describeWalletBalance } from './balance';
import { getExplorerAddressUrl } from './config';
import { getWalletAuthPresentation } from './wallet-auth-presentation';
import { useWalletAuth } from './wallet-auth-provider';
import { useSolanaWallet } from './wallet-provider';

export function WalletControl() {
  const wallet = useSolanaWallet();
  const authentication = useWalletAuth();
  const authenticationPresentation = getWalletAuthPresentation(
    authentication.status,
    authentication.expiresAt,
  );
  const balance = describeWalletBalance(wallet.balanceStatus, wallet.balances);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialogFocus({
    active: open,
    onClose: () => setOpen(false),
  });

  async function copyAddress() {
    if (!wallet.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className={wallet.address ? 'wallet-button wallet-button-connected' : 'wallet-button'}
        aria-haspopup="dialog"
        data-testid={journeyTestIds.walletMenu}
      >
        {wallet.status === 'connecting' || wallet.status === 'discovering' ? (
          <SpinnerGapIcon className="wallet-spinner" size={16} />
        ) : (
          <WalletIcon size={16} weight={wallet.address ? 'fill' : 'bold'} />
        )}
        <span>{wallet.shortAddress ?? 'Connect wallet'}</span>
        {balance?.ready ? (
          <span className="wallet-button-balance" data-testid={journeyTestIds.walletBalance}>
            {balance.label}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="wallet-dialog-backdrop">
          <button
            type="button"
            className="dialog-dismiss-layer"
            onClick={() => setOpen(false)}
            aria-label="Close wallet dialog"
          />
          <section
            ref={dialogRef}
            className="wallet-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
            aria-describedby="wallet-dialog-description"
            tabIndex={-1}
            data-testid={journeyTestIds.walletDialog}
          >
            <div className="wallet-dialog-heading">
              <div>
                <span className={`network-chip network-${wallet.networkStatus}`}>
                  <i /> Solana devnet · {wallet.networkStatus}
                </span>
                <h2 id="wallet-dialog-title">
                  {wallet.address ? 'Wallet connected' : 'Choose a wallet'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close wallet dialog"
                data-dialog-initial-focus
              >
                <XIcon size={18} />
              </button>
            </div>

            {wallet.address ? (
              <div className="wallet-account-panel">
                <div className="wallet-account-name">
                  {wallet.selectedWallet ? (
                    <Image
                      src={wallet.selectedWallet.icon}
                      alt=""
                      width={34}
                      height={34}
                      unoptimized
                    />
                  ) : null}
                  <div>
                    <strong>{wallet.selectedWallet?.name}</strong>
                    <code>{wallet.address}</code>
                    {balance ? (
                      <small className="wallet-account-balance">{balance.label}</small>
                    ) : null}
                  </div>
                </div>
                <div className="wallet-account-actions">
                  <Button type="button" variant="ghost" onClick={copyAddress}>
                    {copied ? <CheckCircleIcon size={16} weight="fill" /> : <CopyIcon size={16} />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <a href={getExplorerAddressUrl(wallet.address)} target="_blank" rel="noreferrer">
                    Explorer <ArrowSquareOutIcon size={14} />
                  </a>
                </div>
                <div className="wallet-authentication-panel">
                  <div className="wallet-authentication-heading">
                    <div>
                      <strong>{authenticationPresentation.title}</strong>
                      <small>{authenticationPresentation.detail}</small>
                    </div>
                    <span
                      className={
                        authenticationPresentation.isActive
                          ? 'auth-status auth-status-active'
                          : 'auth-status'
                      }
                    >
                      {authenticationPresentation.badge}
                    </span>
                  </div>

                  {authentication.challenge ? (
                    <div className="wallet-auth-message">
                      <p>Review the exact message your wallet will sign:</p>
                      <pre>{authentication.challenge.message}</pre>
                      <Button
                        type="button"
                        onClick={authentication.signIn}
                        disabled={authentication.status === 'signing'}
                        data-testid={journeyTestIds.walletAuthenticationSign}
                      >
                        {authentication.status === 'signing' ? (
                          <SpinnerGapIcon className="wallet-spinner" size={16} />
                        ) : (
                          <ShieldCheckIcon size={16} weight="fill" />
                        )}
                        {authentication.status === 'signing'
                          ? 'Waiting for signature'
                          : 'Sign authentication message'}
                      </Button>
                    </div>
                  ) : authentication.status !== 'authenticated' ? (
                    <Button
                      type="button"
                      onClick={authentication.prepare}
                      disabled={
                        authentication.status === 'preparing' ||
                        authentication.status === 'restoring'
                      }
                      data-testid={journeyTestIds.walletAuthenticationPrepare}
                    >
                      {authentication.status === 'preparing' ||
                      authentication.status === 'restoring' ? (
                        <SpinnerGapIcon className="wallet-spinner" size={16} />
                      ) : (
                        <ShieldCheckIcon size={16} />
                      )}
                      {authentication.status === 'restoring'
                        ? 'Restoring session'
                        : authentication.status === 'preparing'
                          ? 'Preparing message'
                          : 'Review authentication message'}
                    </Button>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="wallet-disconnect"
                  data-testid={journeyTestIds.walletDisconnect}
                  onClick={async () => {
                    await authentication.signOut();
                    await wallet.disconnect();
                    setOpen(false);
                  }}
                >
                  Disconnect wallet
                </Button>
              </div>
            ) : wallet.wallets.length > 0 ? (
              <div className="wallet-list">
                {wallet.wallets.map((availableWallet) => (
                  <button
                    type="button"
                    key={availableWallet.name}
                    disabled={wallet.status === 'connecting'}
                    data-testid={journeyTestIds.walletOption}
                    onClick={async () => {
                      const connected = await wallet.connect(availableWallet);
                      if (connected) setOpen(false);
                    }}
                  >
                    <Image src={availableWallet.icon} alt="" width={30} height={30} unoptimized />
                    <span className="wallet-list-copy">
                      <strong>{availableWallet.name}</strong>
                      <small>Wallet Standard · devnet</small>
                    </span>
                    {wallet.status === 'connecting' ? (
                      <SpinnerGapIcon className="wallet-spinner" size={17} />
                    ) : (
                      <span aria-hidden="true">→</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="wallet-empty-state">
                <WalletIcon size={30} />
                <strong>No compatible Solana wallet found</strong>
                <p>Install a Wallet Standard wallet, refresh this page, then connect on devnet.</p>
              </div>
            )}

            {wallet.error ? (
              <div className="wallet-error" role="alert">
                <WarningCircleIcon size={17} weight="fill" />
                <span>{wallet.error}</span>
                <button type="button" onClick={wallet.clearError} aria-label="Dismiss wallet error">
                  <XIcon size={14} />
                </button>
              </div>
            ) : null}

            {authentication.error ? (
              <div className="wallet-error" role="alert">
                <WarningCircleIcon size={17} weight="fill" />
                <span>{authentication.error}</span>
                <button
                  type="button"
                  onClick={authentication.clearError}
                  aria-label="Dismiss authentication error"
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : null}

            {wallet.networkStatus === 'offline' ? (
              <div className="wallet-error" role="alert">
                <WarningCircleIcon size={17} weight="fill" />
                <span>
                  Devnet RPC is unreachable. Connection may work, but transaction preparation is
                  paused until the network recovers.
                </span>
              </div>
            ) : null}

            <p id="wallet-dialog-description" className="wallet-safety-note">
              We only request connection and clearly reviewed signatures. Never enter or share a
              seed phrase or private key.
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
