import { Router } from "express";
import { validate } from "../../utils/validate";
import { createOrderSchema, updateOrderStatusSchema, cancelOrderSchema } from "./order.validator";
import * as orderController from "./order.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

router.get("/", requireAuth, orderController.getOrders);
router.get("/:id", requireAuth, orderController.getOrderById);
router.post("/", requireAuth, validate(createOrderSchema), orderController.createOrder);
router.patch("/:id/status", requireAuth, requireRole("admin"), validate(updateOrderStatusSchema), orderController.updateOrderStatus);
// The customer calling off their own order, before it ships.
router.patch("/:id/cancel", requireAuth, validate(cancelOrderSchema), orderController.cancelMyOrder);

export default router;