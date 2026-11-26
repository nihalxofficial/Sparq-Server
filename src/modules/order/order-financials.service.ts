import { Types } from "mongoose";
import { Order } from "./order.model";
import { Product } from "../product/product.model";
import { VendorOrder } from "../vendor/vendor-order.model";
import { Delivery } from "../delivery/delivery.model";
import { Transaction } from "../transaction/transaction.model";
import { getVendorPlanState } from "../vendor/vendor-subscription.service";
import { planCoversDelivery } from "../vendor/vendor.types";
import { cleanDecimal } from "../../utils/money";
import { ApiError } from "../../utils/apiError";

export interface ProductFinancialRow {
  productId: string;
  title: string;
  quantity: number;
  vendorId: string | null;
  storeId: string | null;
  ownerLabel: string;
  originalUnitPrice: number;
  soldUnitPrice: number;
  originalTotal: number;
  soldTotal: number;
  productDiscount: number;
  couponDiscountAllocated: number;
  pointsRedeemedAllocated: number;
  pointsValueAllocated: number;
  finalCustomerPaid: number;
  unitCost: number | null;
  totalCost: number | null;
  commissionPercent: number;
  platformCommission: number;
  riderPayoutShare: number;
  riderPayoutPayer: "Admin" | "Vendor" | "Admin (Plan Covered)" | "None";
  profitBeforeDiscounts: number | null;
  profitAfterDiscounts: number | null;
}

export interface OrderFinancialBreakdown {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  couponCode: string;
  pointsRedeemed: number;
  // Order-level totals (scoped to vendor's items when in vendor mode)
  originalTotalProductPrice: number;
  totalProductDiscounts: number;
  soldSubtotal: number;
  couponDiscount: number;
  pointsDiscount: number;
  deliveryCharge: number;
  riderPayout: number;
  riderPayoutPayer: "Admin" | "Vendor" | "Shared (Admin & Vendor)" | "Admin (Plan Covered)" | "None";
  adminRiderPayout: number;
  vendorRiderPayout: number;
  platformCommissionTotal: number;
  totalCost: number | null;
  missingCostCount: number;
  finalCustomerPaid: number;
  expectedProfitWithoutDiscounts: number | null;
  expectedProfitWithDiscounts: number | null;
  adminProfit: number | null;
  vendorProfit: number | null;
  moneyFlow: {
    customerPaid: number;
    toVendors: number;
    toRiders: number;
    toPlatform: number;
    productCost: number | null;
  };
  items: ProductFinancialRow[];
}

export interface FinancialAnalyticsSummary {
  ordersCount: number;
  originalTotalProductPrice: number;
  totalProductDiscounts: number;
  totalCouponDiscount: number;
  totalPointsDiscount: number;
  totalDeliveryCharge: number;
  totalRiderPayout: number;
  totalAdminRiderPayout: number;
  totalVendorRiderPayout: number;
  totalPlatformCommission: number;
  totalCost: number;
  totalCustomerPaid: number;
  totalProfitWithoutDiscounts: number;
  totalProfitWithDiscounts: number;
  totalAdminProfit: number;
  totalVendorProfit: number;
}

function shortOrderNumber(id: unknown): string {
  return `#ORD-${String(id).slice(-6).toUpperCase()}`;
}

/**
 * Computes exact proportional allocations without losing precision or
 * double-counting order-level discounts, points, or rider payouts.
 */
