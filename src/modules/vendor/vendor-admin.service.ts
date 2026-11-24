import { Types } from "mongoose";
import { ApiError } from "../../utils/apiError";
import { Product } from "../product/product.model";
import { Coupon } from "../coupon/coupon.model";
import { toCouponDto } from "../coupon/coupon.service";
import { VendorStore } from "./vendor-store.model";
import { VendorOrder } from "./vendor-order.model";
import { VendorSubscription, SubscriptionTransaction } from "./vendor-subscription.model";
import { FeaturedPromotion } from "./featured-promotion.model";
import { listPromotions } from "./featured-promotion.service";
import { toStoreDto } from "./vendor-store.service";
import { listPlans } from "./vendor-plan.service";
import type { BillingCycle } from "./vendor.types";

/**
 * The store team's board of sellers. Every figure is read from the table that
 * owns it (plan money from payments, plan time from periods, trade and delivery
 * from the seller's order groups) and computed for the whole book before it
 * pages, because the sort key is itself a computation.
 */

/** Orders that never became a sale are excluded from every money figure. */
const DEAD_ORDER_STATUSES = ["rejected", "cancelled"];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface VendorBoardQuery {
  search: string;
  status: "all" | "active" | "suspended" | "closed";
  /** `all`, or the plan id the seller is standing on right now. */
  plan: string;
  featured: "all" | "yes" | "no";
  /** `points` (default), `sales`, `subscription`, `success`, `products`, `newest`, `name`. */
  sort: string;
  page: number;
  limit: number;
}

/**
 * The standing the desk sorts by — one number from four readings, so a shop is
 * never ranked on money alone: plan money paid, time paid for, sales it did not
 * lose, and its delivery record. The split comes back too, so a desk can see
 * whether the points were earned at the till or on the road.
 */
export interface VendorPoints {
  subscription: number;
  duration: number;
  sales: number;
  record: number;
  total: number;
}

export interface VendorBoardRow {
  /** The seller's account id: what a placement, a coupon and a plan hang off. */
  id: string;
  storeId: string;
  name: string;
  slug: string;
  logo: string;
  coverImage: string;
  category: string;
  city: string;
  area: string;
  ownerName: string;
  ownerEmail: string;
  ownerImage: string;
  status: string;
  isVisible: boolean;
  isFeatured: boolean;
  featuredUntil: Date | null;
  productCount: number;
  rating: number;
  reviewCount: number;
  createdAt: Date | null;

  plan: string;
  planName: string;
  billingCycle: BillingCycle | null;
  subscriptionStatus: "active" | "grace" | "none";
  subscriptionEndsAt: Date | null;
  subscriptionDaysLeft: number;

  /** Lifetime money the seller put into plans, and how many periods it bought. */
  subscriptionRevenue: number;
  subscriptionPeriods: number;
  /** Every day of plan time ever bought, added up. */
  paidDays: number;

  orders: number;
  sales: number;
  delivered: number;
  stopped: number;
  successRate: number;

  coupons: number;
  activeCoupons: number;
  couponDiscountGiven: number;

  points: VendorPoints;
}

/** The store list a board row is built from, populated with its owner. */
async function readStores() {
  return VendorStore.find({}).populate("userId", "name email image").lean();
}

/** Money, the way the rest of the API rounds it. */
function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function idOf(value: unknown): string {
  if (!value) return "";
  return typeof value === "object" && "_id" in (value as any)
    ? String((value as any)._id)
    : String(value);
}

export interface VendorTradeTotals {
  orders: number;
  sales: number;
  delivered: number;
  stopped: number;
  successRate: number;
}

interface VendorMoneyTotals {
  revenue: number;
  periods: number;
  paidDays: number;
}

interface VendorCouponTotals {
  coupons: number;
  active: number;
  discountGiven: number;
}

/**
 * Every seller's trade, plan money and coupon book, read once.
 *
 * The four aggregations are the only reads that touch rows belonging to
 * everybody, and they run in parallel with the store list so the board costs
 * one round trip rather than one per seller.
 */
