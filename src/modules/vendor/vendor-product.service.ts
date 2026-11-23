import { Types } from "mongoose";
import { ApiError } from "../../utils/apiError";
import { Product } from "../product/product.model";
import { formatProduct, getRatingsMap, realizedSalesFor } from "../product/product.service";
import { Category } from "../category/category.model";
import { SubCategory } from "../subcategory/subcategory.model";
import { requireStore, requireTradingStore, syncStoreProductCount } from "./vendor-store.service";
import { endPlacementForProduct } from "./featured-promotion.service";
import { slugify } from "./vendor-application.service";
import { getVendorPlanState } from "./vendor-subscription.service";
import { notifyAdminProductReview, notifyVendorProductStatus } from "./vendor.notifications";
import { isLiveVendorProductStatus, VENDOR_LIVE_PRODUCT_STATUSES } from "./vendor.types";
import type { VendorProductStatus } from "./vendor.types";
import type {
  CreateVendorProductInput,
  UpdateVendorProductInput,
  VendorProductQuery,
} from "./vendor-product.validator";

/**
 * The vendor's catalogue.
 *
 * Every query starts from the signed-in account and adds `vendorId` to it, so
 * no request can read or write another seller's row even when it guesses an id.
 *
 * A save never publishes. A new listing is a draft, the seller submits it to
 * the review queue, and only an admin's approval makes it live — so the plan
 * limit is checked at that approval, when the row is about to take a slot a
 * buyer can actually reach.
 */

/** A slug no other product uses, derived from the title. */
async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "product";
  let candidate = root;
  let suffix = 2;

  // A handful of rounds is enough; the loop stops at the first free value.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const clash = await Product.exists({ slug: candidate });
    if (!clash) return candidate;
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }

  return `${root}-${Date.now()}`;
}

async function assertCategory(categoryId: string, subCategoryIds?: string[]): Promise<void> {
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(404, "Category not found");

  if (subCategoryIds?.length) {
    const count = await SubCategory.countDocuments({ _id: { $in: subCategoryIds } });
    if (count !== subCategoryIds.length) {
      throw new ApiError(404, "One or more subcategories not found");
    }
  }
}

/** The signed-in vendor's product, or a 404 — never a 403 that confirms the id. */
async function requireOwnedProduct(userId: string, productId: string) {
  const product = await Product.findOne({ _id: productId, vendorId: userId });
  if (!product) throw new ApiError(404, "Product not found");
  return product;
}

/** A live listing is "out_of_stock" once its tracked count runs out. */
function liveStatusFor(stockQuantity?: number | null): VendorProductStatus {
  return typeof stockQuantity === "number" && stockQuantity <= 0
    ? "out_of_stock"
    : "published";
}

/**
 * The status a save should end in, from what the seller asked for.
 *
 * A live listing keeps its shelf: only its stock can move it between the two
 * live statuses, and asking for anything else there is refused because taking
 * a listing off sale and back is a decision the review desk makes. A listing
 * that is not live stays where it is unless the seller submits it, withdraws
 * it, or archives it — all three moves are theirs to make.
 */
function resolveStatus(input: {
  current: string;
  requested?: string;
  stockQuantity?: number | null;
}): VendorProductStatus {
  const current = input.current;
  const live = isLiveVendorProductStatus(current);
  const requested = input.requested;

  if (!requested) {
    return live ? liveStatusFor(input.stockQuantity) : (current as VendorProductStatus);
  }

  if (requested === "archived") return "archived";

  if (live) {
    throw new ApiError(400, "Archive the listing before moving it back to a draft.");
  }

  return requested === "pending_review" ? "pending_review" : "draft";
}

/**
 * The order each sort key means on the seller's own desk. Newest is "last
 * touched", which is what a seller expects at the top of their own list; the
 * price sorts read the stored price, the same number the row edits.
 */
