import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { parseQuery } from "../../utils/validate";
import { vendorAnalyticsQuerySchema } from "./vendor-analytics.validator";
import * as vendorAnalyticsService from "./vendor-analytics.service";
import { getVendorOrderFinancialAnalytics } from "../order/order-financials.service";

/**
 * The seller's report.
 *
 * The vendor id comes from the token and nowhere else, so the window can be
 * chosen but the shop cannot.
 */

export const getMyAnalytics = catchAsync(async (req, res) => {
  const query = parseQuery(vendorAnalyticsQuerySchema, req.query);
  const report = await vendorAnalyticsService.getVendorAnalytics(req.user!.id, query);
  apiResponse(res, 200, report, "Analytics fetched successfully");
});

export const getMyFinancialAnalytics = catchAsync(async (req, res) => {
  const result = await getVendorOrderFinancialAnalytics(req.user!.id, {
    days: req.query.days ? Number(req.query.days) : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  apiResponse(res, 200, result, "Vendor financial analytics fetched successfully");
});