async function readLedgers() {
  const [orders, payments, periods, coupons] = await Promise.all([
    VendorOrder.find({})
      .select("vendorId status subtotal")
      .lean(),
    SubscriptionTransaction.find({ status: "success" })
      .select("vendorId amount")
      .lean(),
    VendorSubscription.find({})
      .select("vendorId plan billingCycle status startDate endDate graceEndsAt")
      .lean(),
    Coupon.find({ ownerType: "vendor" }).select("vendorId isActive discountGiven").lean(),
  ]);

  const trade = new Map<string, VendorTradeTotals>();
  for (const order of orders as any[]) {
    const id = idOf(order.vendorId);
    const row = trade.get(id) ?? { orders: 0, sales: 0, delivered: 0, stopped: 0, successRate: 0 };
    row.orders += 1;

    const dead = DEAD_ORDER_STATUSES.includes(String(order.status));
    if (dead) row.stopped += 1;
    else row.sales += Number(order.subtotal) || 0;
    if (String(order.status) === "delivered") row.delivered += 1;

    trade.set(id, row);
  }
  for (const row of trade.values()) {
    const closed = row.delivered + row.stopped;
    row.sales = money(row.sales);
    row.successRate = closed > 0 ? Math.round((row.delivered / closed) * 100) : 0;
  }

  const moneyByVendor = new Map<string, VendorMoneyTotals>();
  for (const payment of payments as any[]) {
    const id = idOf(payment.vendorId);
    const row = moneyByVendor.get(id) ?? { revenue: 0, periods: 0, paidDays: 0 };
    row.revenue += Number(payment.amount) || 0;
    moneyByVendor.set(id, row);
  }

  for (const period of periods as any[]) {
    const id = idOf(period.vendorId);
    const row = moneyByVendor.get(id) ?? { revenue: 0, periods: 0, paidDays: 0 };
    row.periods += 1;
    const start = new Date(period.startDate).getTime();
    const end = new Date(period.endDate).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      row.paidDays += Math.round((end - start) / DAY_MS);
    }
    moneyByVendor.set(id, row);
  }
  for (const row of moneyByVendor.values()) row.revenue = money(row.revenue);

  const couponsByVendor = new Map<string, VendorCouponTotals>();
  for (const coupon of coupons as any[]) {
    const id = idOf(coupon.vendorId);
    const row = couponsByVendor.get(id) ?? { coupons: 0, active: 0, discountGiven: 0 };
    row.coupons += 1;
    if (coupon.isActive !== false) row.active += 1;
    row.discountGiven += Number(coupon.discountGiven) || 0;
    couponsByVendor.set(id, row);
  }
  for (const row of couponsByVendor.values()) row.discountGiven = money(row.discountGiven);

  return { trade, money: moneyByVendor, coupons: couponsByVendor, periods: periods as any[] };
}

/** The period a seller stands on right now, if any: held and not yet lapsed. */
function livePeriod(periods: any[], vendorId: string, now: Date) {
  return (
    periods.find((row) => {
      if (idOf(row.vendorId) !== vendorId) return false;
      const status = String(row.status);
      if (status !== "active" && status !== "grace") return false;
      // A row the sweep has not closed yet still ends on its own clock, so the
      // board reads the same answer the vendor's own dashboard does.
      const cutoff = status === "grace" ? row.graceEndsAt : row.endDate;
      return cutoff ? new Date(cutoff).getTime() > now.getTime() : false;
    }) ?? null
  );
}

/** Points, from the four readings the desk ranks on. */
function pointsFor(params: {
  revenue: number;
  paidDays: number;
  sales: number;
  successRate: number;
}): VendorPoints {
  const subscription = Math.round(params.revenue / 100);
  const duration = Math.round(params.paidDays / 30);
  const sales = Math.round(params.sales / 1000);
  const record = Math.round(params.successRate);
  return {
    subscription,
    duration,
    sales,
    record,
    total: subscription + duration + sales + record,
  };
}

