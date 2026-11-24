import { SiteSettings } from "../site-settings/site-settings.model";
import { ApiError } from "../../utils/apiError";

// A free provider, no key, updated daily, and it carries the currencies the shop
// cares about (USD, BDT, EUR, and the rest).
const PROVIDER = "https://open.er-api.com/v6/latest";

/**
 * Fetches the day's exchange rates and stores them on the settings row.
 *
 * A failure is thrown, never written: a provider that is down must not leave the
 * store with half a rate table. The next run replaces the whole set anyway.
 */
export async function refreshCurrencyRates(base: string = "USD") {
  const code = base.toUpperCase();

  let payload: any;
  try {
    const res = await fetch(`${PROVIDER}/${code}`);
    if (!res.ok) throw new Error(`provider replied ${res.status}`);
    payload = await res.json();
  } catch (err) {
    throw new ApiError(502, `Could not reach the rate provider: ${(err as Error).message}`);
  }

  const rates = payload?.rates;
  if (!rates || typeof rates !== "object") {
    throw new ApiError(502, "The rate provider returned no rates");
  }

  const updatedAt = new Date();
  await SiteSettings.findOneAndUpdate(
    {},
    { $set: { currencyRates: { base: code, rates, updatedAt } } },
    { upsert: true }
  );

  return { base: code, count: Object.keys(rates).length, updatedAt };
}
