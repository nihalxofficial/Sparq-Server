import { catchAsync } from "../../utils/catchAsync";
import { apiResponse } from "../../utils/apiResponse";
import { ApiError } from "../../utils/apiError";
import * as siteSettingsService from "./site-settings.service";
import { updateSiteSettingsSchema } from "./site-settings.validator";

export const getSiteSettings = catchAsync(async (_req, res) => {
  const settings = await siteSettingsService.getSiteSettings();
  apiResponse(res, 200, settings);
});

export const updateSiteSettings = catchAsync(async (req, res) => {
  const parsed = updateSiteSettingsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0].message);
  }

  // Only known keys survive the parse, so an unknown field in the body is
  // dropped rather than written into the public settings document.
  if (Object.keys(parsed.data).length === 0) {
    throw new ApiError(400, "Nothing to update");
  }

  const settings = await siteSettingsService.updateSiteSettings(parsed.data);
  apiResponse(res, 200, settings, "Site settings updated");
});
