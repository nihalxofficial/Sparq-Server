import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/apiError";
import { isAdminRole } from "../../utils/roles";
import { requireAuth } from "../../middlewares/auth.middleware";

/**
 * Access control for stored application documents.
 *
 * A licence scan is somebody's identity, so the file is not readable by anyone
 * who merely guesses the id. Reading needs either a signed link — the `sig` the
 * upload response puts on the URL, an HMAC the caller cannot forge — or a
 * store-team token, so a colleague can still open one from the review desk.
 *
 * The key is `FILE_URL_SECRET`, falling back to `INTERNAL_API_KEY` because the
 * app already holds that one for uploads.
 */
function secret(): string {
  return process.env.FILE_URL_SECRET || process.env.INTERNAL_API_KEY || "";
}

/** The signature that belongs on a file's URL. Empty when no key is set. */
export function fileSignature(id: string): string {
  const key = secret();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(String(id)).digest("hex").slice(0, 40);
}

function isValidSignature(id: string, sig: unknown): boolean {
  const expected = fileSignature(id);
  if (!expected || typeof sig !== "string" || sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

const ID_PATTERN = /^[a-f\d]{24}$/i;

export function requireFileAccess(req: Request, res: Response, next: NextFunction) {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!ID_PATTERN.test(id)) return next(new ApiError(404, "That file is not here."));

  if (isValidSignature(id, req.query.sig)) return next();

  // No valid link: allow the store team through with a bearer token. Anyone
  // else gets the same 403 whether the id exists or not.
  return requireAuth(req, res, (err?: any) => {
    if (err) return next(new ApiError(403, "A valid document link is required."));
    if (isAdminRole(req.user?.role)) return next();
    return next(new ApiError(403, "A valid document link is required."));
  });
}
