import { Types } from "mongoose";
import { VendorOrder } from "./vendor-order.model";
import { VendorPointAward } from "./vendor-point-award.model";
import { placementPoints, type PlacementPoints } from "./featured-promotion.service";
import type { BillingCycle } from "./vendor.types";

/**
 * The single source of truth for a seller's points.
 *
 * Every screen that shows points — the seller's own dashboard, the store team's
 * seller board and detail page, the promotion picker and the hero-banner picker
 * — reads the same two ledgers from here:
 *
 *  - plan points: the permanent `VendorPointAward` rows written on every plan
 *    period (Free included), so the total only ever grows with each period;
 *  - sell points: delivered units × `sellPerUnit`.
 *
 * The amounts themselves come from site settings (`vendorPlacementPoints`), so
 * changing a rate there is the one way to change what points are worth. Nothing
 * in a screen may invent its own formula.
 */

export interface VendorPointBalance {
  planPoints: number;
  sellPoints: number;
  soldUnits: number;
  total: number;
}

/** What a plan period is worth, from the rates the admin sets. */
export function planPeriodPoints(
  points: PlacementPoints,
  analytics: string,
  billingCycle: BillingCycle | null | undefined,
  days: number
): number {
  const tier =
    analytics === "advanced"
      ? points.advanced
      : analytics === "detailed"
        ? points.detailed
        : points.basic;
  const length = Math.max(0, Math.min(Math.round(days) || 0, 365));
  return tier + (billingCycle === "yearly" ? points.yearlyBonus : 0) + length * points.perDay;
}

function emptyBalance(): VendorPointBalance {
  return { planPoints: 0, sellPoints: 0, soldUnits: 0, total: 0 };
}

function toBalance(planPoints: number, soldUnits: number, perUnit: number): VendorPointBalance {
  const sellPoints = soldUnits * perUnit;
  return { planPoints, sellPoints, soldUnits, total: planPoints + sellPoints };
}

/**
 * Every seller's balance, in one pass.
 *
 * Boards, rank positions and pickers need the whole book at once, so this reads
 * the two aggregates for everybody rather than one query per seller.
 */
export async function readPointBalances(): Promise<Map<string, VendorPointBalance>> {
  const [points, awardRows, sellRows] = await Promise.all([
    placementPoints(),
    VendorPointAward.aggregate([
      { $group: { _id: "$vendorId", points: { $sum: "$points" } } },
    ]),
    VendorOrder.aggregate([
      { $match: { status: "delivered" } },
      { $unwind: "$items" },
      { $group: { _id: "$vendorId", units: { $sum: "$items.quantity" } } },
    ]),
  ]);

  const perUnit = Number(points.sellPerUnit) || 0;
  const plan = new Map<string, number>();
  const sold = new Map<string, number>();

  for (const row of awardRows) plan.set(String(row._id), Number(row.points) || 0);
  for (const row of sellRows) sold.set(String(row._id), Number(row.units) || 0);

  const balances = new Map<string, VendorPointBalance>();
  for (const id of new Set([...plan.keys(), ...sold.keys()])) {
    balances.set(id, toBalance(plan.get(id) || 0, sold.get(id) || 0, perUnit));
  }
  return balances;
}

/** One seller's balance, read on its own so a single screen is not a full scan. */
export async function readVendorPointBalance(vendorId: string): Promise<VendorPointBalance> {
  if (!Types.ObjectId.isValid(vendorId)) return emptyBalance();
  const id = new Types.ObjectId(vendorId);

  const [points, awardAgg, sellAgg] = await Promise.all([
    placementPoints(),
    VendorPointAward.aggregate([
      { $match: { vendorId: id } },
      { $group: { _id: null, points: { $sum: "$points" } } },
    ]),
    VendorOrder.aggregate([
      { $match: { vendorId: id, status: "delivered" } },
      { $unwind: "$items" },
      { $group: { _id: null, units: { $sum: "$items.quantity" } } },
    ]),
  ]);

  const perUnit = Number(points.sellPerUnit) || 0;
  return toBalance(
    Number(awardAgg[0]?.points) || 0,
    Number(sellAgg[0]?.units) || 0,
    perUnit
  );
}

export interface VendorPointAwardDto {
  id: string;
  plan: string;
  billingCycle: string;
  points: number;
  note: string;
  awardedAt: Date | null;
}

/** Where and when a seller's plan points were earned, newest first. */
export async function readPointHistory(vendorId: string, limit = 30): Promise<VendorPointAwardDto[]> {
  if (!Types.ObjectId.isValid(vendorId)) return [];
  const rows = await VendorPointAward.find({ vendorId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return (rows as any[]).map((row) => ({
    id: String(row._id),
    plan: String(row.plan || ""),
    billingCycle: String(row.billingCycle || "monthly"),
    points: Number(row.points) || 0,
    note: String(row.note || ""),
    awardedAt: row.createdAt ?? null,
  }));
}

/**
 * Writes the permanent award for one plan period.
 *
 * Called once per subscription by the subscription service. It is deliberately
 * a snapshot: the settings at the time of purchase are baked into the row, so a
 * later rate change never rewrites history.
 */
export async function awardPlanPoints(params: {
  vendorId: string;
  plan: string;
  analytics: string;
  billingCycle: BillingCycle;
  days: number;
  subscriptionId?: Types.ObjectId | string | null;
  note?: string;
}): Promise<number> {
  const table = await placementPoints();
  const points = planPeriodPoints(table, params.analytics, params.billingCycle, params.days);
  if (points <= 0) return 0;

  await VendorPointAward.create({
    vendorId: params.vendorId,
    plan: params.plan,
    billingCycle: params.billingCycle,
    points,
    subscriptionId: params.subscriptionId ?? null,
    note: params.note || `${params.plan} ${params.billingCycle} period`,
  });
  return points;
}