const SORT_ORDERS: Record<string, Record<string, 1 | -1>> = {
  newest: { updatedAt: -1, _id: -1 },
  oldest: { updatedAt: 1, _id: 1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: -1 },
};

/** The list screen: rows, per-status counts, paging and the plan's usage. */
export async function listMyProducts(userId: string, query: VendorProductQuery) {
  const { status, search, stock, sort, page, limit } = query;

  // Everything the list is narrowed by except the tab itself. The counts read
  // these same conditions, so a badge always says what pressing it would list.
  const narrowing: Record<string, unknown>[] = [];

  if (search?.trim()) {
    const match = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    narrowing.push({ $or: [{ title: match }, { sku: match }, { brand: match }] });
  }

  // The stock reading the shop's stock column uses: a row with no stock number
  // is untracked and therefore never sold out.
  if (stock === "in") {
    narrowing.push({
      $or: [{ stockQuantity: null }, { stockQuantity: { $gt: 0 }, inStock: { $ne: false } }],
    });
  } else if (stock === "out") {
    narrowing.push({
      $and: [
        { stockQuantity: { $ne: null } },
        { $or: [{ stockQuantity: { $lte: 0 } }, { inStock: false }] },
      ],
    });
  }

  // "Published" is the live shelf, and a live listing whose tracked stock ran
  // out is still on it — the stock chips ask the sold-out question on their own.
  const filter =
    status && status !== "all"
      ? {
          $and: [
            { vendorId: userId },
            ...narrowing,
            status === "published"
              ? { vendorProductStatus: { $in: [...VENDOR_LIVE_PRODUCT_STATUSES] } }
              : { vendorProductStatus: status },
          ],
        }
      : { $and: [{ vendorId: userId }, ...narrowing] };

  const [rows, total, counts, planState] = await Promise.all([
    Product.find(filter)
      .populate("categoryId", "name slug")
      .populate("subCategoryIds", "name slug")
      .sort(SORT_ORDERS[sort] ?? SORT_ORDERS.newest)
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(filter),
    Product.aggregate([
      // Aggregations skip Mongoose casting, so the id has to be an ObjectId here.
      { $match: { $and: [{ vendorId: new Types.ObjectId(userId) }, ...narrowing] } },
      { $group: { _id: "$vendorProductStatus", count: { $sum: 1 } } },
    ]),
    getVendorPlanState(userId),
  ]);

  const typeCounts = (counts as Array<{ _id: string | null; count: number }>).reduce<
    Record<string, number>
  >((all, row) => {
    all[String(row._id ?? "published")] = Number(row.count) || 0;
    return all;
  }, {});
  // A live listing that ran out is still published as far as the strip is
  // concerned; the stock chips carry the sold-out reading instead.
  typeCounts.published = (typeCounts.published ?? 0) + (typeCounts.out_of_stock ?? 0);
  delete typeCounts.out_of_stock;

  // The strip's first tab is everything the other filters leave, so its badge
  // is the sum rather than a bucket of its own.
  typeCounts.all = Object.values(typeCounts).reduce((sum, value) => sum + value, 0);

  return {
    products: rows.map((row) => formatProduct(row, { view: "vendor" })),
    total,
    typeCounts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    plan: {
      id: planState.plan.id,
      name: planState.plan.name,
      maxProducts: planState.plan.maxProducts,
      used: planState.usage.products,
      isLive: planState.isLive,
      effectiveUntil: planState.effectiveUntil,
    },
  };
}

/** One of the vendor's products, with full categories, store info and realized sales. */
export async function getMyProduct(userId: string, productId: string, isAdmin = false) {
  const isId = Types.ObjectId.isValid(productId);
  const filter = isAdmin
    ? (isId ? { _id: productId } : { slug: productId })
    : (isId
        ? { _id: productId, $or: [{ vendorId: userId }, { ownerId: userId }] }
        : { slug: productId, $or: [{ vendorId: userId }, { ownerId: userId }] });

  const product = await Product.findOne(filter)
    .populate("categoryId", "name slug")
    .populate("subCategoryIds", "name slug")
    .populate("storeId", "name slug");

  if (!product) throw new ApiError(404, "Product not found");

  const ratingsMap = await getRatingsMap([String(product._id)]);
  const formatted = formatProduct(product, { ratingsMap, view: "vendor" });
  return { ...formatted, sales: await realizedSalesFor(product) };
}

