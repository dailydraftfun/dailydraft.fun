import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Wallet discovery only runs from an effect, which server rendering never reaches,
// but the registry is stubbed so importing the provider cannot touch a real browser
// wallet registry the way apps/app/app/duel/duel-entry-stepper.test.tsx stubs its
// wallet dependencies.
mock.module('@wallet-standard/app', () => ({
  getWallets: () => ({
    get: () => [],
    on: () => () => undefined,
  }),
}));

const { SolanaWalletProvider, useSolanaWallet } = await import('./wallet-provider');

function WalletProbe() {
  const wallet = useSolanaWallet();
  return <span>{`${wallet.status}:${wallet.cluster}`}</span>;
}

describe('solana wallet provider', () => {
  test('exposes wallet state to descendants before any wallet connects', () => {
    const markup = renderToStaticMarkup(
      <SolanaWalletProvider>
        <WalletProbe />
      </SolanaWalletProvider>,
    );

    expect(markup).toContain('discovering:devnet');
  });

  test('refuses to hand out wallet state outside the provider', () => {
    expect(() => renderToStaticMarkup(<WalletProbe />)).toThrow(
      'useSolanaWallet must be used inside SolanaWalletProvider.',
    );
  });

  test('persists the selected wallet under the rebranded storage namespace', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('./wallet-provider.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const walletStorageKey = 'dailydraft.wallet';");
    expect(source).not.toContain('openpacksduel');
  });
});
