import { notifyUser, recordActivity } from "../activity/activity.service";

/**
 * Every marketplace notification, in one place.
 *
 * Two audiences: the vendor's own bell and the store team's shared feed. Both
 * swallow their errors — a notification is a side note, so a failed write must
 * never turn a review or an approval into an error the caller sees. The stored
 * `ref` is the id the receiving screen searches for, never a route, so an old
 * line still opens the right page after a rename.
 */

/** One application event for the applicant. */
export async function notifyVendorApplication(params: {
  userId: string;
  title: string;
  detail?: string;
  applicationId: string;
}) {
  await notifyUser({
    userId: params.userId,
    role: "vendor",
    type: "vendor_application",
    title: params.title,
    detail: params.detail || "",
    ref: params.applicationId,
  });
}

/** A new or resubmitted application on the store's board. */
export async function notifyAdminVendorApplication(params: {
  title: string;
  detail?: string;
  applicationId: string;
}) {
  await recordActivity({
    type: "vendor",
    title: params.title,
    detail: params.detail || "",
    ref: params.applicationId,
  });
}

/** A subscription or payment event for the vendor. */
export async function notifyVendorSubscription(params: {
  userId: string;
  title: string;
  detail?: string;
  subscriptionId: string;
  type?: "vendor_subscription" | "vendor_payment";
}) {
  await notifyUser({
    userId: params.userId,
    role: "vendor",
    type: params.type || "vendor_subscription",
    title: params.title,
    detail: params.detail || "",
    ref: params.subscriptionId,
  });
}

/** A subscription event on the store's board. */
export async function notifyAdminVendorSubscription(params: {
  title: string;
  detail?: string;
  subscriptionId: string;
}) {
  await recordActivity({
    type: "vendor",
    title: params.title,
    detail: params.detail || "",
    ref: params.subscriptionId,
  });
}

/**
 * A featured placement the seller did not choose themselves.
 *
 * Only the store team's grant and revoke use this: a seller who pinned their own
 * product just pressed the button and needs no line in their bell about it.
 */
export async function notifyVendorPromotion(params: {
  userId: string;
  title: string;
  detail?: string;
  promotionId: string;
}) {
  await notifyUser({
    userId: params.userId,
    role: "vendor",
    type: "vendor_promotion",
    title: params.title,
    detail: params.detail || "",
    ref: params.promotionId,
  });
}

/**
 * A plan's own spotlight, on the store team's board.
 *
 * Nobody pressed a button: a paid period started and the shop took its week on
 * the marquee. The desk is told so it does not read the placement as a favour
 * it does not remember giving, and it can pull the row back like any other.
 */
export async function notifyAdminPlanSpotlight(params: {
  title: string;
  detail?: string;
  promotionId: string;
}) {
  await recordActivity({
    type: "vendor",
    title: params.title,
    detail: params.detail || "",
    ref: params.promotionId,
  });
}
