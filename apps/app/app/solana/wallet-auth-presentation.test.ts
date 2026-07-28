import { describe, expect, test } from 'bun:test';

import { getWalletAuthPresentation } from './wallet-auth-presentation';

describe('wallet authentication presentation', () => {
  test('describes active, restoring, and required states without implying a transaction', () => {
    expect(getWalletAuthPresentation('authenticated', '2099-01-01T01:00:00.000Z')).toMatchObject({
      badge: 'Active',
      isActive: true,
      title: 'Authenticated to play',
    });
    expect(getWalletAuthPresentation('authenticated', null)).toEqual({
      badge: 'Active',
      detail: 'Authenticated session active',
      isActive: true,
      title: 'Authenticated to play',
    });
    expect(getWalletAuthPresentation('restoring', null)).toEqual({
      badge: 'Checking',
      detail: 'Checking the existing session · no signature',
      isActive: false,
      title: 'Restoring wallet session',
    });
    expect(getWalletAuthPresentation('unauthenticated', null)).toEqual({
      badge: 'Required',
      detail: 'One readable Ed25519 signature · no transaction',
      isActive: false,
      title: 'Authenticate wallet ownership',
    });
  });
});