const SORTERS: Record<string, (a: VendorBoardRow, b: VendorBoardRow) => number> = {
  points: (a, b) => b.points.total - a.points.total || b.sales - a.sales,
  sales: (a, b) => b.sales - a.sales,
  subscription: (a, b) => b.subscriptionRevenue - a.subscriptionRevenue,
  success: (a, b) => b.successRate - a.successRate || b.delivered - a.delivered,
  products: (a, b) => b.productCount - a.productCount,
  newest: (a, b) =>
    (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
    (a.createdAt ? new Date(a.createdAt).getTime() : 0),
  name: (a, b) => a.name.localeCompare(b.name),
};

/**
 * One page of the seller board.
 *
 * Filters are applied to the mapped rows rather than to the query, because
 * "is on the Premium plan" and "has a live spotlight" are readings of two other
 * tables. The status chips are counted before any filter, so a desk always sees
 * how much is behind a tab it is not standing on.
 */
export async function listVendorBoard(query: VendorBoardQuery) {
  const [stores, ledgers, plans] = await Promise.all([readStores(), readLedgers(), listPlans()]);
  const planName = new Map(plans.map((plan) => [plan.id, plan.name]));
  const now = new Date();

  const rows: VendorBoardRow[] = (stores as any[]).map((store) => {
    const id = idOf(store.userId);
    const trade = ledgers.trade.get(id) ?? { orders: 0, sales: 0, delivered: 0, stopped: 0, successRate: 0 };
    const paid = ledgers.money.get(id) ?? { revenue: 0, periods: 0, paidDays: 0 };
    const couponBook = ledgers.coupons.get(id) ?? { coupons: 0, active: 0, discountGiven: 0 };
    const live = livePeriod(ledgers.periods, id, now);

    const featuredUntil = store.featuredUntil ? new Date(store.featuredUntil) : null;
    const isFeatured = Boolean(store.isFeatured && (!featuredUntil || featuredUntil > now));
    const plan = String(live?.plan || "free");
    const endDate = live?.endDate ? new Date(live.endDate) : null;

    return {
      id,
      storeId: String(store._id),
      name: store.name || "",
      slug: store.slug || "",
      logo: store.logo || "",
      coverImage: store.coverImage || "",
      category: store.category || "",
      city: store.address?.city || "",
      area: store.address?.area || "",
      ownerName: store.userId?.name || "",
      ownerEmail: store.userId?.email || "",
      ownerImage: store.userId?.image || "",
      status: String(store.status || "active"),
      isVisible: store.isVisible !== false,
      isFeatured,
      featuredUntil: isFeatured ? featuredUntil : null,
      productCount: Number(store.productCount) || 0,
      rating: Number(store.rating) || 0,
      reviewCount: Number(store.reviewCount) || 0,
      createdAt: store.createdAt ?? null,

      plan,
      planName: planName.get(plan) || plan,
      billingCycle: (live?.billingCycle as BillingCycle) ?? null,
      subscriptionStatus: live ? (String(live.status) as "active" | "grace") : "none",
      subscriptionEndsAt: endDate,
      subscriptionDaysLeft: endDate
        ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS))
        : 0,

      subscriptionRevenue: paid.revenue,
      subscriptionPeriods: paid.periods,
      paidDays: paid.paidDays,

      orders: trade.orders,
      sales: trade.sales,
      delivered: trade.delivered,
      stopped: trade.stopped,
      successRate: trade.successRate,

      coupons: couponBook.coupons,
      activeCoupons: couponBook.active,
      couponDiscountGiven: couponBook.discountGiven,

      points: pointsFor({
        revenue: paid.revenue,
        paidDays: paid.paidDays,
        sales: trade.sales,
        successRate: trade.successRate,
      }),
    };
  });

  const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    counts.all = (counts.all || 0) + 1;
    return counts;
  }, {});

  const search = query.search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (query.status !== "all" && row.status !== query.status) return false;
    if (query.plan !== "all" && row.plan !== query.plan) return false;
    if (query.featured === "yes" && !row.isFeatured) return false;
    if (query.featured === "no" && row.isFeatured) return false;
    if (!search) return true;
    return [row.name, row.slug, row.category, row.city, row.ownerName, row.ownerEmail]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });

  const sorted = filtered.sort(SORTERS[query.sort] ?? SORTERS.points);
  const start = (query.page - 1) * query.limit;

  return {
    vendors: sorted.slice(start, start + query.limit),
    total: sorted.length,
    /** The book, not the page: these are the figures the desk reads at a glance. */
    totals: {
      vendors: rows.length,
      featured: rows.filter((row) => row.isFeatured).length,
      subscriptionRevenue: money(rows.reduce((sum, row) => sum + row.subscriptionRevenue, 0)),
      sales: money(rows.reduce((sum, row) => sum + row.sales, 0)),
      coupons: rows.reduce((sum, row) => sum + row.coupons, 0),
    },
    statusCounts,
    plans: plans.map((plan) => ({ id: plan.id, name: plan.name })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: sorted.length,
      totalPages: Math.max(Math.ceil(sorted.length / query.limit), 1),
    },
  };
}

