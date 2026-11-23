import { z } from "zod";
import { objectIdSchema } from "../../utils/ids";
// The warranty type list lives in one place, so the product form, the vendor
// form and the product page can never disagree about which codes exist.
import { WARRANTY_TYPE_VALUES } from "../warranty/warranty.types";
import { VENDOR_PRODUCT_STATUSES } from "../vendor/vendor.types";

const objectId = objectIdSchema("Invalid ID");

export const createProductSchema = z.object({
  ownerId: objectId,
  title: z.string().min(1, "Title is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase, hyphen-separated"),

  categoryId: objectId,
  subCategoryIds: z.array(objectId).optional(),

  price: z.number().positive("Price must be positive"),
  originalPrice: z.number().positive().optional(),
  investPrice: z.number().nonnegative().optional(), // the owner's purchase/cost price

  image: z.string().url("Image must be a valid URL"),
  additionalImages: z.array(z.string().url()).optional(),

   inStock: z.boolean().optional(),
  // A blank stock field means the product is not stock-tracked. `null` clears a
  // number the admin removed, while leaving the field out keeps the stored one.
  stockQuantity: z.number().int().nonnegative().nullable().optional(),
  sellCount: z.number().int().nonnegative().optional(),

  sku: z.string().optional(),
  description: z.string().optional(),
  specifications: z.record(z.string(), z.any()).optional(),
  // `isFeatured` is deliberately absent: a shelf is lit by a dated placement on
  // the promotions desk, never by a listing form, so no create or update can
  // leave a product featured past the placement that paid for it.
  offerEndDate: z.coerce.date().optional().nullable(),
  warrantyPeriodMonths: z.number().int().nonnegative().max(120).optional(),
  warrantyType: z.enum(WARRANTY_TYPE_VALUES).optional(),
  warrantyTerms: z.string().max(1000).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const getProductsQuerySchema = z.object({
  category: z.string().optional(),
  categoryId: z.string().optional(),
  subCategory: z.string().optional(),
  subCategoryId: z.string().optional(),
  search: z.string().optional(),
  // One seller's shelf: the storefront passes the shop's slug, and a desk that
  // already resolved the store can pass its id straight through.
  storeSlug: z.string().trim().max(140).optional(),
  storeId: z.string().trim().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  minDiscount: z.coerce.number().nonnegative().optional(),
  maxDiscount: z.coerce.number().nonnegative().optional(),
  discount: z.string().optional(),
  isFeatured: z
    .preprocess(
      (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined),
      z.boolean().optional()
    ),
  inStock: z
    .preprocess(
      (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined),
      z.boolean().optional()
    ),
  sort: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
  minRating: z.coerce.number().min(0).max(5).optional(),
  hasOffer: z
    .preprocess(
      (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined),
      z.boolean().optional()
    ),
  /**
   * The desk's listing-status filter. The shop never sends it and the public
   * view ignores it, because a shopper has no business naming a draft.
   */
  vendorStatus: z.enum([...VENDOR_PRODUCT_STATUSES, "all"]).optional(),
  mode: z.string().optional(),
});

/**
 * An admin's decision on a listing waiting in the review queue.
 *
 * A rejection without a reason is a dead end for the seller — they would not
 * know what to change — so the reason is required there and only there.
 */
export const reviewVendorProductSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.decision !== "reject" || (value.reason?.length ?? 0) >= 5, {
    message: "Tell the seller what to change (at least 5 characters)",
    path: ["reason"],
  });

export type ReviewVendorProductInput = z.infer<typeof reviewVendorProductSchema>;

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type GetProductsQuery = z.infer<typeof getProductsQuerySchema>;