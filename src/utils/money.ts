/**
 * Strips IEEE-754 floating-point noise (e.g. 0.1 + 0.2 = 0.30000000000000004)
 * without rounding away real decimal precision in financial calculations.
 */
export function cleanDecimal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/** Rounds a currency amount to two decimals. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
