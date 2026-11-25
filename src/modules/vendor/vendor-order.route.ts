import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { requireCronOrAdmin } from "../../middlewares/cron.middleware";
import { validate } from "../../utils/validate";
import * as controller from "./vendor-order.controller";
import { vendorOrderStatusSchema } from "./vendor-order.validator";

const router = Router();

// Cron must sit above the vendor guard: Vercel calls this without a token.
router.get("/expire", requireCronOrAdmin, controller.expireUnanswered);

router.use(requireAuth, requireRole("vendor"));

router.get("/", controller.listMyOrders);
// Before `/:id`, otherwise "summary" would be read as an order id.
router.get("/summary", controller.getOrderSummary);
router.get("/:id", controller.getMyOrder);
router.patch("/:id/status", validate(vendorOrderStatusSchema), controller.updateMyOrderStatus);

export default router;
