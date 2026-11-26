import { Schema, model } from "mongoose";

/**
 * The vendor's half of an order.
 *
 * A customer checkout is one parent order; each seller in it gets their own
 * row here holding only their lines, their status and their history. That is
 * what lets two vendors fulfil the same cart independently without either of
 * them seeing the other's items. The parent order keeps the money, the
 * customer and the delivery status it always had.
 */

export const VENDOR_ORDER_STATUSES = [
  "pending",
  "accepted",
  "processing",
  "ready_for_shipment",
  "shipped",
  "delivered",
  "rejected",
  "cancelled",
] as const;

export type VendorOrderStatus = (typeof VENDOR_ORDER_STATUSES)[number];

/** One line, copied from the parent order so the group reads on its own. */
const vendorOrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    image: { type: String, default: "" },
    /** What one unit cost the seller at checkout — frozen, never re-read. */
    unitCost: { type: Number, default: null },
  },
  { _id: false }
);

const vendorOrderEventSchema = new Schema(
  {
    status: { type: String, enum: VENDOR_ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "" },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const vendorOrderSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "VendorStore", default: null, index: true },

    /** Snapshots for the list: the vendor screens never need the parent to render a row. */
    orderNumber: { type: String, default: "" },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    city: { type: String, default: "" },
    paymentMethod: { type: String, default: "" },

    items: { type: [vendorOrderItemSchema], default: [] },
    /** What the seller is owed: the lines total minus any seller-coupon discount. */
    subtotal: { type: Number, default: 0 },
    /** The part of a seller's own coupon that came off this group's total. */
    couponDiscount: { type: Number, default: 0 },

    /**
     * The plan this group was sold under, frozen at checkout.
     *
     * A later plan change must not re-price an order that already shipped, so
     * the commission and the delivery cover are written down here and read
     * back as-is. The live plan is only consulted for rows that predate this.
     */
    commissionPercent: { type: Number, default: 0 },
    /** True when the seller's plan at checkout carried the delivery fee. */
    deliveryCovered: { type: Boolean, default: false },

    status: {
      type: String,
      enum: VENDOR_ORDER_STATUSES,
      default: "pending",
      index: true,
    },
    rejectionReason: { type: String, default: "" },

    /** The job carrying this group, once a rider is assigned to it. */
    deliveryId: { type: Schema.Types.ObjectId, ref: "Delivery", default: null },
    riderId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /**
     * When the seller accepted their lines. Accepting is what asks the store
     * team for a rider: the seller has nothing left to drive after it.
     */
    pickupRequestedAt: { type: Date, default: null },

    history: { type: [vendorOrderEventSchema], default: [] },
  },
  { timestamps: true }
);

// One group per vendor per order, so a webhook or a retried checkout cannot
// create a second copy of the same seller's lines.
vendorOrderSchema.index({ orderId: 1, vendorId: 1 }, { unique: true, name: "one_group_per_vendor_order" });
vendorOrderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

export const VendorOrder = model("VendorOrder", vendorOrderSchema);
