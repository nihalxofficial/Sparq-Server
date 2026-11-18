import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { parseQuery } from "../../utils/validate";
import { vendorBoardQuerySchema } from "./vendor-admin.validator";
import * as service from "./vendor-admin.service";

/**
 * The store team's view of its sellers.
 *
 * Read-only on purpose: the decisions a desk makes about a seller — a plan, a
 * placement, a coupon — stay on the routes that own them, so there is exactly
 * one writer for each of those tables.
 */

export const getVendorBoard = catchAsync(async (req, res) => {
  const query = parseQuery(vendorBoardQuerySchema, req.query);
  const result = await service.listVendorBoard(query);
  apiResponse(res, 200, result, "Vendors fetched successfully");
});

export const getVendorBoardDetail = catchAsync(async (req, res) => {
  const result = await service.getVendorBoardDetail(req.params.id as string);
  apiResponse(res, 200, result, "Vendor fetched successfully");
});
