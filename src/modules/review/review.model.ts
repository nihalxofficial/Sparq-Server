import { Schema, model } from "mongoose";

const productReviewSchema = new Schema(
  {
    // Both ids are ObjectIds: the unique index below is only per-type, so a
    // `Mixed` field let the same pair be stored once as text and once as an
    // ObjectId — two rows the index considered different. Old text rows are
    // normalised by `scripts/dedupe-reviews.ts`.
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    images: { type: [String], default: [] }, // up to 5 review photo URLs
  },
  { timestamps: true }
);

// One review per customer per product. The service checks this first, and the
// index makes sure a double submit cannot slip through between the check and
// the insert.
productReviewSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const ProductReview = model("ProductReview", productReviewSchema);

// An existing duplicate pair would make the index impossible to build. Report it
// instead of letting the rejection take the process down.
ProductReview.init().catch((err: Error) => {
  console.error("[REVIEW] Could not build the unique review index:", err.message);
});
