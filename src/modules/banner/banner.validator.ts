import { z } from "zod";
import { objectIdSchema } from "../../utils/ids";

const objectId = objectIdSchema("Invalid ObjectId");

const bannerObject = z.object({
  title: z.string().trim().min(1, "Banner title is required"),
  subtitle: z.string().trim().optional(),
  type: z.enum(["product", "category", "vendor", "custom"]),

  desktopImage: z.string().trim().min(1, "A desktop banner image is required"),
  mobileImage: z.string().trim().optional(),

  ctaText: z.string().trim().optional(),

  productId: objectId.optional(),
  categoryId: objectId.optional(),
  vendorId: objectId.optional(),
  customUrl: z.string().trim().optional(),

  order: z.number().int().optional(),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
  isActive: z.boolean().optional(),
});

/** Each type carries exactly one target, so the required one is checked here. */
export const createBannerSchema = bannerObject.superRefine((data, ctx) => {
  if (data.type === "product" && !data.productId) {
    ctx.addIssue({ code: "custom", path: ["productId"], message: "Select a product" });
  }
  if (data.type === "category" && !data.categoryId) {
    ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Select a category" });
  }
  if (data.type === "vendor" && !data.vendorId) {
    ctx.addIssue({ code: "custom", path: ["vendorId"], message: "Select a vendor" });
  }
  if (data.type === "custom" && !data.customUrl) {
    ctx.addIssue({ code: "custom", path: ["customUrl"], message: "A destination URL is required" });
  }
});

export const updateBannerSchema = bannerObject.partial();

export type CreateBannerInput = z.infer<typeof bannerObject>;
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
