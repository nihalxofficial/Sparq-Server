import { Router } from "express";
import { validate } from "../../utils/validate";
import { createBannerSchema, updateBannerSchema } from "./banner.validator";
import * as bannerController from "./banner.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// The homepage reads only the banners eligible right now; the desk reads all.
router.get("/", bannerController.getPublicBanners);
router.get("/admin", requireAuth, requireRole("admin"), bannerController.listBanners);

router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  validate(createBannerSchema),
  bannerController.createBanner
);
router.patch(
  "/:id",
  requireAuth,
  requireRole("admin"),
  validate(updateBannerSchema),
  bannerController.updateBanner
);
router.delete("/:id", requireAuth, requireRole("admin"), bannerController.deleteBanner);

export default router;
