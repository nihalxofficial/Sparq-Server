import { Schema, model } from "mongoose";

/**
 * One homepage hero banner.
 *
 * A banner is a picture and a place to send the clicker. Its `type` decides
 * which target is meaningful — a product, a category, a vendor shop, or a plain
 * URL — so only the field that matches `type` is ever set.
 *
 * `isActive` is the publish switch: a saved-but-not-published banner is a draft.
 * Whether it is scheduled, active or expired is read from the dates at the
 * moment it is shown, not stored, so a banner can never claim a status its own
 * clock disagrees with.
 */
export const BANNER_TYPES = ["product", "category", "vendor", "custom"] as const;

const bannerSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "", trim: true },

    type: { type: String, enum: BANNER_TYPES, required: true, index: true },

    // The artwork is uploaded by hand, never taken from the product or shop.
    desktopImage: { type: String, required: true, trim: true },
    mobileImage: { type: String, default: "", trim: true },

    ctaText: { type: String, default: "Shop Now", trim: true },

    // Exactly one of these matches `type`.
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    vendorId: { type: Schema.Types.ObjectId, ref: "VendorStore", default: null },
    customUrl: { type: String, default: "", trim: true },

    order: { type: Number, default: 0, index: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },

    isActive: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export const Banner = model("Banner", bannerSchema);
