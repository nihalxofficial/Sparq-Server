import { Router } from "express";
import { requireCronOrAdmin } from "../../middlewares/cron.middleware";
import * as cronController from "./cron.controller";

/**
 * One daily sweep for a plan that only allows daily cron jobs.
 *
 * `GET /api/cron/daily` runs every scheduled task in order. It is guarded like
 * the other scheduled routes: a bearer `CRON_SECRET` (sent by Vercel Cron) or a
 * signed-in store admin. The finer-grained routes stay mounted for a Pro plan.
 */
const router = Router();

router.get("/daily", requireCronOrAdmin, cronController.runDailySweepHandler);
router.post("/daily", requireCronOrAdmin, cronController.runDailySweepHandler);

export default router;
