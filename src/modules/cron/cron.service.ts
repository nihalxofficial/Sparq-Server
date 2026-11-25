import { expireProductOffers } from "../product/product.service";
import { expireStaleDeliveries } from "../delivery/delivery.service";
import { refreshCurrencyRates } from "../currency/currency.service";
import { restoreDemoChanges } from "../demo/demo.service";
import { expireDuePromotions } from "../vendor/featured-promotion.service";
import { expireUnansweredVendorOrders } from "../vendor/vendor-order.service";
import { expireDueSubscriptions } from "../vendor/vendor-subscription.service";

/**
 * The whole platform's daily housekeeping, in one pass.
 *
 * Vercel's Hobby plan allows only a couple of cron jobs and each may run just
 * once a day, so the seven sweeps that keep the market honest are folded into a
 * single job instead of seven. Each step is isolated: a job that throws is
 * recorded and the rest still run, because one broken sweep must never skip the
 * others — least of all the seller timeout that unblocks a waiting buyer.
 *
 * The individual routes (`/api/products/expire` and friends) stay mounted, so a
 * Pro plan or an external scheduler can still call any one of them by itself.
 */

export interface SweepResult {
  job: string;
  ok: boolean;
  detail: unknown;
  error?: string;
}

export interface SweepReport {
  startedAt: string;
  finishedAt: string;
  results: SweepResult[];
}

export async function runDailySweep(): Promise<SweepReport> {
  const startedAt = new Date().toISOString();

  // Order matters. A lapsed period is closed before the placements it bought
  // are dimmed, and the demo restore runs last so it undoes the day's sandbox
  // writes after every real sweep has had its turn.
  const steps: { job: string; run: () => Promise<unknown> }[] = [
    { job: "vendor-subscriptions", run: expireDueSubscriptions },
    { job: "promotions", run: expireDuePromotions },
    { job: "product-offers", run: expireProductOffers },
    { job: "vendor-orders", run: expireUnansweredVendorOrders },
    { job: "deliveries", run: expireStaleDeliveries },
    { job: "currency", run: refreshCurrencyRates },
    { job: "demo-restore", run: restoreDemoChanges },
  ];

  const results: SweepResult[] = [];

  for (const step of steps) {
    try {
      const detail = await step.run();
      results.push({ job: step.job, ok: true, detail });
    } catch (error: any) {
      console.error(`[CRON] ${step.job} failed:`, error);
      results.push({
        job: step.job,
        ok: false,
        detail: null,
        error: error?.message || "failed",
      });
    }
  }

  return { startedAt, finishedAt: new Date().toISOString(), results };
}
