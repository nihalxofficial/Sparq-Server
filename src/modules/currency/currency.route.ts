import { Router } from "express";
import { requireCronOrAdmin } from "../../middlewares/cron.middleware";
import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { refreshCurrencyRates } from "./currency.service";

const router = Router();

/** Pull the day's rates. Run by cron, or by hand from the admin dashboard. */
router.get(
  "/refresh",
  requireCronOrAdmin,
  catchAsync(async (_req, res) => {
    const result = await refreshCurrencyRates();
    apiResponse(res, 200, result, "Currency rates refreshed");
  })
);

export default router;
