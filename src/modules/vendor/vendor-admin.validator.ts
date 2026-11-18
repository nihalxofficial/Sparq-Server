import { z } from "zod";
import { VENDOR_STORE_STATUSES } from "./vendor.types";

/**
 * The store team's board of sellers.
 *
 * `plan` is a free string rather than an enum because the plan table is edited
 * from the dashboard and a plan added today must be filterable today. The value
 * is compared against the seller's live plan id, so an unknown id simply
 * matches nobody instead of failing the read.
 */
export const vendorBoardQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  status: z.enum([...VENDOR_STORE_STATUSES, "all"]).optional().default("all"),
  plan: z.string().trim().max(40).optional().default("all"),
  featured: z.enum(["all", "yes", "no"]).optional().default("all"),
  sort: z
    .enum(["points", "sales", "subscription", "success", "products", "newest", "name"])
    .optional()
    .default("points"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type VendorBoardQueryInput = z.infer<typeof vendorBoardQuerySchema>;
