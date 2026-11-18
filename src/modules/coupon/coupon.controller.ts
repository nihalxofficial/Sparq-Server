import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { parseQuery } from "../../utils/validate";
import { couponQuerySchema } from "./coupon.validator";
import * as couponService from "./coupon.service";
import { notifyVendorCoupon } from "../vendor/vendor.notifications";

/**
 * The store team's own codes, and the checkout's validator.
 *
 * Admin codes are written with `ownerType: "admin"` and no vendor id, which is
 * what lets them discount anything in the store. The validate route is the one
 * shared desk: a shopper typing a code in the cart hits the same function the
 * checkout will later use, so the discount they are shown is the discount they
 * are charged.
 */

export const createCoupon = catchAsync(async (req, res) => {
  const coupon = await couponService.createCoupon(req.body, {
    ownerType: "admin",
    createdBy: req.user!.id,
  });
  apiResponse(res, 201, coupon, "Coupon created");
});

export const getCoupons = catchAsync(async (req, res) => {
  const query = parseQuery(couponQuerySchema, req.query);
  const result = await couponService.listCoupons(query);
  apiResponse(res, 200, result, "Coupons fetched successfully");
});

export const getCoupon = catchAsync(async (req, res) => {
  const row = await couponService.requireCoupon(req.params.id as string);
  apiResponse(res, 200, couponService.toCouponDto(row.toObject()), "Coupon fetched successfully");
});

export const updateCoupon = catchAsync(async (req, res) => {
  const coupon = await couponService.updateCoupon(req.params.id as string, req.body);
  apiResponse(res, 200, coupon, "Coupon updated");
});

/**
 * A live code is stopped with PATCH `isActive: false`, so DELETE is only asked
 * for when the owner wants the row gone. A code that has already been spent is
 * deactivated instead of erased: the ledger and the orders that quote it stay.
 */
export const deleteCoupon = catchAsync(async (req, res) => {
  const result = await couponService.stopCoupon(req.params.id as string, undefined, "delete");
  apiResponse(res, 200, result, result.deleted ? "Coupon deleted" : "Coupon stopped");
});

/**
 * The store team's block, unblock or removal of a code — including a seller's.
 *
 * The seller is told about it. A code vanishing from the checkout without a
 * word is indistinguishable from a bug, so the reason the desk wrote travels to
 * the seller's bell with the coupon id it belongs to.
 */
export const moderateCoupon = catchAsync(async (req, res) => {
  const result = await couponService.moderateCoupon(
    req.params.id as string,
    req.body,
    req.user!.id
  );

  const vendorId = result.coupon?.vendorId ? String(result.coupon.vendorId) : "";
  if (vendorId) {
    const code = result.coupon.code;
    const unblocking = req.body.action === "unblock";
    await notifyVendorCoupon({
      userId: vendorId,
      title: unblocking ? `Your coupon ${code} is live again` : `Your coupon ${code} was stopped`,
      detail: unblocking
        ? "The store team put it back on the checkout."
        : result.coupon.blockedReason || "Stopped by the store team",
      couponId: String(result.coupon._id),
    });
  }

  const message = result.deleted
    ? "Coupon deleted"
    : req.body.action === "unblock"
      ? "Coupon put back on the checkout"
      : "Coupon stopped";
  apiResponse(res, 200, result, message);
});

/**
 * "Does this code work on what I have in the cart?"
 *
 * The shopper only sends product ids and quantities. Prices, sellers and
 * categories are read back here, so nothing about the money can be steered from
 * the browser.
 */
export const validateCoupon = catchAsync(async (req, res) => {
  const coupon = await couponService.validateCouponForUser({
    code: req.body.code,
    userId: req.user!.id,
    items: req.body.items,
  });
  apiResponse(res, 200, coupon, "Coupon applied");
});
