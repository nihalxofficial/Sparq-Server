import { z } from "zod";

/**
 * The fields the settings patch may carry.
 *
 * The object strips unknown keys, so the dashboard can only ever write the
 * settings the application actually reads: an arbitrary key from the request
 * body cannot land in the public settings document. Nested blocks are kept
 * flexible — the forms own their own shape — while the top level and the
 * shipping rates are checked.
 */
export const updateSiteSettingsSchema = z
  .object({
    siteName: z.string().optional(),
    siteTagline: z.string().optional(),
    storeType: z.string().optional(),
    supportEmail: z.string().optional(),
    contactEmail: z.string().optional(),
    supportPhone: z.string().optional(),
    openingHours: z.string().optional(),
    address: z.string().optional(),

    about: z.record(z.string(), z.any()).optional(),

    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),

    topBarText: z.string().optional(),
    topBarEnabled: z.boolean().optional(),
    topBarItems: z.array(z.record(z.string(), z.any())).optional(),

    mobileMenuPlacement: z.enum(["left", "right", "middle"]).optional(),

    logoType: z.enum(["both", "img", "text"]).optional(),
    navbarLogo: z.record(z.string(), z.any()).optional(),
    footerLogo: z.record(z.string(), z.any()).optional(),
    faviconUrl: z.string().optional(),

    colorPalette: z.record(z.string(), z.any()).optional(),
    typography: z.record(z.string(), z.any()).optional(),

    shipping: z
      .object({
        freeShippingEnabled: z.boolean().optional(),
        freeShippingThreshold: z.coerce.number().optional(),
        standardDeliveryFee: z.coerce.number().optional(),
        expressDeliveryFee: z.coerce.number().optional(),
        estimatedDeliveryDays: z.string().optional(),
        pointsEarnedPerDollar: z.coerce.number().min(0).optional(),
        pointsPerDollarRedeem: z.coerce.number().min(1).optional(),
        minPointsToRedeem: z.coerce.number().min(0).optional(),
      })
      .optional(),

    vendorPlacementPoints: z
      .object({
        basic: z.coerce.number().min(0).optional(),
        detailed: z.coerce.number().min(0).optional(),
        advanced: z.coerce.number().min(0).optional(),
        yearlyBonus: z.coerce.number().min(0).optional(),
        perDay: z.coerce.number().min(0).optional(),
        sellPerUnit: z.coerce.number().min(0).optional(),
      })
      .optional(),

    socialLinks: z.array(z.record(z.string(), z.any())).optional(),
    brandLogos: z.array(z.record(z.string(), z.any())).optional(),

    currency: z.string().optional(),
    timezone: z.string().optional(),
    maintenanceMode: z.boolean().optional(),
    footerCopyright: z.string().optional(),
  })
  .strip();

export type UpdateSiteSettingsInput = z.infer<typeof updateSiteSettingsSchema>;
