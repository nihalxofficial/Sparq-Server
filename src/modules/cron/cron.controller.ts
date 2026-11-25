import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { runDailySweep } from "./cron.service";

/**
 * Runs every scheduled sweep once and reports what each one did.
 *
 * This is the single job Vercel's Hobby plan runs each day. The same work is
 * still reachable one route at a time for a Pro plan or an external scheduler.
 */
export const runDailySweepHandler = catchAsync(async (_req, res) => {
  const report = await runDailySweep();
  apiResponse(res, 200, report, "Daily sweep complete");
});