async function buildBreakdownsForOrders(
  orders: any[],
  scopeVendorId?: string
): Promise<OrderFinancialBreakdown[]> {
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o._id);
  const productIds = [
    ...new Set(
      orders.flatMap((o) =>
        (o.items || [])
          .map((item: any) => String(item.productId || ""))
          .filter((id: string) => Types.ObjectId.isValid(id))
      )
    ),
  ].map((id) => new Types.ObjectId(id));

  const vendorIds = [
    ...new Set(
      orders.flatMap((o) =>
        (o.items || [])
          .map((item: any) => (item.vendorId ? String(item.vendorId) : ""))
          .filter((id: string) => Types.ObjectId.isValid(id))
      )
    ),
  ];

  const [products, vendorOrders, deliveries, transactions, planStates] = await Promise.all([
    productIds.length
      ? Product.find({ _id: { $in: productIds } })
          .select("title price originalPrice investPrice vendorId storeId")
          .lean()
      : [],
    VendorOrder.find({ orderId: { $in: orderIds } })
      .populate("storeId", "name")
      .lean(),
    Delivery.find({ orderId: { $in: orderIds } })
      .sort({ createdAt: -1 })
      .lean(),
    Transaction.find({ orderId: { $in: orderIds } })
      .sort({ createdAt: -1 })
      .lean(),
    Promise.all(
      vendorIds.map(async (vid) => [vid, await getVendorPlanState(vid)] as const)
    ),
  ]);

  const productMap = new Map<string, any>(
    products.map((p: any) => [String(p._id), p])
  );
  const planMap = new Map(planStates);

  // Latest delivery per order
  const deliveryMap = new Map<string, any>();
  for (const d of deliveries as any[]) {
    const key = String(d.orderId);
    if (!deliveryMap.has(key)) deliveryMap.set(key, d);
  }

  // Latest transaction per order
  const txMap = new Map<string, any>();
  for (const t of transactions as any[]) {
    const key = String(t.orderId);
    if (!txMap.has(key)) txMap.set(key, t);
  }

  // VendorOrders keyed by `${orderId}:${vendorId}`
  const voMap = new Map<string, any>();
  const storeNameByVendor = new Map<string, string>();
  for (const vo of vendorOrders as any[]) {
    voMap.set(`${String(vo.orderId)}:${String(vo.vendorId)}`, vo);
    if (vo.storeId && typeof vo.storeId === "object" && vo.storeId.name) {
      storeNameByVendor.set(String(vo.vendorId), String(vo.storeId.name));
    }
  }

  const breakdowns: OrderFinancialBreakdown[] = [];

  for (const order of orders) {
    const orderId = String(order._id);
    const rawItems = Array.isArray(order.items) ? order.items : [];
    if (rawItems.length === 0) continue;

    // Order-wide denominator for proportional allocation of order-level discounts/points/payouts
    const orderSoldSubtotal = rawItems.reduce(
      (sum: number, item: any) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
      0
    );
    const allocBase = orderSoldSubtotal > 0 ? orderSoldSubtotal : Number(order.subtotal) || 1;

    const orderCouponDiscount = Number(order.couponDiscount) || 0;
    const orderPointsDiscount = Number(order.pointsDiscount) || 0;
    const orderPointsRedeemed = Number(order.pointsRedeemed) || 0;
    const deliveryCharge = Number(order.shippingFee) || 0;

    const delivery = deliveryMap.get(orderId);
    const totalOrderRiderPayout = delivery ? Number(delivery.fee) || 0 : 0;

    const tx = txMap.get(orderId);
    const paymentStatus = tx?.status
      ? String(tx.status)
      : order.orderStatus === "delivered"
        ? "success"
        : "pending";

    const productRows: ProductFinancialRow[] = [];
    let adminProfitAcc = 0;
    let vendorProfitAcc = 0;
    let hasKnownCostForSplit = false;

    for (const item of rawItems) {
      const prodId = String(item.productId || "");
      const prodDoc = productMap.get(prodId);
      const itemVendorId = item.vendorId
        ? String(item.vendorId)
        : prodDoc?.vendorId
          ? String(prodDoc.vendorId)
          : null;

      // Strict vendor isolation: skip items not belonging to this vendor
      if (scopeVendorId && itemVendorId !== scopeVendorId) {
        continue;
      }

      const qty = Number(item.quantity) || 0;
      const soldUnitPrice = Number(item.price) || 0;
      const rawOrig = prodDoc?.originalPrice != null ? Number(prodDoc.originalPrice) : soldUnitPrice;
      const originalUnitPrice = rawOrig > soldUnitPrice ? rawOrig : soldUnitPrice;

      const originalTotal = cleanDecimal(originalUnitPrice * qty);
      const soldTotal = cleanDecimal(soldUnitPrice * qty);
      const productDiscount = cleanDecimal(Math.max(0, originalTotal - soldTotal));

      const shareRatio = soldTotal / allocBase;
      const vo = itemVendorId ? voMap.get(`${orderId}:${itemVendorId}`) : null;
      const voSubtotal = Number(vo?.subtotal) || soldTotal;
      const voCouponDiscount = Number(vo?.couponDiscount) || 0;

      // In vendor view, only include coupon discounts that belong to this vendor's own coupon
      // and exclude platform-funded points discounts.
      const vendorCouponAllocated =
        voCouponDiscount > 0 && voSubtotal > 0
          ? cleanDecimal(voCouponDiscount * (soldTotal / voSubtotal))
          : 0;
      const orderCouponAllocated = cleanDecimal(orderCouponDiscount * shareRatio);
      const couponDiscountAllocated = scopeVendorId ? vendorCouponAllocated : orderCouponAllocated;

      const pointsValueAllocated = scopeVendorId
        ? 0
        : cleanDecimal(orderPointsDiscount * shareRatio);
      const pointsRedeemedAllocated = scopeVendorId
        ? 0
        : Math.round(orderPointsRedeemed * shareRatio);

      const finalCustomerPaid = cleanDecimal(
        Math.max(0, soldTotal - couponDiscountAllocated - pointsValueAllocated)
      );

      const unitCost =
        prodDoc?.investPrice != null && Number.isFinite(Number(prodDoc.investPrice))
          ? Number(prodDoc.investPrice)
          : null;
      const totalCost = unitCost != null ? cleanDecimal(unitCost * qty) : null;

      const vendorPlanState = itemVendorId ? planMap.get(itemVendorId) : undefined;
      const commissionPercent = itemVendorId
        ? Number(vendorPlanState?.plan?.commissionPercent ?? 10)
        : 0;
      const platformCommission = itemVendorId
        ? cleanDecimal(soldTotal * (commissionPercent / 100))
        : 0;

      const rawRiderShare = cleanDecimal(totalOrderRiderPayout * shareRatio);
      const freeDeliveryCovered = Boolean(
        itemVendorId &&
          vendorPlanState?.isLive &&
          planCoversDelivery(vendorPlanState.plan)
      );

      let riderPayer: ProductFinancialRow["riderPayoutPayer"] = "None";
      let vendorRiderShare = 0;
      let adminRiderShare = 0;
      if (rawRiderShare > 0) {
        if (!itemVendorId) {
          riderPayer = "Admin";
          adminRiderShare = rawRiderShare;
        } else if (freeDeliveryCovered) {
          riderPayer = scopeVendorId ? "None" : "Admin (Plan Covered)";
          adminRiderShare = rawRiderShare;
        } else {
          riderPayer = "Vendor";
          vendorRiderShare = rawRiderShare;
        }
      }

      // In vendor view, hide rider payout share if vendor is not paying for the rider
      const riderPayoutShare = scopeVendorId ? vendorRiderShare : rawRiderShare;

      let profitBeforeDiscounts: number | null = null;
      let profitAfterDiscounts: number | null = null;

      if (totalCost != null) {
        hasKnownCostForSplit = true;
        if (scopeVendorId) {
          profitBeforeDiscounts = cleanDecimal(
            originalTotal - totalCost - platformCommission - vendorRiderShare
          );
          profitAfterDiscounts = cleanDecimal(
            finalCustomerPaid - totalCost - platformCommission - vendorRiderShare
          );
          vendorProfitAcc += profitAfterDiscounts;
        } else {
          profitBeforeDiscounts = cleanDecimal(
            originalTotal - totalCost - rawRiderShare
          );
          profitAfterDiscounts = cleanDecimal(
            finalCustomerPaid - totalCost - rawRiderShare
          );

          if (!itemVendorId) {
            adminProfitAcc += profitAfterDiscounts;
          } else {
            const vendorNetRevenue = Math.max(0, soldTotal - vendorCouponAllocated);
            const itemVendorProfit = cleanDecimal(
              vendorNetRevenue - totalCost - platformCommission - vendorRiderShare
            );
            const platformPromoAbsorbed =
              Math.max(0, orderCouponAllocated - vendorCouponAllocated) + pointsValueAllocated;
            const itemAdminProfit = cleanDecimal(
              platformCommission - platformPromoAbsorbed - adminRiderShare
            );
            vendorProfitAcc += itemVendorProfit;
            adminProfitAcc += itemAdminProfit;
          }
        }
      }

      productRows.push({
        productId: prodId,
        title: item.title || prodDoc?.title || "Product",
        quantity: qty,
        vendorId: itemVendorId,
        storeId: item.storeId ? String(item.storeId) : prodDoc?.storeId ? String(prodDoc.storeId) : null,
        ownerLabel: itemVendorId
          ? storeNameByVendor.get(itemVendorId) || "Vendor"
          : "Platform (Admin)",
        originalUnitPrice,
        soldUnitPrice,
        originalTotal,
        soldTotal,
        productDiscount,
        couponDiscountAllocated,
        pointsRedeemedAllocated,
        pointsValueAllocated,
        finalCustomerPaid,
        unitCost,
        totalCost,
        commissionPercent,
        platformCommission,
        riderPayoutShare,
        riderPayoutPayer: riderPayer,
        profitBeforeDiscounts,
        profitAfterDiscounts,
      });
    }

    if (productRows.length === 0) continue;

    const origSum = cleanDecimal(productRows.reduce((s, r) => s + r.originalTotal, 0));
    const prodDiscSum = cleanDecimal(productRows.reduce((s, r) => s + r.productDiscount, 0));
    const soldSum = cleanDecimal(productRows.reduce((s, r) => s + r.soldTotal, 0));
    const couponSum = scopeVendorId
      ? cleanDecimal(productRows.reduce((s, r) => s + r.couponDiscountAllocated, 0))
      : cleanDecimal(orderCouponDiscount);
    const pointsSum = scopeVendorId
      ? cleanDecimal(productRows.reduce((s, r) => s + r.pointsValueAllocated, 0))
      : cleanDecimal(orderPointsDiscount);
    const pointsPtsSum = scopeVendorId
      ? productRows.reduce((s, r) => s + r.pointsRedeemedAllocated, 0)
      : orderPointsRedeemed;
    const commissionSum = cleanDecimal(productRows.reduce((s, r) => s + r.platformCommission, 0));

    const orderShareRatio = scopeVendorId ? soldSum / allocBase : 1;
    const scopedDeliveryCharge = scopeVendorId ? 0 : cleanDecimal(deliveryCharge * orderShareRatio);
    const scopedRiderPayout = scopeVendorId
      ? cleanDecimal(productRows.reduce((s, r) => s + r.riderPayoutShare, 0))
      : cleanDecimal(totalOrderRiderPayout);

    const adminRiderPayout = scopeVendorId
      ? 0
      : cleanDecimal(
          productRows
            .filter((r) => r.riderPayoutPayer === "Admin" || r.riderPayoutPayer === "Admin (Plan Covered)")
            .reduce((s, r) => s + r.riderPayoutShare, 0)
        );
    const vendorRiderPayout = cleanDecimal(
      productRows
        .filter((r) => r.riderPayoutPayer === "Vendor")
        .reduce((s, r) => s + r.riderPayoutShare, 0)
    );

    const adminProfit =
      !scopeVendorId && hasKnownCostForSplit
        ? cleanDecimal(adminProfitAcc + scopedDeliveryCharge)
        : null;
    const vendorProfit = hasKnownCostForSplit ? cleanDecimal(vendorProfitAcc) : null;

    let riderPayoutPayer: OrderFinancialBreakdown["riderPayoutPayer"] = "None";
    if (scopedRiderPayout > 0) {
      if (adminRiderPayout > 0 && vendorRiderPayout > 0) {
        riderPayoutPayer = "Shared (Admin & Vendor)";
      } else if (vendorRiderPayout > 0) {
        riderPayoutPayer = "Vendor";
      } else if (productRows.some((r) => r.riderPayoutPayer === "Admin (Plan Covered)")) {
        riderPayoutPayer = "Admin (Plan Covered)";
      } else {
        riderPayoutPayer = "Admin";
      }
    }

    const missingCostCount = productRows.filter((r) => r.totalCost == null).length;
    const knownCostSum = cleanDecimal(
      productRows.reduce((s, r) => s + (r.totalCost ?? 0), 0)
    );
    const totalCost = missingCostCount === productRows.length ? null : knownCostSum;

    const finalCustomerPaid = scopeVendorId
      ? cleanDecimal(Math.max(0, soldSum - couponSum - pointsSum) + scopedDeliveryCharge)
      : cleanDecimal(Number(order.totalAmount) || 0);

    // Money flow
    const vendorGrossPaid = cleanDecimal(
      productRows
        .filter((r) => r.vendorId !== null)
        .reduce((s, r) => s + r.finalCustomerPaid, 0)
    );
    const toVendors = cleanDecimal(
      Math.max(0, vendorGrossPaid - commissionSum - vendorRiderPayout)
    );
    const toRiders = scopedRiderPayout;
    const toPlatform = cleanDecimal(
      finalCustomerPaid - toVendors - toRiders
    );

    let expectedProfitWithoutDiscounts: number | null = null;
    let expectedProfitWithDiscounts: number | null = null;

    if (totalCost != null) {
      if (scopeVendorId) {
        expectedProfitWithoutDiscounts = cleanDecimal(
          origSum - totalCost - commissionSum - vendorRiderPayout
        );
        expectedProfitWithDiscounts = cleanDecimal(
          Math.max(0, soldSum - couponSum - pointsSum) - totalCost - commissionSum - vendorRiderPayout
        );
      } else {
        expectedProfitWithoutDiscounts = cleanDecimal(
          origSum + scopedDeliveryCharge - totalCost - scopedRiderPayout
        );
        expectedProfitWithDiscounts = cleanDecimal(
          finalCustomerPaid - totalCost - scopedRiderPayout
        );
      }
    }

    const customerUser = order.userId && typeof order.userId === "object" ? order.userId : null;

    breakdowns.push({
      orderId,
      orderNumber: shortOrderNumber(order._id),
      createdAt: new Date(order.createdAt).toISOString(),
      orderStatus: String(order.orderStatus || "confirmed"),
      paymentMethod: String(order.paymentMethod || "cod"),
      paymentStatus,
      customerName: scopeVendorId
        ? "Customer"
        : order.shippingAddress?.fullName || customerUser?.name || "Customer",
      customerEmail: scopeVendorId ? "" : customerUser?.email || "",
      couponCode: String(order.couponCode || ""),
      pointsRedeemed: pointsPtsSum,
      originalTotalProductPrice: origSum,
      totalProductDiscounts: prodDiscSum,
      soldSubtotal: soldSum,
      couponDiscount: couponSum,
      pointsDiscount: pointsSum,
      deliveryCharge: scopedDeliveryCharge,
      riderPayout: scopedRiderPayout,
      riderPayoutPayer,
      adminRiderPayout,
      vendorRiderPayout,
      platformCommissionTotal: commissionSum,
      totalCost,
      missingCostCount,
      finalCustomerPaid,
      expectedProfitWithoutDiscounts,
      expectedProfitWithDiscounts,
      adminProfit,
      vendorProfit,
      moneyFlow: {
        customerPaid: finalCustomerPaid,
        toVendors,
        toRiders,
        toPlatform,
        productCost: totalCost,
      },
      items: productRows,
    });
  }

  return breakdowns;
}

