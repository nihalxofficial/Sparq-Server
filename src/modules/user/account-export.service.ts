import { Address } from "../address/address.model";
import { Cart } from "../cart/cart.model";
import { Order } from "../order/order.model";
import { OrderStatusLog } from "../order-status/order-status.model";
import { ProductReview } from "../review/review.model";
import { Transaction } from "../transaction/transaction.model";
import { Wishlist } from "../wishlist/wishlist.model";
import { VendorStore } from "../vendor/vendor-store.model";
import { VendorApplication } from "../vendor/vendor-application.model";
import { VendorSubscription } from "../vendor/vendor-subscription.model";
import { RiderApplication } from "../rider/rider-application.model";
import { ApiError } from "../../utils/apiError";
import { idQuery } from "../../utils/ids";
import { User } from "./user.model";

/**
 * Everything one account owns, as a single JSON-ready object.
 *
 * This is what the "Export Account Data" button downloads, so the customer can
 * keep their own records before deleting the account. Only the caller's own
 * rows are collected — the id is always taken from the bearer token.
 */
export async function exportAccountData(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw new ApiError(404, "User not found");

  // Some models store the owner as an ObjectId and some as text, so both forms
  // are matched.
  const owner = idQuery(userId);

  const orders = await Order.find({ userId }).sort({ createdAt: -1 }).lean();
  const orderIds = orders.map((order) => order._id);

  const [
    transactions,
    reviews,
    wishlist,
    cart,
    addresses,
    orderStatusHistory,
    vendorStore,
    vendorApplication,
    vendorSubscriptions,
    riderApplication,
  ] = await Promise.all([
    Transaction.find({ userId }).sort({ createdAt: -1 }).lean(),
    ProductReview.find({ userId: owner }).sort({ createdAt: -1 }).lean(),
    Wishlist.find({ userId }).populate("productId", "title price image").lean(),
    Cart.find({ userId }).populate("productId", "title price image").lean(),
    Address.find({ userId }).sort({ createdAt: -1 }).lean(),
    OrderStatusLog.find({ orderId: { $in: orderIds } }).sort({ createdAt: 1 }).lean(),
    VendorStore.findOne({ userId: owner }).lean(),
    VendorApplication.findOne({ userId: owner }).lean(),
    VendorSubscription.find({ vendorId: owner }).sort({ startDate: -1 }).lean(),
    RiderApplication.findOne({ userId: owner }).lean(),
  ]);

  // A buyer who also sells or rides takes that side of their account with them;
  // a plain customer gets a plain export.
  const seller =
    vendorStore || vendorApplication || vendorSubscriptions.length > 0
      ? { store: vendorStore, application: vendorApplication, subscriptions: vendorSubscriptions }
      : null;

  return {
    exportedAt: new Date().toISOString(),
    account: user,
    orders,
    orderStatusHistory,
    transactions,
    reviews,
    wishlist,
    cart,
    addresses,
    ...(seller ? { seller } : {}),
    ...(riderApplication ? { rider: { application: riderApplication } } : {}),
  };
}
