<div align="center">

# ⚡ Sparq Server

**REST API for the Sparq marketplace**

Express 5 + MongoDB backend powering a multi-vendor store with loyalty points, rider delivery, discount codes, paid placements, and a CMS.

[![Backend](https://img.shields.io/badge/Backend-Express_5-green?style=flat-square&logo=express)](https://github.com/demoprojectbdsoft/Sparq-Server)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js-black?style=flat-square&logo=next.js)](https://github.com/demoprojectbdsoft/Sparq-Electronics-Store)

</div>

---

## 📖 Table of Contents

1. [What This Server Does](#what-this-server-does)
2. [Architecture](#architecture)
3. [Access & Security](#access--security)
4. [Business Logic](#business-logic)
5. [Scheduled Jobs](#scheduled-jobs)
6. [Demo Admin Mode](#demo-admin-mode)
7. [Tech Stack](#tech-stack)
8. [Quick Start](#quick-start)
9. [Environment Setup](#environment-setup)
10. [Deployment](#deployment)
11. [Development](#development)
12. [Support & Links](#support--links)

---

## What This Server Does

The backend API for [Sparq](https://github.com/demoprojectbdsoft/Sparq-Electronics-Store). It owns **all business logic and data**; the Next.js frontend owns authentication.

**What this API owns**

- **Business rules** — all prices, discounts and totals computed server-side.
- **Authorization** — session/JWT verification, role guards, ownership checks.
- **Data integrity** — transactional operations (orders, points, stock).
- **Scheduled jobs** — one daily sweep for restores, expiries, rates and timeouts.
- **Email** — SMTP messages for orders, reviews, applications and resets.
- **Document storage** — applicant uploads, kept behind a signed link.

**What this API does not own**

- **Authentication** — sign-up/login is handled by better-auth (frontend).
- **JWT generation** — tokens are created by the frontend and only verified here.
- **Session storage** — sessions are stored by the frontend in the shared MongoDB.

**Request flow**

```
Request -> verify JWT -> check role -> validate (Zod) -> controller -> service -> database
              |              |              |
             401            403            400
```

---

## Architecture

**Layered design.** Every module follows the same five files:

| File | Responsibility |
|------|----------------|
| `route.ts` | Maps URL to controller; attaches auth / role / validation. |
| `validator.ts` | Zod schema — rejects bad input early. |
| `controller.ts` | Reads the request, calls the service, sends the response. |
| `service.ts` | Business logic and database operations. |
| `model.ts` | Mongoose schema, enums, defaults and indexes. |

A module adds a sixth file when one would grow unreviewable (e.g. `vendor-order.create.ts` beside `vendor-order.service.ts`). The dependency direction is deliberate: the listing service imports the order service, so the order module never imports the listing service back.

**Middleware pipeline**

```
Request
   |- CORS                allow only the storefront's origins
   |- body parsing        JSON; the file route accepts 12 MB
   |- requireAuth?        verify token -> 401 if bad, expired or suspended
   |- requireRole?        check approved roles -> 403 if missing
   |- validate?           Zod schema -> 400 on bad data
   +- Controller -> Service -> Database -> Response
```

**Modules.** 38 route modules grouped by domain: identity (user, address, file, mail, activity), catalogue (category, subcategory, product, product-engagement, review), shopping (cart, wishlist, order, order-status, transaction, coupon), delivery (delivery, rider), the vendor family (application, store, product, order, plan, subscription, coupon, promotion, analytics, desk, admin), marketing and platform (banner, promo, promotion, contact, message, site-settings, currency, demo) and cron (the daily sweep).

For the full route-by-route reference, see the HTML documentation in `/documentation`.

---

## Access & Security

**Access levels.** Every protected request needs a bearer token; ownership is still checked inside the service.

| Level | Who |
|-------|-----|
| **Public** | No token — reads only what a shopper may see. |
| **Bearer** | A valid token; the service scopes reads to the caller. |
| **Admin** | Approved roles include `admin` (or the demo admin). |
| **Rider / Vendor** | That role is approved and not suspended. |
| **Cron** | `Authorization: Bearer <CRON_SECRET>`. |
| **Internal** | `INTERNAL_API_KEY`, called only by the storefront. |

- **Verifying the caller** — a JWT is verified against the storefront's JWKS endpoint; if that fails the token is looked up as a session. An expired session, a suspended account and a missing user all end the same way: refused before any handler runs.
- **Roles and ownership** — `requireRole` reads the approved `roles` array (never the claimed active role), and each service scopes reads to the caller.
- **Prices are never trusted** — a request names products and quantities only; every figure is recomputed from the database.

Concrete guarantees are under [Security Notes](#security-notes).

---

## Business Logic

### Multi-Role Accounts

One account can hold several roles at once:

```
roles: ["customer", "vendor", "rider"]    <- approved
activeRole: "vendor"                      <- which dashboard opens
roleSuspensions: [{ role: "rider", ... }] <- temporarily blocked
```

- Admin authority never shares — granting admin drops other roles.
- Customer is kept on every non-admin account.
- The active role switches among approved, unsuspended roles.
- A suspended role stays approved but cannot be activated.

### Order Lifecycle

Placing an order is one transaction:

1. Load products, check stock (only live listings are orderable).
2. Price the coupon from the database.
3. Redeem points atomically (`findOneAndUpdate` with a `$gte` check).
4. Recompute totals server-side.
5. Create the order and the payment row.
6. Decrement stock with a guard — it can never oversell.
7. Split into vendor groups and clear the cart.

All of the above land together or not at all.

```
confirmed -> processing -> shipped -> delivered
    +-----------+------------+--------> cancelled
```

- **On delivery** — settle the payment, credit points and re-check the tier, update sell counts.
- **On cancellation** — fail an unpaid payment / refund a paid one, restore stock once, refund spent points, revoke earned points, hand the coupon's use back.

### Multi-Vendor Order Splitting

One customer order becomes one parent order plus one group per seller:

```
Cart -> Order (parent)
          |- VendorOrder (Seller A items)
          |- VendorOrder (Seller B items)
          +- platform items (no group)
```

- Seller flow: `pending -> accepted -> processing -> ready_for_shipment`, or `rejected` with a reason.
- Parent `shipped` / `delivered` / `cancelled` is pushed down to every group, with a guard list so a rejected or delivered group is never overwritten.
- A seller's own coupon comes off their group; an admin coupon leaves every group whole.

### Loyalty Points

- **Earn** — 1 point per currency unit spent, rounded down, credited on delivery.
- **Redeem** — 100 points = 1 unit of discount, capped at the product total (shipping is always paid).
- **Atomic** — a guarded decrement prevents double-spending in concurrent checkouts.
- **Tiers** — recalculated on every change: Silver under 1,000 · Gold under 4,000 · Platinum under 10,000 · Diamond 10,000+.

### Discount Coupons

**Two owners, one engine:**

| | Admin coupon | Vendor coupon |
|---|---|---|
| Scope | Any product or category | Only the shop's products |
| Created by | Admins | Vendors (plan-limited) |
| Discount borne by | The store | The seller |

Both support percentage or fixed amounts, optional product/category scope, a minimum order, a maximum discount, total and per-customer limits, and a date range.

**Cancelling an order gives the use back.** `releaseCouponForOrder` stamps the redemption `reversedAt` and decrements the counters; reversed rows are ignored everywhere, so a single-use code works again. It is idempotent, so a repeated cancel cannot refund twice. A seller-group rejection does **not** release it — only a real order cancellation does.

### Featured Promotions

- **Product** places one listing; **store** places a whole shop (admin grant).
- Only this module writes the `isFeatured` flags.
- A vendor buys slots within plan limits; an admin grants 1-365 days.
- State is derived from `endsAt`, so a placement never outlives its window.
- Unpublishing a product, or a lapsed subscription, ends the placements.

### Warranty (vocabulary only)

A product may carry one warranty code — `manufacturer-warranty`, `seller-warranty`, `extended-warranty`, `other` or `none` — plus a period and a terms line. There is **no claim, extension or expiry workflow**; `src/modules/warranty/` holds only the shared type list.

### Notifications

- **Store team** — a feed line and an email for a new order, every status change, a review, an application, a plan/payment, a product submitted for review, and delivery problems.
- **Seller** — a feed line and an email for their own orders, status changes, reviews and plan events.
- Store-team email goes to the **general inbox** (`contactEmail`, or `CONTACT_INBOX`, falling back to `supportEmail`).
- Every notification is **best-effort**: a mail or feed problem never fails the order, review or payment that caused it.
- Each account can switch the bell and the email off independently.

### Security

- **Tokens** — verified via JWKS or a session lookup; only a bearer header counts.
- **Roles** — checked against the approved array, never the client's claim.
- **Ownership** — each service scopes reads to the caller before answering.
- **Prices** — recomputed from the database, never taken from the request.
- **Races** — stock and coupon writes carry their own guards.
- **Documents** — read only through a signed link or a staff token.
- **Scheduled routes** — require the bearer `CRON_SECRET`.

---

## Scheduled Jobs

Vercel's **Hobby plan only allows daily cron jobs**, so `vercel.json` declares **one**: `GET /api/cron/daily`. That single job runs every sweep in order, each isolated so one failure never skips the rest:

1. vendor subscriptions (close lapsed periods)
2. featured promotions (end lapsed placements)
3. product offers (revert lapsed prices)
4. seller timeout (reject groups unanswered for 24 hours)
5. deliveries (close unanswered offers)
6. currency (pull the day's rates)
7. demo restore (undo the demo admin's writes)

The individual routes stay mounted — `/api/products/expire`, `/api/deliveries/expire`, `/api/vendor-subscription/expire`, `/api/promotions/expire`, `/api/vendor-orders/expire`, `/api/currency/refresh`, `/api/demo/restore` — so a Pro plan or an external scheduler can call any one on its own.

Every scheduled route requires `Authorization: Bearer <CRON_SECRET>`; the `x-vercel-cron` header alone is never trusted. A long-running host (not Vercel) runs the same sweeps with `node-cron` in-process, armed only when `VERCEL` is unset, so they never run twice.

---

## Demo Admin Mode

A demo admin (`DEMO_ADMIN_EMAIL`, default `demoadmin@gmail.com`) has the same access as a real admin, but **every write it makes is recorded** in a `demo_undo` log and reverted by the daily sweep. Only the demo admin's writes are logged; a real admin's changes are never touched.

**What the restore does**

1. **Created rows** are deleted — **unless something real still references them**. A row real data points at is kept and reported as `kept`, so a reference is never left dangling.
2. **Edited or deleted rows** are put back from the snapshot.

The reference check scans the app's collections for any field equal to the row's id; an unknown reference field fails safe (keep, do not delete). Each run reports `removed`, `restored` and `kept` per collection.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20+ |
| **Framework** | Express 5.2 |
| **Language** | TypeScript (CommonJS) |
| **Database** | MongoDB 7 + Mongoose 9 |
| **Validation** | Zod 4 |
| **Auth** | jose-cjs (JWKS) |
| **Email** | Nodemailer (SMTP) |
| **Jobs** | node-cron + Vercel Cron |
| **Hosting** | Vercel Serverless |

---

## Quick Start

**1. Clone & install**

```bash
git clone https://github.com/demoprojectbdsoft/Sparq-Server.git
cd Sparq-Server
npm install
```

**2. Configure `.env`** (see [Environment Setup](#environment-setup)) — at minimum `MONGODB_URI`, `DATABASE`, `PORT`, `NEXT_PUBLIC_CLIENT_URL`, `INTERNAL_API_KEY` and `CRON_SECRET`. Add the SMTP keys to enable email.

**3. Start**

```bash
npm run dev      # development (port 5000)
npm run build    # production build
npm start        # production server
```

The storefront runs separately on port 3000; see its README.

---

## Environment Setup

**Required**

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `DATABASE` | Database name |
| `PORT` | Server port (5000) |
| `NEXT_PUBLIC_CLIENT_URL` | Frontend URL (for JWKS and CORS) |
| `INTERNAL_API_KEY` | Shared secret with the frontend |
| `CRON_SECRET` | Bearer secret for the scheduled routes |

**Email**

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` / `SMTP_PORT` | SMTP server and port |
| `SMTP_SECURE` | Use SSL (`false` for TLS) |
| `SMTP_USER` / `SMTP_PASS` | Account and app password |
| `MAIL_FROM` | From address |

**Optional**

| Variable | Default |
|----------|---------|
| `DEMO_ADMIN_EMAIL` | Demo admin email |
| `CRON_TIMEZONE` | UTC |
| `CORS_ORIGINS` | Browser origins allowed by CORS (falls back to `NEXT_PUBLIC_CLIENT_URL`) |
| `FILE_URL_SECRET` | HMAC key for signed document links (falls back to `INTERNAL_API_KEY`) |

---

## Deployment

**Vercel**

1. Push to GitHub, then import to Vercel.
2. Build `npm run build`, output `dist`, install `npm install`.
3. Add the environment variables.
4. Deploy.

**Cron.** `vercel.json` declares one daily job, `/api/cron/daily`, which runs every sweep. `CRON_SECRET` must be set or the job is refused. On a Pro plan you can add the individual `/expire` routes back with finer schedules.

**Production checklist**

- [ ] Strong `CRON_SECRET` and `INTERNAL_API_KEY`
- [ ] MongoDB Atlas IP allowlist
- [ ] Production SMTP
- [ ] `NEXT_PUBLIC_CLIENT_URL` -> production storefront
- [ ] `CORS_ORIGINS` -> production origin(s)
- [ ] Run `/api/cron/daily` once and check the report
- [ ] Verify email delivery
- [ ] `NODE_ENV=production`
- [ ] Add an edge rate limit in front of `POST /api/coupons/validate` and `POST /api/orders`

### Security Notes

- Suspended accounts are refused at the API; a session past its `expiresAt` no longer authenticates.
- Suspending an account cascades: the seller's shop is set to `suspended` (listings drop off, the product page 404s, checkout refuses its lines), the dashboards are parked, and the rider goes offline. Reactivating releases only what the suspension parked.
- Scheduled routes require `CRON_SECRET`; the `x-vercel-cron` header is not trusted on its own.
- The delivery fee is re-derived on the server — a request cannot post `shippingMethod: "free"` to escape the charge.
- Coupon usage and per-customer limits are re-checked at the moment of the write, and a stock decrement carries its own guard.
- Application documents are read only through the signed link the upload returns, or a store-team token.
- Account deletion removes the account's own rows and its sessions; orders, payments and a seller's products are kept as records.
- The site-settings patch is validated and unknown keys are dropped.

### Payments (demo)

This build has **no payment gateway** — online payment is simulated.

- Every non-COD payment is stored with `isDemo: true` and marked `success` at checkout; cash on delivery starts `pending` and settles at the door.
- A wallet transaction id cannot be reused.
- Statuses are `pending`, `success`, `failed` and `refunded`; cancelling fails an unpaid payment and marks a paid one as `refunded`.

---

## Development

**Adding a module**

1. Create `src/modules/feature/`.
2. Add `feature.model.ts`, `.service.ts`, `.controller.ts`, `.validator.ts`, `.route.ts` (and `.types.ts` if needed).
3. Mount it in `app.ts`:

```typescript
import featureRoutes from "./modules/feature/feature.route";
app.use("/api/features", featureRoutes);
```

**Scripts**

```bash
npm run dev              # development (watch mode)
npm run build            # TypeScript compilation
npm start                # production server
npm run dedupe:reviews   # cleanup script
```

---

## Support & Links

- **Frontend**: [Sparq README](https://github.com/demoprojectbdsoft/Sparq-Electronics-Store)
- **Issues**: [GitHub Issues](https://github.com/demoprojectbdsoft/Sparq-Server/issues)

---

## License

MIT License - See [LICENSE](LICENSE)

---

<div align="center">

**Built with ❤️ by [BD Soft](https://github.com/demoprojectbdsoft)**

⚡ Sparq Server - Powering modern e-commerce

</div>