function summarizeBreakdowns(rows: OrderFinancialBreakdown[]): FinancialAnalyticsSummary {
  const sum = (fn: (r: OrderFinancialBreakdown) => number) =>
    cleanDecimal(rows.reduce((acc, r) => acc + fn(r), 0));

  return {
    ordersCount: rows.length,
    originalTotalProductPrice: sum((r) => r.originalTotalProductPrice),
    totalProductDiscounts: sum((r) => r.totalProductDiscounts),
    totalCouponDiscount: sum((r) => r.couponDiscount),
    totalPointsDiscount: sum((r) => r.pointsDiscount),
    totalDeliveryCharge: sum((r) => r.deliveryCharge),
    totalRiderPayout: sum((r) => r.riderPayout),
    totalAdminRiderPayout: sum((r) => r.adminRiderPayout),
    totalVendorRiderPayout: sum((r) => r.vendorRiderPayout),
    totalPlatformCommission: sum((r) => r.platformCommissionTotal),
    totalCost: sum((r) => r.totalCost ?? 0),
    totalCustomerPaid: sum((r) => r.finalCustomerPaid),
    totalProfitWithoutDiscounts: sum((r) => r.expectedProfitWithoutDiscounts ?? 0),
    totalProfitWithDiscounts: sum((r) => r.expectedProfitWithDiscounts ?? 0),
    totalAdminProfit: sum((r) => r.adminProfit ?? 0),
    totalVendorProfit: sum((r) => r.vendorProfit ?? 0),
  };
}

