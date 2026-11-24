import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import * as bannerService from "./banner.service";

export const getPublicBanners = catchAsync(async (_req, res) => {
  const banners = await bannerService.getPublicBanners();
  apiResponse(res, 200, banners);
});

export const listBanners = catchAsync(async (_req, res) => {
  const banners = await bannerService.listBanners();
  apiResponse(res, 200, banners);
});

export const createBanner = catchAsync(async (req, res) => {
  const banner = await bannerService.createBanner(req.body);
  apiResponse(res, 201, banner, "Banner created");
});

export const updateBanner = catchAsync(async (req, res) => {
  const banner = await bannerService.updateBanner(req.params.id as string, req.body);
  apiResponse(res, 200, banner, "Banner updated");
});

export const deleteBanner = catchAsync(async (req, res) => {
  await bannerService.deleteBanner(req.params.id as string);
  apiResponse(res, 200, null, "Banner deleted");
});
