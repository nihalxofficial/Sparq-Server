/** Rounds a currency amount to two decimals. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
