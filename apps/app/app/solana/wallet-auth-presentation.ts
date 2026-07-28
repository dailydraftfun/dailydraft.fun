export type WalletAuthPresentation = {
  badge: 'Active' | 'Checking' | 'Required';
  detail: string;
  isActive: boolean;
  title: string;
};

export function getWalletAuthPresentation(
  status: 'authenticated' | 'restoring' | string,
  expiresAt: string | null,
): WalletAuthPresentation {
  if (status === 'authenticated') {
    return {
      badge: 'Active',
      detail: expiresAt
        ? `Session expires ${new Date(expiresAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        : 'Authenticated session active',
      isActive: true,
      title: 'Authenticated to play',
    };
  }
  if (status === 'restoring') {
    return {
      badge: 'Checking',
      detail: 'Checking the existing session · no signature',
      isActive: false,
      title: 'Restoring wallet session',
    };
  }
  return {
    badge: 'Required',
    detail: 'One readable Ed25519 signature · no transaction',
    isActive: false,
    title: 'Authenticate wallet ownership',
  };
}