/**
 * Saves a new listing as a draft, or files it straight into the review queue.
 *
 * Neither branch checks the plan limit or the store's count: a listing takes a
 * live slot only when an admin approves it, and a seller with a full shelf can
 * still prepare the next product and make room before the decision.
 */
export async function createMyProduct(userId: string, input: CreateVendorProductInput) {
  const store = await requireTradingStore(userId, "listing products");
  await assertCategory(input.categoryId, input.subCategoryIds);

  const submit = Boolean(input.submit);
  const status: VendorProductStatus = submit ? "pending_review" : "draft";

  const slug = input.slug?.trim()
    ? await uniqueSlug(input.slug)
    : await uniqueSlug(input.title);

  const product = await Product.create({
    ownerId: userId,
    vendorId: userId,
    storeId: store._id,
    vendorProductStatus: status,
    // Nothing a buyer can reach, and no approval yet, so the row stays dark.
    isVisible: false,
    publishedAt: null,
    submittedAt: submit ? new Date() : null,
    title: input.title,
    slug,
    categoryId: input.categoryId,
    subCategoryIds: input.subCategoryIds ?? [],
    price: input.price,
    originalPrice: input.originalPrice ?? undefined,
    investPrice: input.investPrice ?? undefined,
    image: input.image,
    additionalImages: input.additionalImages ?? [],
    stockQuantity: input.stockQuantity ?? null,
    inStock: (input.stockQuantity ?? 1) > 0,
    sku: input.sku ?? "",
    brand: input.brand ?? "",
    description: input.description ?? "",
    specifications: input.specifications ?? {},
    offerEndDate: input.offerEndDate ?? undefined,
    warrantyPeriodMonths: input.warrantyPeriodMonths ?? 0,
    warrantyType: input.warrantyType ?? "manufacturer-warranty",
    warrantyTerms: input.warrantyTerms ?? undefined,
    variantOptions: input.variantOptions ?? [],
    shippingInfo: input.shippingInfo ?? {},
  });

  // A submission is the desk's cue: the row waits in the queue until someone
  // answers it, and the seller gets the receipt for the same move. A plain
  // draft is the seller's own business, so neither side is told about it.
  if (submit) {
    await notifyAdminProductReview({
      title: `Listing waiting for review: ${product.title}`,
      detail: `${store.name} · filed for approval`,
      productId: String(product._id),
    });
    await notifyVendorProductStatus({
      userId,
      title: "Listing sent for review",
      detail: `"${product.title}" is in the store's review queue.`,
      productId: String(product._id),
    });
  }

  return formatProduct(product);
}

/**
 * Edits one of the seller's listings.
 *
 * The content is always writable, including a rejected listing the seller is
 * fixing. The status only moves where a seller is allowed to move it — into
 * the review queue, back to a draft, or to the archive — so an approved
 * listing keeps its shelf while it is edited. A listing that leaves the shelf
 * gives its featured placement back.
 */
