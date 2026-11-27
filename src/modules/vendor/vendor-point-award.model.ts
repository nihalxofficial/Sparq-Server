import { Schema, model } from "mongoose";

/**
 * One permanent award of plan points to a seller.
 *
 * Every plan period — the Free plan on approval, a renewal, an upgrade — writes
 * a row here, so a seller's points grow with each subscription and never fall
 * away when a placement ends. The total is the sum of these awards plus the
 * points earned on delivered units; the featured shelf's own ordering still uses
 * the live placement score, which is a different number.
 */
const vendorPointAwardSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plan: { type: String, required: true },
    billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
    points: { type: Number, required: true, min: 0 },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "VendorSubscription", default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

vendorPointAwardSchema.index({ vendorId: 1, createdAt: -1 });

export const VendorPointAward = model("VendorPointAward", vendorPointAwardSchema);
