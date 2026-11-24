/** Rounds a currency amount to two decimals. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The decimal places a currency really uses: JPY 0, USD 2, KWD 3. */
export function currencyDecimals(currency: string = "USD"): number {
  try {
    return (
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Rounds an amount to the currency's smallest unit, e.g. ¥1,237.6 => ¥1,238. */
export function roundToCurrency(amount: number, currency: string = "USD"): number {
  const factor = 10 ** currencyDecimals(currency);
  return Math.round(amount * factor) / factor;
}

/** Converts between currencies using rates on one base, e.g. { USD: 1, BDT: 124 }. */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): number {
  const fromRate = rates[from.toUpperCase()];
  const toRate = rates[to.toUpperCase()];
  // An unknown pair leaves the number untouched rather than inventing a price.
  if (!fromRate || !toRate) return amount;
  return roundToCurrency((amount / fromRate) * toRate, to);
}
