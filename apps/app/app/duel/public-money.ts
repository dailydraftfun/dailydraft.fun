export type PublicMoneyValue = {
  amount: string;
  currency: 'USDC';
  decimals: 6;
};

export function formatPublicMoney(money: PublicMoneyValue): string {
  const value = BigInt(money.amount);
  const divisor = 10n ** BigInt(money.decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(money.decimals, '0').replace(/0+$/, '');
  return `${money.currency} ${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`;
}
