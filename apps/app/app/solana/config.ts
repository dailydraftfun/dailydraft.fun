export const SOLANA_CHAIN = 'solana:devnet' as const;
export const SOLANA_CLUSTER = 'devnet' as const;
export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com';

export function getExplorerAddressUrl(address: string) {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=${SOLANA_CLUSTER}`;
}

export function getExplorerTransactionUrl(signature: string) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${SOLANA_CLUSTER}`;
}

export function shortenAddress(address: string) {
  if (address.length < 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