export async function updateMyProduct(
  userId: string,
  productId: string,
  input: UpdateVendorProductInput
) {
  const product = await requireOwnedProduct(userId, productId);
  const store = await requireTradingStore(userId, "editing a listing");

  if (input.categoryId || input.subCategoryIds) {
    await assertCategory(
      input.categoryId ?? String(product.categoryId),
      input.subCategoryIds
    );
  }

  const currentStatus = String(product.vendorProductStatus ?? "published");
  const wasLive = isLiveVendorProductStatus(currentStatus);
  const stock = input.stockQuantity !== undefined ? input.stockQuantity : product.stockQuantity;
  const nextStatus = resolveStatus({
    current: currentStatus,
    requested: input.status,
    stockQuantity: stock,
  });
  const willBeLive = isLiveVendorProductStatus(nextStatus);

  const update: Record<string, unknown> = { vendorProductStatus: nextStatus };

  const fields = [
    "title",
    "categoryId",
    "subCategoryIds",
    "price",
    "originalPrice",
    "investPrice",
    "image",
    "additionalImages",
    "stockQuantity",
    "sku",
    "brand",
    "description",
    "specifications",
    "offerEndDate",
    "warrantyPeriodMonths",
    "warrantyType",
    "warrantyTerms",
    "variantOptions",
    "shippingInfo",
  ] as const;

  for (const field of fields) {
    if (input[field] !== undefined) update[field] = input[field];
  }

  // A new title is a new address only while the product has never been live;
  // a published product keeps its slug so existing links and orders survive.
  if (input.title && !product.publishedAt && input.title !== product.title) {
    update.slug = await uniqueSlug(input.slug?.trim() || input.title);
  } else if (input.slug && !product.publishedAt) {
    update.slug = await uniqueSlug(input.slug);
  }

  if (input.stockQuantity !== undefined) {
    update.inStock = input.stockQuantity === null || input.stockQuantity > 0;
  }

  // Only a live listing can be deliberately hidden. A draft, a submission and
  // a rejected row are invisible until the desk approves them, and a fresh
  // submission re-queues the row so the reviewer sees the latest content.
  if (willBeLive) {
    if (input.isVisible !== undefined) update.isVisible = input.isVisible;
  } else {
    update.isVisible = false;
  }

  if (nextStatus === "pending_review") {
    update.submittedAt = new Date();
  }

  Object.assign(product, update);
  await product.save();

  // Only the move into the queue is news. Saving a row that is already waiting
  // leaves both bells alone, so a seller editing before the decision does not
  // bury the desk in duplicate lines.
  if (nextStatus === "pending_review" && currentStatus !== "pending_review") {
    const resubmitted = currentStatus === "rejected";
    await notifyAdminProductReview({
      title: resubmitted
        ? `Listing resubmitted for review: ${product.title}`
        : `Listing waiting for review: ${product.title}`,
      detail: `${store.name} · filed for approval`,
      productId: String(product._id),
    });
    await notifyVendorProductStatus({
      userId,
      title: resubmitted ? "Listing resubmitted" : "Listing sent for review",
      detail: `"${product.title}" is in the store's review queue.`,
      productId: String(product._id),
    });
  }

  // A listing nobody can reach has no business holding a featured shelf, so the
  // placement is closed and the slot given back rather than left glowing.
  if (!willBeLive || product.isVisible === false) {
    await endPlacementForProduct(String(product._id), "The listing is no longer on sale");
  }

  // Only a move that can change the live count is worth a recount.
  if (wasLive !== willBeLive) {
    await syncStoreProductCount(String(store._id));
  }

  return formatProduct(product);
}

/** Archives a product. Nothing is deleted while orders can still reference it. */
export async function archiveMyProduct(userId: string, productId: string) {
  const product = await requireOwnedProduct(userId, productId);
  const store = await requireStore(userId);

  product.vendorProductStatus = "archived";
  product.isVisible = false;
  await product.save();

  // The shelf goes with the listing, and the row says why it went quiet.
  await endPlacementForProduct(String(product._id), "The listing was archived");

  await syncStoreProductCount(String(store._id));
  return formatProduct(product);
}

/** Unarchives a listing as a draft, so it goes back through review to sell again. */
export async function unarchiveMyProduct(userId: string, productId: string) {
  const product = await requireOwnedProduct(userId, productId);
  const store = await requireStore(userId);

  product.vendorProductStatus = "draft";
  product.isVisible = false;
  await product.save();

  await syncStoreProductCount(String(store._id));
  return formatProduct(product);
}
