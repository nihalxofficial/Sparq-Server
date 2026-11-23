import { Router } from "express";
import { validate } from "../../utils/validate";
import {
  createVendorProductSchema,
  updateVendorProductSchema,
} from "./vendor-product.validator";
import * as controller from "./vendor-product.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Accessible to vendors and store administrators.
router.use(requireAuth, requireRole("vendor", "admin"));

router.get("/", controller.listMyProducts);
router.post("/", validate(createVendorProductSchema), controller.createMyProduct);
router.get("/:id", controller.getMyProduct);
router.patch("/:id", validate(updateVendorProductSchema), controller.updateMyProduct);
router.patch("/:id/unarchive", controller.unarchiveMyProduct);
router.delete("/:id", controller.archiveMyProduct);

export default router;
