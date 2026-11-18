import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import * as controller from "./vendor-admin.controller";

const router = Router();

/**
 * The seller board. Sellers never read this: their own figures come from
 * `/api/vendor-analytics`, scoped to their own rows.
 */
router.use(requireAuth, requireRole("admin"));

router.get("/", controller.getVendorBoard);
router.get("/:id", controller.getVendorBoardDetail);

export default router;
