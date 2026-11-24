import { ClientSession, Types } from "mongoose";
import { Transaction } from "./transaction.model";
import { VendorOrder } from "../vendor/vendor-order.model";
import { GetTransactionsQuery } from "./transaction.validator";
import { paginate, sortBy, searchOr, where } from "../../utils/query";

export type PaymentMethod = "cod" | "bkash" | "rocket" | "nagad";

/** Records the payment row for an order, optionally inside a caller's session. */
export async function createTransaction(
  params: {
    orderId: string;
    userId: string;
    method: PaymentMethod;
    amount: number;
    reference: string;
    /** Simulated payment (this build has no gateway). */
    isDemo?: boolean;
  },
  session?: ClientSession
) {
  const isCashOnDelivery = params.method === "cod";

  const transaction = new Transaction({
    ...params,
    // Cash is collected at the door, so it starts pending; an online payment is
    // a demo that succeeds at once.
    status: isCashOnDelivery ? "pending" : "success",
    isDemo: params.isDemo ?? !isCashOnDelivery,
  });

  await transaction.save({ session });
  return transaction;
}

export async function getLatestTransactionForOrder(orderId: string) {
  return Transaction.findOne({ orderId }).sort({ createdAt: -1 });
}

export async function getTransactions(query: GetTransactionsQuery) {
  const { userId, orderId, status, method, search, sort, page = 1, limit = 10 } = query;

  const filter = where(
    userId ? { userId } : null,
    orderId ? { orderId } : null,
    status && status !== "all" ? { status: status.toLowerCase() } : null,
    method && method !== "all" ? { method: method.toLowerCase() } : null,
    search?.trim() ? searchOr(["reference", "method"], search, ["_id", "userId", "orderId"]) : null
  );

  const sortCriteria = sortBy(
    sort,
    {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      amount_asc: { amount: 1 },
      amount_desc: { amount: -1 },
    },
    { createdAt: -1 }
  );

  const { items: transactions, total, pages } = await paginate(
    () =>
      Transaction.find(filter)
        .populate("userId", "name email image avatar")
        .populate("orderId")
        .sort(sortCriteria),
    () => Transaction.countDocuments(filter),
    page,
    limit
  );

  return {
    transactions,
    total,
    pagination: { page, limit, total, totalPages: pages },
  };
}

/**
 * A seller's half of the payment ledger.
 *
 * A customer pays the marketplace once for the whole cart, so a payment row
 * carries the parent order's total. A seller is shown only the payments for
 * orders they are part of, and each row's amount is their own subtotal — the
 * money that payment actually carried for them — so the totals on their board
 * add up to their sales and not to somebody else's.
 */
export async function getVendorTransactions(vendorId: string, query: GetTransactionsQuery) {
  const { orderId, status, method, search, sort, page = 1, limit = 10 } = query;
  const vendorObjectId = new Types.ObjectId(vendorId);

  const conditions: any[] = [];

  if (orderId) {
    // An explicit order still has to be one the seller is part of.
    conditions.push({ orderId });
  }

  if (status && status !== "all") conditions.push({ status: status.toLowerCase() });
  if (method && method !== "all") conditions.push({ method: method.toLowerCase() });

  if (search?.trim()) {
    conditions.push(searchOr(["reference", "method"], search, ["_id", "orderId"]));
  }

  // The seller's rows are the only orders they may read, and the same filter is
  // applied to the count so the pager cannot promise rows that are not theirs.
  const filter = {
    $and: [...conditions, { orderId: { $in: await vendorOrderIds(vendorObjectId) } }],
  };

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    amount_asc: { amount: 1 },
    amount_desc: { amount: -1 },
  };
  const sortCriteria = sortMap[sort ?? ""] ?? { createdAt: -1 };

  const skip = (page - 1) * limit;
  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .populate("userId", "name email image avatar")
      // Only the two fields the seller's ledger prints. A parent order carries
      // every shop's lines, and the rest of it is not theirs to read.
      .populate({ path: "orderId", select: "_id orderStatus" })
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  // One extra read for the page's own subtotals, rather than a lookup per row.
  const pageOrderIds = transactions
    .map((row: any) => row.orderId?._id ?? row.orderId)
    .filter((id: any) => Types.ObjectId.isValid(String(id)))
    .map((id: any) => new Types.ObjectId(String(id)));
  const sellerRows = pageOrderIds.length
    ? await VendorOrder.find({ vendorId: vendorObjectId, orderId: { $in: pageOrderIds } })
        .select("orderId subtotal")
        .lean()
    : [];
  const subtotals = new Map(
    sellerRows.map((row: any) => [String(row.orderId), Number(row.subtotal || 0)])
  );

  return {
    transactions: transactions.map((row: any) => {
      const orderRef = row.orderId?._id ?? row.orderId;
      const share = subtotals.get(String(orderRef));
      return {
        ...row,
        // The full payment stays on the row for the record; the seller's own
        // number is what their board adds up.
        orderTotal: Number(row.amount || 0),
        amount: share ?? Number(row.amount || 0),
      };
    }),
    total,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/** The orders a seller has a row in — the boundary of everything they may read. */
async function vendorOrderIds(vendorId: Types.ObjectId) {
  const ids = await VendorOrder.find({ vendorId }).distinct("orderId");
  return ids.map((id: any) => new Types.ObjectId(String(id)));
}