/** The shop behind an id, whichever id the desk was holding. */
async function requireStoreRow(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new ApiError(404, "No such vendor");

  const store: any = await VendorStore.findOne({ userId: id })
    .populate("userId", "name email image phone role createdAt")
    .lean();
  if (store) return store;

  const byStoreId: any = await VendorStore.findById(id)
    .populate("userId", "name email image phone role createdAt")
    .lean();
  if (!byStoreId) throw new ApiError(404, "No such vendor");
  return byStoreId;
}

/**
 * One seller, in full: the row from the board, the account behind it, the shop
 * it trades from, and the four tables the desk would otherwise open one by one.
 *
 * Products, placements and codes are capped: this is a dashboard, and a shop
 * with hundreds of listings still reads by its newest rows and its counts.
 */
export async function getVendorBoardDetail(id: string) {
  const store: any = await requireStoreRow(id);
  const vendorId = idOf(store.userId) || String(store.userId);
  const now = new Date();

  const [orders, payments, periods, products, promotions, coupons, plans] = await Promise.all([
    VendorOrder.find({ vendorId }).select("vendorId status subtotal").lean(),
    SubscriptionTransaction.find({ vendorId }).sort({ createdAt: -1 }).limit(50).lean(),
    VendorSubscription.find({ vendorId }).sort({ createdAt: -1 }).lean(),
    Product.find({ vendorId })
      .select(
        "title slug image price originalPrice inStock stockQuantity sellCount rating reviewCount vendorProductStatus isVisible isFeatured featuredUntil createdAt"
      )
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    listPromotions({ status: "all", kind: "all", page: 1, limit: 100 }, { vendorId }),
    Coupon.find({ vendorId }).sort({ createdAt: -1 }).limit(100).lean(),
    listPlans(),
  ]);

  const planName = new Map(plans.map((plan) => [plan.id, plan.name]));
  const live = livePeriod(periods as any[], vendorId, now);
  const featuredUntil = store.featuredUntil ? new Date(store.featuredUntil) : null;
  const isFeatured = Boolean(store.isFeatured && (!featuredUntil || featuredUntil > now));

  let sales = 0;
  let delivered = 0;
  let stopped = 0;
  for (const order of orders as any[]) {
    if (DEAD_ORDER_STATUSES.includes(String(order.status))) stopped += 1;
    else sales += Number(order.subtotal) || 0;
    if (String(order.status) === "delivered") delivered += 1;
  }
  const closed = delivered + stopped;
  const successRate = closed > 0 ? Math.round((delivered / closed) * 100) : 0;

  const revenue = money(
    (payments as any[])
      .filter((row) => String(row.status) === "success")
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  );
  const paidDays = (periods as any[]).reduce((sum, row) => {
    const start = new Date(row.startDate).getTime();
    const end = new Date(row.endDate).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? sum + Math.round((end - start) / DAY_MS)
      : sum;
  }, 0);

  const activeCoupons = (coupons as any[]).filter((row) => row.isActive !== false).length;
  const endDate = live?.endDate ? new Date(live.endDate) : null;
  const plan = String(live?.plan || "free");

  const vendor: VendorBoardRow = {
    id: vendorId,
    storeId: String(store._id),
    name: store.name || "",
    slug: store.slug || "",
    logo: store.logo || "",
    coverImage: store.coverImage || "",
    category: store.category || "",
    city: store.address?.city || "",
    area: store.address?.area || "",
    ownerName: store.userId?.name || "",
    ownerEmail: store.userId?.email || "",
    ownerImage: store.userId?.image || "",
    status: String(store.status || "active"),
    isVisible: store.isVisible !== false,
    isFeatured,
    featuredUntil: isFeatured ? featuredUntil : null,
    productCount: Number(store.productCount) || 0,
    rating: Number(store.rating) || 0,
    reviewCount: Number(store.reviewCount) || 0,
    createdAt: store.createdAt ?? null,

    plan,
    planName: planName.get(plan) || plan,
    billingCycle: (live?.billingCycle as BillingCycle) ?? null,
    subscriptionStatus: live ? (String(live.status) as "active" | "grace") : "none",
    subscriptionEndsAt: endDate,
    subscriptionDaysLeft: endDate
      ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS))
      : 0,

    subscriptionRevenue: revenue,
    subscriptionPeriods: (periods as any[]).length,
    paidDays,

    orders: (orders as any[]).length,
    sales: money(sales),
    delivered,
    stopped,
    successRate,

    coupons: (coupons as any[]).length,
    activeCoupons,
    couponDiscountGiven: money(
      (coupons as any[]).reduce((sum, row) => sum + (Number(row.discountGiven) || 0), 0)
    ),

    points: pointsFor({ revenue, paidDays, sales: money(sales), successRate }),
  };

  return {
    vendor,
    account: {
      id: vendorId,
      name: store.userId?.name || "",
      email: store.userId?.email || "",
      image: store.userId?.image || "",
      phone: store.phone || store.userId?.phone || "",
      role: store.userId?.role || "vendor",
      joinedAt: store.userId?.createdAt ?? null,
    },
    store: toStoreDto(store),
    subscription: {
      live: live
        ? {
            plan: String(live.plan),
            planName: planName.get(String(live.plan)) || String(live.plan),
            billingCycle: live.billingCycle ?? null,
            status: String(live.status),
            startDate: live.startDate ?? null,
            endDate: live.endDate ?? null,
            graceEndsAt: live.graceEndsAt ?? null,
            pricePaid: Number(live.pricePaid) || 0,
            daysLeft: endDate
              ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS))
              : 0,
          }
        : null,
      history: (periods as any[]).map((row) => ({
        _id: String(row._id),
        plan: String(row.plan),
        planName: planName.get(String(row.plan)) || String(row.plan),
        billingCycle: row.billingCycle ?? null,
        status: String(row.status),
        pricePaid: Number(row.pricePaid) || 0,
        startDate: row.startDate ?? null,
        endDate: row.endDate ?? null,
      })),
      payments: (payments as any[]).map((row) => ({
        _id: String(row._id),
        plan: String(row.plan),
        billingCycle: row.billingCycle ?? null,
        amount: Number(row.amount) || 0,
        method: String(row.method || ""),
        status: String(row.status),
        purpose: String(row.purpose || ""),
        reference: String(row.reference || ""),
        createdAt: row.createdAt ?? null,
      })),
      totals: { revenue, paidDays, periods: (periods as any[]).length },
    },
    products: (products as any[]).map((row) => ({
      _id: String(row._id),
      title: row.title || "",
      slug: row.slug || "",
      image: row.image || "",
      price: Number(row.price) || 0,
      inStock: row.inStock !== false,
      stockQuantity: Number(row.stockQuantity) || 0,
      sellCount: Number(row.sellCount) || 0,
      rating: Number(row.rating) || 0,
      reviewCount: Number(row.reviewCount) || 0,
      vendorProductStatus: String(row.vendorProductStatus || ""),
      isVisible: row.isVisible !== false,
      isFeatured: Boolean(row.isFeatured),
      featuredUntil: row.featuredUntil ? new Date(row.featuredUntil) : null,
      createdAt: row.createdAt ?? null,
    })),
    promotions: promotions.promotions,
    promotionCounts: promotions.stateCounts,
    coupons: (coupons as any[]).map((row) => toCouponDto(row)),
    orders: {
      recent: await VendorOrder.find({ vendorId })
        .select("orderNumber customerName subtotal status items createdAt")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
        .then((rows) =>
          (rows as any[]).map((row) => ({
            _id: String(row._id),
            orderNumber: row.orderNumber || "",
            customerName: row.customerName || "",
            subtotal: Number(row.subtotal) || 0,
            status: String(row.status || ""),
            items: (row.items || []).length,
            createdAt: row.createdAt ?? null,
          }))
        ),
      totals: {
        orders: (orders as any[]).length,
        sales: money(sales),
        delivered,
        stopped,
        successRate,
      },
    },
    /** Placements still running, so the desk sees what the shop holds right now. */
    livePlacements: await FeaturedPromotion.countDocuments({
      vendorId: new Types.ObjectId(vendorId),
      status: "active",
      endsAt: { $gt: now },
    }),
  };
}
