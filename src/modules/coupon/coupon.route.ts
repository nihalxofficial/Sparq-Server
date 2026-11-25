import { Router } from "express";
import { validate } from "../../utils/validate";
import {
  createCouponSchema,
  moderateCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
} from "./coupon.validator";
import * as controller from "./coupon.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// A shopper may ask whether a code works; only the store team may write codes.
router.post(
  "/validate",
  requireAuth,
  validate(validateCouponSchema),
  controller.validateCoupon
);

router.use(requireAuth, requireRole("admin"));

router.get("/", controller.getCoupons);
router.post("/", validate(createCouponSchema), controller.createCoupon);
router.get("/:id", controller.getCoupon);
router.patch("/:id", validate(updateCouponSchema), controller.updateCoupon);
// A seller's code can only be removed from here — the store team never edits or
// stops one; it deletes a misleading code and the seller is notified.
router.patch("/:id/moderate", validate(moderateCouponSchema), controller.moderateCoupon);
router.delete("/:id", controller.deleteCoupon);

export default router;
