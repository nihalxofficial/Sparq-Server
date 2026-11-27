import { Types } from "mongoose";
import { ApiError } from "../../utils/apiError";
import { Product } from "../product/product.model";
import * as promotionService from "./featured-promotion.service";
import { requireTradingStore } from "./vendor-store.service";
import { VendorStore } from "./vendor-store.model";
import { VendorOrder } from "./vendor-order.model";
import { VendorPointAward } from "./vendor-point-award.model";
import { assertWithinLimit, getVendorPlanState } from "./vendor-subscription.service";
import { isLiveVendorProductStatus, type BillingCycle } from "./vendor.types";
import type { FeatureProductInput, PromotionQuery } from "./featured-promotion.validator";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The seller's featured placements.
 *
 * A placement is bought, not claimed: the number of products that may be pinned
 * at once and how long each one stays up both come from the live plan, and the
 * plan is read here rather than trusted from the screen. Lifting the whole shop
 * is deliberately absent — being a featured *store* is the store team's call, so
 * only they can grant one, and it arrives here as a row the seller can see and
 * count down but never write.
 */

/** The product, this seller's own, and nothing else. */
async function requireOwnProduct(userId: string, productId: string) {
  const product = await Product.findOne({
    _id: new Types.ObjectId(productId),
    $or: [{ vendorId: userId }, { ownerId: userId }],
  });

  if (!product) {
    throw new ApiError(404, "No such product in your store");
  }
  return product;
}

export async function listMyPromotions(userId: string, query: PromotionQuery) {
  return promotionService.listPromotions(query, { vendorId: userId });
}

/**
 * Pins one of the seller's own live listings for the plan's own length.
 *
 * A row that is not live — waiting for review, rejected or archived — cannot be
 * featured: the shelves a buyer reads are the point, and a placement on
 * something nobody can reach would use up a slot for nothing.
 */
export async function featureMyProduct(userId: string, input: FeatureProductInput) {
  const store = await requireTradingStore(userId, "featuring a product");
  const product = await requireOwnProduct(userId, input.productId);

  if (!isLiveVendorProductStatus(product.vendorProductStatus)) {
    throw new ApiError(
      400,
      `Only a listed product can be featured. "${product.title}" is ${product.vendorProductStatus}`
    );
  }

  // The allowance is what refuses a seller whose slots are all taken, and it
  // says how many they have and how to get more.
  const state = await assertWithinLimit(userId, "featured");

  const planDays = state.plan.featuredDurationDays;
  if (planDays <= 0) {
    throw new ApiError(
      403,
      `Your ${state.plan.name} plan has no featured period. Upgrade to buy shelf space.`
    );
  }

  // The package states the length, and the package is also the ceiling: a
  // placement never outlives the period that paid for it. A plan with a day or
  // less left still gives one honest day, and the expiry sweep then closes it.
  const until = state.effectiveUntil;
  const remainingDays = until
    ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / DAY_MS))
    : planDays;
  // The plan's window and the days left in the paid period are both ceilings; the
  // seller may pick anything up to them, never past.
  const ceiling = Math.min(planDays, remainingDays);
  const days = input.days
    ? Math.max(1, Math.min(ceiling, Math.floor(input.days)))
    : ceiling;

  return promotionService.createPromotion(
    { kind: "product", productId: input.productId, days },
    {
      vendorId: userId,
      storeId: String(store._id),
      plan: state.plan.id,
      // The period as it was bought, which is the second thing the featured
      // shelf ranks on after the plan tier.
      billingCycle: (state.subscription?.billingCycle as BillingCycle) ?? null,
      source: "subscription",
      // The period that was live when the shelf was bought, so the row can be
      // read back against a payment history that later changed.
      subscriptionId: state.isLive && state.subscription ? String(state.subscription._id) : null,
    }
  );
}

/**
 * Frees a slot early.
 *
 * A seller can only ever cancel their own placement, and the row is kept: the
 * desk still explains what ran and when it stopped.
 */
export async function cancelMyPromotion(userId: string, id: string) {
  return promotionService.endPromotion(id, "Ended by the seller", { vendorId: userId });
}

