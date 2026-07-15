'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { WalletAuthProvider } from './solana/wallet-auth-provider';
import { SolanaWalletProvider } from './solana/wallet-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <WalletAuthProvider>{children}</WalletAuthProvider>
      </SolanaWalletProvider>
    </QueryClientProvider>
  );
}