export async function getAdminOrderFinancialAnalytics(query: {
  days?: number;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const days = Math.min(365, Math.max(1, Number(query.days) || 30));
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

  const since = new Date(Date.now() - days * 86_400_000);
  const filter: Record<string, unknown> = {
    createdAt: { $gte: since },
  };

  if (query.status && query.status !== "all") {
    filter.orderStatus = query.status;
  } else {
    filter.orderStatus = { $ne: "cancelled" };
  }

  if (query.search?.trim()) {
    const q = query.search.trim();
    const or: any[] = [
      { "shippingAddress.fullName": { $regex: q, $options: "i" } },
      { couponCode: { $regex: q, $options: "i" } },
    ];
    if (Types.ObjectId.isValid(q)) {
      or.push({ _id: new Types.ObjectId(q) });
    }
    filter.$or = or;
  }

  const allOrders = await Order.find(filter)
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const allBreakdowns = await buildBreakdownsForOrders(allOrders);
  const summary = summarizeBreakdowns(allBreakdowns);

  const total = allBreakdowns.length;
  const start = (page - 1) * limit;
  const orders = allBreakdowns.slice(start, start + limit);

  return {
    days,
    summary,
    orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAdminOrderFinancialBreakdown(orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, "Invalid order ID");
  }
  const order = await Order.findById(orderId)
    .populate("userId", "name email")
    .lean();
  if (!order) throw new ApiError(404, "Order not found");

  const [breakdown] = await buildBreakdownsForOrders([order]);
  if (!breakdown) throw new ApiError(404, "Order has no items");
  return breakdown;
}

export async function getVendorOrderFinancialAnalytics(
  userId: string,
  query: { days?: number; page?: number; limit?: number }
) {
  const planState = await getVendorPlanState(userId);
  const planId = planState.plan.id;

  if (planId === "free" || !planState.isLive) {
    throw new ApiError(
      403,
      "Detailed order financial analytics is only available on active Premium and Advanced plans."
    );
  }

  const days = Math.min(365, Math.max(1, Number(query.days) || 30));
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

  const since = new Date(Date.now() - days * 86_400_000);
  const vendorObjId = new Types.ObjectId(userId);

  const vendorOrders = await VendorOrder.find({
    vendorId: vendorObjId,
    status: { $nin: ["cancelled", "rejected"] },
    createdAt: { $gte: since },
  })
    .select("orderId")
    .lean();

  const orderIds = [...new Set(vendorOrders.map((v) => String(v.orderId)))].map(
    (id) => new Types.ObjectId(id)
  );

  const orders = orderIds.length
    ? await Order.find({
        _id: { $in: orderIds },
        orderStatus: { $ne: "cancelled" },
      })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
    : [];

  const allBreakdowns = await buildBreakdownsForOrders(orders, userId);
  const summary = summarizeBreakdowns(allBreakdowns);

  const total = allBreakdowns.length;
  const start = (page - 1) * limit;
  const pagedOrders = allBreakdowns.slice(start, start + limit);

  return {
    days,
    plan: { id: planState.plan.id, name: planState.plan.name },
    summary,
    orders: pagedOrders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