/**
 * Each seller's featured window, for the store team's grant picker.
 *
 * The admin grant is capped at the seller's plan, so the desk has to see that cap
 * before it types a number: the plan's own window and how many days are left in
 * the period. A seller with no live plan reads a zero window, which is exactly
 * why their listing cannot be featured.
 */
export async function listVendorPlanWindows() {
  const [stores, points] = await Promise.all([
    VendorStore.find({ status: "active" }).select("userId name slug").lean(),
    promotionService.placementPoints(),
  ]);

  const rows = await Promise.all(
    stores.map(async (store: any) => {
      const state = await getVendorPlanState(String(store.userId));
      const windowDays = Number(state.plan.featuredDurationDays) || 0;
      const daysLeft = state.effectiveUntil
        ? Math.max(0, Math.ceil((state.effectiveUntil.getTime() - Date.now()) / DAY_MS))
        : 0;
      // What a placement pinned for this plan's full window would earn, so the
      // desk sees the same score the featured shelf uses to order the shops.
      const placementPoints = promotionService.placementScore(
        points,
        state.plan.analytics,
        (state.subscription?.billingCycle as BillingCycle) ?? null,
        windowDays
      );
      return {
        vendorId: String(store.userId),
        storeName: store.name || "",
        plan: state.plan.name,
        isLive: state.isLive,
        featuredWindowDays: windowDays,
        planDaysRemaining: daysLeft,
        placementPoints: state.isLive ? placementPoints : 0,
      };
    })
  );

  // Highest-earning shops first, so the picker leads with the ones that rank.
  rows.sort((a, b) => b.placementPoints - a.placementPoints);
  return rows;
}

/**
 * A seller's points, and where they came from.
 *
 * Sell points are earned on delivered units; placement points are the score of
 * the placements still running. The total is what the seller's own ranking is
 * read from, and the position places them among the trading shops.
 */
export async function getVendorPoints(userId: string) {
  const points = await promotionService.placementPoints();
  const perUnit = Number(points.sellPerUnit) || 0;
  const myId = new Types.ObjectId(userId);

  const [sellRows, awardRows, ownProducts] = await Promise.all([
    VendorOrder.aggregate([
      { $match: { status: "delivered" } },
      { $unwind: "$items" },
      { $group: { _id: "$vendorId", units: { $sum: "$items.quantity" } } },
    ]),
    // Plan points come from the permanent award ledger, so a seller's total
    // grows with each plan period (Free included) and never drops when a
    // placement ends.
    VendorPointAward.aggregate([
      { $group: { _id: "$vendorId", points: { $sum: "$points" } } },
    ]),
    VendorOrder.aggregate([
      { $match: { vendorId: myId, status: "delivered" } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          title: { $first: "$items.title" },
          units: { $sum: "$items.quantity" },
        },
      },
      { $sort: { units: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const map = new Map<string, { sellUnits: number; placementPoints: number }>();
  const ensure = (key: string) => {
    let row = map.get(key);
    if (!row) {
      row = { sellUnits: 0, placementPoints: 0 };
      map.set(key, row);
    }
    return row;
  };
  for (const row of sellRows) ensure(String(row._id)).sellUnits = Number(row.units) || 0;
  for (const row of awardRows) ensure(String(row._id)).placementPoints = Number(row.points) || 0;

  const totals = [...map.entries()].map(([vendorId, row]) => ({
    vendorId,
    total: row.sellUnits * perUnit + row.placementPoints,
  }));
  totals.sort((a, b) => b.total - a.total);

  const mine = map.get(userId) ?? { sellUnits: 0, placementPoints: 0 };
  const sellPoints = mine.sellUnits * perUnit;
  const myTotal = sellPoints + mine.placementPoints;
  const position = totals.filter((t) => t.total > myTotal).length + 1;

  return {
    perUnit,
    sellPoints,
    soldUnits: mine.sellUnits,
    placementPoints: mine.placementPoints,
    totalPoints: myTotal,
    position,
    totalVendors: totals.length,
    products: ownProducts.map((row: any) => ({
      productId: String(row._id),
      title: row.title || "A listing",
      units: Number(row.units) || 0,
      points: (Number(row.units) || 0) * perUnit,
    })),
  };
}
