import { Schema, model } from "mongoose";

const transactionSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    method: { type: String, enum: ["cod", "bkash", "rocket", "nagad"], required: true },
    amount: { type: Number, required: true },
    // "refunded" is what a cancelled order leaves on a payment that had already
    // gone through; "failed" is a payment that never landed.
    status: {
      type: String,
      enum: ["pending", "success", "failed", "refunded"],
      default: "pending",
    },
    reference: { type: String, required: true },
    // No payment gateway runs in this build: an online payment is simulated, so
    // the row says so rather than pretending a wallet really charged the buyer.
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Transaction = model("Transaction", transactionSchema);