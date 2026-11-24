import mongoose from "mongoose";
import { UNDO_COLLECTION } from "./demo.plugin";
import { idVariants, toObjectId } from "../../utils/ids";

type Counts = { removed: number; restored: number; kept: number };

/**
 * The collections that can point at something the demo admin created, and the
 * fields that carry such a pointer. A match on any of these means a real row
 * depends on the demo row, so the row is kept instead of deleted.
 *
 * Ids are globally unique, so a field equalling an id can only be a genuine
 * reference — never a coincidence. Listing the fields broadly (rather than one
 * exact map per collection) means a new reference field fails safe: an
 * unrecognised field simply leaves the row undeleted, never orphaned.
 */
const REF_COLLECTIONS = [
  "carts",
  "wishlists",
  "addresses",
  "subcategories",
  "products",
  "slides",
  "promos",
  "productreviews",
  "coupons",
  "orders",
  "orderstatuslogs",
  "transactions",
  "messages",
  "activities",
  "vendorstores",
  "vendorapplications",
  "riderapplications",
  "vendorsubscriptions",
  "subscriptiontransactions",
  "vendororders",
  "featuredpromotions",
  "deliveries",
];

const REF_FIELDS = [
  "userId",
  "vendorId",
  "storeId",
  "riderId",
  "orderId",
  "productId",
  "categoryId",
  "subcategoryId",
  "promoId",
  "slideId",
  "couponId",
  "planId",
  "applicationId",
  "subscriptionId",
  "transactionId",
  "vendorOrderId",
  "deliveryId",
  "preferredRiderId",
  "productIds",
  "categoryIds",
  "subcategoryIds",
  "items.productId",
  "items.vendorId",
];

/** The first collection that points at `id`, or null when nothing does. */
async function findReference(id: string): Promise<string | null> {
  const values = idVariants(id);
  const filter = { $or: REF_FIELDS.map((field) => ({ [field]: { $in: values } })) };

  for (const coll of REF_COLLECTIONS) {
    try {
      const hit = await mongoose.connection
        .collection(coll)
        .findOne(filter, { projection: { _id: 1 } });
      if (hit) return coll;
    } catch {
      // A collection that does not exist yet is simply skipped.
    }
  }
  return null;
}

/**
 * Undo everything the demo admin did: delete what they added, put back what
 * they edited or deleted. Real admin changes are never in the log, so they stay.
 * Safe to run twice — the log is cleared as it is applied.
 *
 * A row the demo admin created is deleted only when nothing points at it. If a
 * real product, cart, order or any other row now depends on it, the row is kept
 * instead — removing it would leave that reference pointing at nothing. The
 * report names every collection that changed, so the nightly cron output shows
 * at a glance whether the demo screens really were reverted.
 */
export async function restoreDemoChanges() {
  const log = mongoose.connection.collection(UNDO_COLLECTION);
  const entries = await log.find().toArray();

  const restoredAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const restoredAtLocal = restoredAt.toISOString().replace("Z", "+06:00");

  const byCollection: Record<string, Counts> = {};
  const count = (coll: string, key: keyof Counts) => {
    byCollection[coll] = byCollection[coll] || { removed: 0, restored: 0, kept: 0 };
    byCollection[coll][key]++;
  };

  const totals: Counts = { removed: 0, restored: 0, kept: 0 };

  if (!entries || entries.length === 0) {
    return {
      restoredAt,
      restoredAtLocal,
      timezone: "UTC+6",
      removed: 0,
      restored: 0,
      kept: 0,
      entries: 0,
      byCollection,
    };
  }

  // 1) delete what the demo admin created (first, so unique slugs can't clash),
  //    except any row a real collection still references.
  for (const entry of entries.filter((e) => e.before === null)) {
    const rawId = entry.docId;
    const objectId = toObjectId(rawId);

    try {
      const holder = await findReference(String(rawId));
      if (holder) {
        // Something real depends on this row: keep it and say so.
        totals.kept++;
        count(entry.coll, "kept");
        console.log(
          `[demo] Kept a created ${entry.coll} row (${String(rawId)}) — still referenced by ${holder}`
        );
        continue;
      }

      await mongoose.connection
        .collection(entry.coll)
        .deleteOne({ _id: { $in: [rawId, objectId] } });
      totals.removed++;
      count(entry.coll, "removed");
    } catch (err) {
      // One bad row must not abandon the rest of the restore.
      console.error(`[demo] Could not delete created ${entry.coll} ${String(rawId)}:`, err);
    }
  }

  // 2) put back what the demo admin edited or deleted
  for (const entry of entries.filter((e) => e.before !== null)) {
    const rawId = entry.docId;
    const objectId = toObjectId(rawId);
    const targetId = entry.before._id ? toObjectId(entry.before._id) : objectId;

    try {
      await mongoose.connection
        .collection(entry.coll)
        .replaceOne({ _id: targetId }, entry.before, { upsert: true });
      totals.restored++;
      count(entry.coll, "restored");
    } catch (err) {
      // A slug clash or a malformed row is logged and skipped; the rest still run.
      console.error(`[demo] Could not restore ${entry.coll} ${String(rawId)}:`, err);
    }
  }

  await log.deleteMany({ _id: { $in: entries.map((e) => e._id) } });

  // A one-line summary is easier to read in a cron log than a nested object.
  const summary = Object.entries(byCollection)
    .map(([coll, value]) => `${coll} -${value.removed}/+${value.restored}~${value.kept}`)
    .join(", ");
  console.log(`[demo] Restored ${entries.length} change(s): ${summary || "nothing to restore"}`);

  return {
    restoredAt,
    restoredAtLocal,
    timezone: "UTC+6",
    ...totals,
    entries: entries.length,
    byCollection,
  };
}
