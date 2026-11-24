import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { requireAuth } from "./auth.middleware";

/**
 * Vercel Cron calls a route with `Authorization: Bearer <CRON_SECRET>`. The
 * `x-vercel-cron` header it also sends is spoofable, so it is never trusted on
 * its own: without a configured secret every scheduled HTTP route stays closed.
 * The in-process jobs in `index.ts` call the services directly and are not
 * affected by this gate.
 */
function isCronInvocation(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== secret.length) return false;

  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

/**
 * Lets a scheduled job through, or a signed-in store admin calling the same
 * route by hand. Used by the demo restore job and the delivery sweep, both of
 * which need to run on a host without a long-lived process.
 */
export function requireCronOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (isCronInvocation(req)) return next();

  return requireAuth(req, res, (err?: any) => {
    if (err) {
      return next(
        new ApiError(401, "Unauthorized: Valid CRON_SECRET, Vercel Cron, or Admin token required")
      );
    }
    const role = (req.user?.role || "").toLowerCase();
    if (role === "admin") {
      return next();
    }
    return next(new ApiError(403, "Forbidden: Store Admin privileges required"));
  });
}
