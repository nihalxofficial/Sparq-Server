import { Banner } from "./banner.model";
import { Product } from "../product/product.model";
import { Category } from "../category/category.model";
import { VendorStore } from "../vendor/vendor-store.model";
import { ApiError } from "../../utils/apiError";
import { CreateBannerInput, UpdateBannerInput } from "./banner.validator";

type BannerStatus = "draft" | "scheduled" | "active" | "expired";

/** An id from either a raw ObjectId or a populated document. */
function idOf(value: any): string | null {
  if (!value) return null;
  return (value._id ?? value).toString();
}

/** What a banner is doing now, read from its publish switch and its dates. */
function statusOf(banner: any, now = Date.now()): BannerStatus {
  if (!banner.isActive) return "draft";
  const start = banner.startDate ? new Date(banner.startDate).getTime() : null;
  const end = banner.endDate ? new Date(banner.endDate).getTime() : null;
  if (start !== null && start > now) return "scheduled";
  if (end !== null && end < now) return "expired";
  return "active";
}

/** The public link a banner's target resolves to, or "" when the target is gone. */
function hrefFor(banner: any): string {
  if (banner.type === "product") {
    return banner.productId?.slug ? `/shop/${banner.productId.slug}` : "";
  }
  if (banner.type === "category") {
    return banner.categoryId?.slug
      ? `/shop?category=${encodeURIComponent(banner.categoryId.slug)}`
      : "";
  }
  if (banner.type === "vendor") {
    return banner.vendorId?.slug ? `/vendors/${banner.vendorId.slug}` : "";
  }
  return banner.customUrl || "";
}

function shapeBanner(banner: any) {
  const href = hrefFor(banner);
  return {
    id: banner._id.toString(),
    title: banner.title,
    subtitle: banner.subtitle || "",
    type: banner.type,
    desktopImage: banner.desktopImage,
    mobileImage: banner.mobileImage || "",
    ctaText: banner.ctaText || "Shop Now",
    order: banner.order ?? 0,
    startDate: banner.startDate ?? null,
    endDate: banner.endDate ?? null,
    status: statusOf(banner),
    isActive: Boolean(banner.isActive),
    target: {
      productId: idOf(banner.productId),
      categoryId: idOf(banner.categoryId),
      vendorId: idOf(banner.vendorId),
      customUrl: banner.customUrl || "",
    },
    // Only a product banner carries live pricing; the rest show artwork alone.
    product:
      banner.type === "product" && banner.productId?.slug
        ? {
            id: idOf(banner.productId),
            price: banner.productId.price ?? 0,
            originalPrice: banner.productId.originalPrice ?? null,
            offerEndDate: banner.productId.offerEndDate ?? null,
          }
        : null,
    href,
  };
}

const POPULATE = [
  { path: "productId", select: "slug price originalPrice offerEndDate" },
  { path: "categoryId", select: "slug" },
  { path: "vendorId", select: "slug" },
];

/** Refuses a banner whose chosen target does not exist, before it is stored. */
async function assertTarget(type: string, data: any) {
  if (type === "product") {
    if (!data.productId || !(await Product.exists({ _id: data.productId }))) {
      throw new ApiError(400, "The selected product no longer exists");
    }
  } else if (type === "category") {
    if (!data.categoryId || !(await Category.exists({ _id: data.categoryId }))) {
      throw new ApiError(400, "The selected category no longer exists");
    }
  } else if (type === "vendor") {
    if (!data.vendorId || !(await VendorStore.exists({ _id: data.vendorId }))) {
      throw new ApiError(400, "The selected vendor no longer exists");
    }
  } else if (type === "custom") {
    if (!data.customUrl) throw new ApiError(400, "A destination URL is required");
  }
}

/** Only the target that matches the type survives, so a stale one cannot linger. */
function targetFields(type: string, data: any) {
  return {
    productId: type === "product" ? data.productId ?? null : null,
    categoryId: type === "category" ? data.categoryId ?? null : null,
    vendorId: type === "vendor" ? data.vendorId ?? null : null,
    customUrl: type === "custom" ? data.customUrl ?? "" : "",
  };
}

export async function createBanner(data: CreateBannerInput) {
  await assertTarget(data.type, data);

  const banner = await Banner.create({
    title: data.title,
    subtitle: data.subtitle ?? "",
    type: data.type,
    desktopImage: data.desktopImage,
    mobileImage: data.mobileImage ?? "",
    ctaText: data.ctaText || "Shop Now",
    order: data.order ?? 0,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    isActive: data.isActive ?? false,
    ...targetFields(data.type, data),
  });

  await banner.populate(POPULATE);
  return shapeBanner(banner);
}

export async function updateBanner(id: string, data: UpdateBannerInput) {
  const existing: any = await Banner.findById(id).lean();
  if (!existing) throw new ApiError(404, "Banner not found");

  const merged = {
    ...existing,
    ...data,
    productId: data.productId ?? existing.productId,
    categoryId: data.categoryId ?? existing.categoryId,
    vendorId: data.vendorId ?? existing.vendorId,
    customUrl: data.customUrl ?? existing.customUrl,
  };

  await assertTarget(merged.type, merged);

  const banner = await Banner.findByIdAndUpdate(
    id,
    { ...data, ...targetFields(merged.type, merged) },
    { new: true }
  ).populate(POPULATE);

  if (!banner) throw new ApiError(404, "Banner not found");
  return shapeBanner(banner);
}

export async function deleteBanner(id: string) {
  const banner = await Banner.findByIdAndDelete(id);
  if (!banner) throw new ApiError(404, "Banner not found");
}

/** The admin list: every banner, in display order, broken targets included. */
export async function listBanners() {
  const banners = await Banner.find().sort({ order: 1, createdAt: -1 }).populate(POPULATE);
  return banners.map(shapeBanner);
}

/**
 * The homepage list: only what should show right now — published, inside its own
 * date window, and still pointing somewhere real. A banner whose product,
 * category or shop has since been removed is skipped rather than drawn dead.
 */
export async function getPublicBanners() {
  const now = new Date();
  const banners = await Banner.find({
    isActive: true,
    $and: [
      { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
    ],
  })
    .sort({ order: 1, createdAt: -1 })
    .populate(POPULATE);

  return banners.map(shapeBanner).filter((banner) => banner.href);
}
