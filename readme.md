<div align="center">

# ⚡ Sparq Server

**REST API for E-Commerce Platform**

Express 5 + MongoDB backend powering a multi-vendor marketplace with loyalty points, rider delivery and GPS tracking, discount codes, paid placements, and a CMS

[![API Status](https://img.shields.io/badge/API-Running-success?style=flat-square)](https://sparq-api.vercel.app)
[![Backend](https://img.shields.io/badge/Backend-Express_5-green?style=flat-square&logo=express)](https://github.com/demoprojectbdsoft/Sparq-Server)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js-black?style=flat-square&logo=next.js)](https://github.com/demoprojectbdsoft/Sparq-Electronics-Store)

</div>

---

## 📖 Table of Contents

1. [What This Server Does](#what-this-server-does)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
4. [Business Logic](#business-logic)
5. [Implementation Status](#implementation-status)
6. [Demo Admin Mode](#demo-admin-mode)
7. [Tech Stack](#tech-stack)
8. [Quick Start](#quick-start)
9. [Project Structure](#project-structure)
10. [Environment Setup](#environment-setup)
11. [Deployment](#deployment)
12. [Development](#development)

---

## What This Server Does

This is the backend API for [Sparq](https://github.com/demoprojectbdsoft/Sparq-Electronics-Store). It handles **all business logic and data**, while the Next.js frontend owns authentication.

### What This API Owns

```
✅ Business Rules         All prices, discounts, totals computed server-side
✅ Authorization          Session/JWT verification, role guards, ownership checks
✅ Data Integrity         Transactional operations (orders, points, stock)
✅ Scheduled Jobs         Demo restore, delivery offers, vendor periods, placements, daily rates
✅ Email Delivery         SMTP emails for orders and password resets
✅ Document Storage       Applicant uploads, kept behind a signed link
```

### What This API Does NOT Own

```
❌ Authentication         Sign-up/login handled by better-auth (frontend)
❌ JWT Generation         Tokens created by frontend, only verified here
❌ Session Storage        Sessions stored by frontend in MongoDB
```

### Request Flow

```
Client Request → JWT Verification → Role Check → Validation → Controller → Service → Database
                      ↓                  ↓            ↓
                    401 (invalid)    403 (denied)  400 (bad data)
```

---

## Architecture

### Layered Design

Every module follows the same 5-layer pattern:

```
route.ts         Maps URL to controller, attaches auth/role middleware
    ↓
validator.ts     Zod schema validates request (rejects bad input early)
    ↓
controller.ts    Reads request, calls service, sends response
    ↓
service.ts       Business logic + database operations
    ↓
model.ts         Mongoose schema (data structure)
```

### Module Organization

```
modules/
├── product/
│   ├── product.model.ts         Mongoose schema
│   ├── product.service.ts       Business logic
│   ├── product.controller.ts    HTTP handlers
│   ├── product.validator.ts     Zod validation
│   ├── product.route.ts         Express routes
│   └── product.types.ts         TypeScript types
│
├── order/                       Order processing
├── user/                        User management
├── vendor/                      Multi-vendor marketplace
├── delivery/                    Riders, jobs, GPS tracking
├── coupon/                      Discount codes
└── ...                          the remaining modules
```

### Middleware Pipeline

```
Request
   │
   ├─ requireAuth?          Verifies JWT via JWKS
   │  ├─ Valid    → Continue
   │  └─ Invalid  → 401
   │
   ├─ requireRole?          Checks user has required role
   │  ├─ Has role → Continue
   │  └─ No role  → 403
   │
   ├─ validate?             Zod schema validation
   │  ├─ Valid    → Continue
   │  └─ Invalid  → 400
   │
   └─ Controller → Service → Database → Response
```

---

## API Reference

**Base URL**: `/api`  
**Response Format**: `{ success: boolean, message: string, data?: any }`

### Access Levels

- 🌐 **Public** - No auth required
- 🔐 **Bearer** - Valid JWT token required
- 👑 **Admin** - Admin or demo admin role required
- ⏰ **Cron** - Bearer `CRON_SECRET` required (the `x-vercel-cron` header alone is not trusted)
- 🔑 **Internal** - INTERNAL_API_KEY required (frontend only)

---

### Core Endpoints

#### Health Check

```
GET  /api               🌐  Server status
GET  /                  🌐  Root health check
```

#### Categories, Subcategories & Products

```
GET    /api/categories                 🌐  List categories
POST   /api/categories                 👑  Create category
PATCH  /api/categories/:id             👑  Update category
DELETE /api/categories/:id             👑  Delete category

GET    /api/subcategories              🌐  List subcategories
POST   /api/subcategories              👑  Create subcategory
PATCH  /api/subcategories/:id          👑  Update subcategory
DELETE /api/subcategories/:id          👑  Delete subcategory

GET    /api/products                   🌐  Search & filter products
GET    /api/products/:slug             🌐  Get one product
POST   /api/products                   👑  Create product
PATCH  /api/products/:id               👑  Update product
PATCH  /api/products/:id/review        👑  Approve or reject a seller listing
PATCH  /api/products/:id/archive       👑  Archive product
PATCH  /api/products/:id/unarchive     👑  Restore archived product
DELETE /api/products/:id               👑  Delete product
GET    /api/products/expire            ⏰  Turn lapsed offers back to full price

GET    /api/engagement/products        👑  Views & favourites report
POST   /api/engagement/products/:id    🌐  Track a product view
```

**Product query params:** `search`, `category`/`categoryId`,
`subCategory`/`subCategoryId`, `storeSlug`/`storeId`, `minPrice`, `maxPrice`,
`minDiscount`, `maxDiscount`, `discount` (`0-20` band), `isFeatured`, `inStock`,
`hasOffer`, `minRating`, `vendorStatus` (admin desk only), `mode=admin`,
`page`, `limit`.

**Search** matches title, description and SKU.
**Sort keys:** `newest`, `oldest`, `price_asc`, `price_desc`, `rating`,
`sellCount`, `featured`.

#### Shopping Cart & Wishlist

```
GET    /api/cart                    🔐  Get user's cart
GET    /api/cart/is-carted          🔐  Check if product in cart
POST   /api/cart                    🔐  Add to cart
PATCH  /api/cart/:productId         🔐  Update quantity
DELETE /api/cart                    🔐  Clear cart
DELETE /api/cart/:productId         🔐  Remove item

GET    /api/wishlist                🔐  Get user's wishlist
GET    /api/wishlist/is-wishlisted  🔐  Check if wishlisted
POST   /api/wishlist                🔐  Add to wishlist
DELETE /api/wishlist/:productId     🔐  Remove from wishlist
```

#### Orders & Checkout

```
GET    /api/orders                  🔐  List orders (customer: own, admin: all)
GET    /api/orders/:id              🔐  Get order details
POST   /api/orders                  🔐  Place new order
PATCH  /api/orders/:id/status       👑  Update order status
PATCH  /api/orders/:id/customer-response  🔐  Report delivery outcome

GET    /api/order-status            🔐  Get order status history
GET    /api/transactions            🔐  List payment records
```

**Place Order Body:**
```json
{
  "items": [{ "productId": "...", "quantity": 2 }],
  "shippingAddress": {
    "fullName": "John Doe",
    "phone": "+8801712345678",
    "address": "123 Main St",
    "city": "Dhaka",
    "postalCode": "1000"
  },
  "paymentMethod": "cod",
  "transactionId": "TXN123",
  "pointsToRedeem": 100,
  "couponCode": "SAVE10",
  "shippingMethod": "standard"
}
```

`paymentMethod` is `cod | bkash | rocket | nagad`; `transactionId` is required for
anything except cash on delivery. `shippingMethod` is `free | standard | express`,
and a `free` request is re-checked on the server against the live free-shipping
threshold rather than trusted.

#### Reviews

```
GET    /api/reviews                 🌐  List reviews (filterable)
GET    /api/reviews/vendor          Vendor  Reviews on the seller's own listings
POST   /api/reviews                 🔐  Create review (needs a delivered order)
PATCH  /api/reviews/:id             🔐  Edit own review
DELETE /api/reviews/:id             🔐  Delete (reviewer, product seller or admin)
```

#### Warranties

Warranty is **product vocabulary only** in this build — there is no claim
workflow or warranty API yet. A product carries `warrantyType`
(`manufacturer-warranty`, `seller-warranty`, `extended-warranty`, `other`,
`none`), `warrantyPeriodMonths` and `warrantyTerms`, and the product page renders
them. The same list is mirrored in the storefront at `sparq/src/lib/warranty.ts`.

#### Users & Addresses

```
GET    /api/users                   👑  List all users
GET    /api/users/me/roles          🔐  Get own roles
GET    /api/users/me/export         🔐  Export own data (JSON)
PATCH  /api/users/me/active-role    🔐  Switch active role
GET    /api/users/:id               🔐  Get user (owner or admin)
PATCH  /api/users/:id               🔐  Update user
POST   /api/users/:id/roles         👑  Set user's roles
PATCH  /api/users/:id/roles/revoke  👑  Revoke one role
PATCH  /api/users/:id/roles/suspension  👑  Suspend/unsuspend role
DELETE /api/users/:id               👑  Delete user

GET    /api/addresses               🔐  List saved addresses
POST   /api/addresses               🔐  Add address
PATCH  /api/addresses/:id           🔐  Update address
PATCH  /api/addresses/:id/default   🔐  Set as default
DELETE /api/addresses/:id           🔐  Delete address
```

#### Coupons (Store-Wide)

```
GET    /api/coupons                 👑  List all coupons
GET    /api/coupons/:id             👑  Get coupon details
POST   /api/coupons                 👑  Create store coupon
PATCH  /api/coupons/:id             👑  Update store coupon
DELETE /api/coupons/:id             👑  Delete store coupon
POST   /api/coupons/validate        🔐  Validate coupon code
```

#### Featured Promotions (Admin)

```
GET    /api/promotions              👑  List featured placements
POST   /api/promotions              👑  Grant featured placement
DELETE /api/promotions/:id          👑  End placement early
GET    /api/promotions/expire       ⏰  Daily cleanup job
```

#### Vendor Marketplace

```
# Applications
POST   /api/vendor-applications              🔐  Submit application
GET    /api/vendor-applications/mine         🔐  Get own applications
POST   /api/vendor-applications/mine/cancel  🔐  Withdraw application
GET    /api/vendor-applications              👑  List all (admin)
PATCH  /api/vendor-applications/:id/review   👑  Approve/reject

# Stores
GET    /api/vendor-store/public              🌐  List trading stores
GET    /api/vendor-store/public/:slug        🌐  Get store by slug
GET    /api/vendor-store                     👑  List all (admin)
GET    /api/vendor-store/mine                Vendor  Get own store
PATCH  /api/vendor-store/mine                Vendor  Update own store

# Vendor Products
GET    /api/vendor-products                  Vendor  List own products
POST   /api/vendor-products                  Vendor  Create product
PATCH  /api/vendor-products/:id              Vendor  Update product
DELETE /api/vendor-products/:id              Vendor  Archive product

# Vendor Orders
GET    /api/vendor-orders                    Vendor  List fulfillment groups
GET    /api/vendor-orders/summary            Vendor  Order counts
PATCH  /api/vendor-orders/:id/status         Vendor  Update status

# Vendor Subscription
GET    /api/vendor-subscription/mine         Vendor  Get subscription
POST   /api/vendor-subscription/checkout     Vendor  Subscribe to plan
POST   /api/vendor-subscription/cancel-renewal  Vendor  Turn off auto-renew
GET    /api/vendor-subscription/expire       ⏰  Daily cleanup

# Vendor Coupons
GET    /api/vendor-coupons                   Vendor  List own coupons
POST   /api/vendor-coupons                   Vendor  Create coupon
PATCH  /api/vendor-coupons/:id               Vendor  Update coupon
DELETE /api/vendor-coupons/:id               Vendor  Delete coupon

# Vendor Promotions
GET    /api/vendor-promotions                Vendor  List own placements
POST   /api/vendor-promotions                Vendor  Buy featured slot
DELETE /api/vendor-promotions/:id            Vendor  End placement early

# Vendor Analytics
GET    /api/vendor-analytics?range=7|30|90|365  Vendor  Sales report
```

#### Delivery & Riders

```
# Store team
GET    /api/deliveries/admin/order/:orderId  👑  Jobs for one order
GET    /api/deliveries/admin/overview        👑  Delivery board summary
GET    /api/deliveries/admin/riders          👑  Riders available to assign
GET    /api/deliveries/admin/payouts         👑  What each rider was paid
GET    /api/deliveries/admin                 👑  All deliveries
POST   /api/deliveries                       👑  Offer an order to a rider
PATCH  /api/deliveries/:id/reassign          👑  Hand a job to another rider
PATCH  /api/deliveries/:id/cancel            👑  Stop a job
GET    /api/deliveries/expire                ⏰  Close offers nobody answered

# Customer tracking
GET    /api/deliveries/tracking/:orderId       🔐  Live tracking + ETA
GET    /api/deliveries/tracking/:orderId/code  🔐  Read the door code
POST   /api/deliveries/tracking/:orderId/code  🔐  Regenerate the door code

# Rider (role: rider)
GET    /api/deliveries              Rider  Own jobs
GET    /api/deliveries/stats        Rider  Own figures
GET    /api/deliveries/:id          Rider  One job and the order behind it
GET    /api/deliveries/:id/invoice  Rider  Invoice for one job
POST   /api/deliveries/:id/accept   Rider  Accept an offer
POST   /api/deliveries/:id/decline  Rider  Decline an offer with a reason
PATCH  /api/deliveries/:id/status   Rider  picked_up → out_for_delivery
POST   /api/deliveries/:id/complete Rider  Close the job with the door code
POST   /api/deliveries/:id/location Rider  Share one position ping
```

#### Rider Applications

```
POST   /api/rider-applications             🔐  Submit or resubmit application
GET    /api/rider-applications/mine        🔐  Own application
PATCH  /api/rider-applications/mine        🔐  Update own file
POST   /api/rider-applications/mine/cancel 🔐  Withdraw application
GET    /api/rider-applications             👑  List all (admin)
GET    /api/rider-applications/:id         👑  One application
PATCH  /api/rider-applications/:id/review  👑  Approve or reject
POST   /api/rider-applications/status      🔑  Status lookup after login
```

#### Vendor Plans, Desk & Board

```
GET    /api/vendor-plans           🌐  Price list
POST   /api/vendor-plans           👑  Create plan
PATCH  /api/vendor-plans/:planId   👑  Update plan
DELETE /api/vendor-plans/:planId   👑  Remove plan

GET    /api/vendor-desk            👑  Seller money board
GET    /api/vendor-admin           👑  Seller board (every shop)
GET    /api/vendor-admin/:id       👑  One seller's board
GET    /api/transactions/vendor    Vendor  Own payment rows
```

#### Slides & Promos

```
GET    /api/slides      🌐  List hero slides
POST   /api/slides      👑  Create slide
PATCH  /api/slides/:id  👑  Update slide
DELETE /api/slides/:id  👑  Delete slide

GET    /api/promos      🌐  List promo banners
POST   /api/promos      👑  Create promo
PATCH  /api/promos/:id  👑  Update promo
DELETE /api/promos/:id  👑  Delete promo
```

#### Files

```
POST   /api/files            🔑  Upload a document (frontend only)
GET    /api/files/:id/:name  🔐  Read one (signed link, or a staff token)
GET    /api/files/:id        🔐  Same, without the filename
```

#### Currency

```
GET    /api/currency/refresh  ⏰  Pull the day's exchange rates (cron or admin)
```

The shop prices in one currency. The daily job pulls the day's rates from a free
provider and stores them on the site settings; the storefront uses them only to
**convert a price for display** (see the storefront README). A failed fetch is
never written, so the last good table stays until the next run.

#### Site Settings & Support

```
GET    /api/site-settings           🌐  Get store configuration
PATCH  /api/site-settings           👑  Update settings

POST   /api/contact                 🌐  Submit contact form
GET    /api/messages                👑  List contact messages
POST   /api/messages/:id/reply      👑  Reply to message
DELETE /api/messages/:id            👑  Delete message

GET    /api/activities/mine         🔐  Get notifications
GET    /api/activities/mine/unread-count  🔐  Unread count
PATCH  /api/activities/mine/read-all  🔐  Mark all read
PATCH  /api/activities/mine/:id/read  🔐  Mark one read

POST   /api/mail/reset-password     🔑  Send password reset email

GET    /api/demo/restore            ⏰  Restore demo changes
```

---

## Business Logic

### Multi-Role Accounts

One user can hold multiple roles simultaneously:

```
User Account
  ├─ roles: ["customer", "vendor", "rider"]  ← Approved roles
  ├─ activeRole: "vendor"                    ← Current dashboard
  └─ roleSuspensions: [                      ← Temporarily blocked
       { role: "rider", reason: "...", suspendedAt: "..." }
     ]
```

**Rules:**
- Admin authority never shares (granting admin drops other roles)
- Customer role always included (except for admins)
- Active role switches among approved, unsuspended roles
- Suspended roles block dashboard but remain approved

### Order Lifecycle

```
Place Order (Atomic Transaction)
  1. Load products and check stock (only live listings are orderable)
  2. Price the coupon from the database
  3. Redeem points (atomic: findOneAndUpdate with $gte check)
  4. Calculate totals (server-side, never trust client)
  5. Create order + payment row
  6. Decrement stock (guarded: $gte, so it never oversells)
  7. Split into vendor groups, clear the cart
     — all of the above land together or not at all

Status Flow:
  confirmed → processing → shipped → delivered
      ↓           ↓          ↓
      └───────────┴──────────┴────► cancelled

On Delivery:
  • Mark the payment successful (cash on delivery settles here)
  • Credit loyalty points and re-check the tier
  • Update sell counts

On Cancellation:
  • Fail a payment that never landed; refund one that had gone through
  • Restore stock (a seller's rejected slice is not given back twice)
  • Refund points spent; revoke points earned (if it was delivered)
  • Hand the coupon's use back to the code
```

### Multi-Vendor Order Splitting

When customer orders from multiple vendors:

```
Customer Cart → One Order (parent)
                    ├─ VendorOrder (Vendor A items)
                    ├─ VendorOrder (Vendor B items)
                    └─ Platform items (no vendor group)

Vendor Workflow:
  pending → accepted → processing → ready_for_shipment → (parent ships it)
     ↓
  rejected (with reason)

Parent Status Sync:
  Parent "shipped" → All vendor groups become "shipped"
  Parent "delivered" → All vendor groups become "delivered"
  Parent "cancelled" → All vendor groups become "cancelled"
```

### Loyalty Points

```
EARNING:    floor($147.50) = 147 points on delivery
            (1 point per $1 spent, rounded down)

REDEMPTION: 100 points = $1 discount
            Minimum: 100 points
            Maximum: Product total only (shipping always paid)

ATOMIC:     findOneAndUpdate({ points: { $gte: n } }, { $inc: { points: -n } })
            (prevents double-spending in concurrent checkouts)

TIERS:      Recalculated on every balance change
            Silver < 1,000 | Gold 1,000 | Platinum 4,000 | Diamond 10,000
```

### Warranty (vocabulary only)

A product can be sold with one of five warranty codes:

```
manufacturer-warranty | seller-warranty | extended-warranty | other | none
```

The code, the period in months and a free-text terms line live on the product and
are shown on the product page. There is **no claim, extension or expiry workflow
in this build** — `src/modules/warranty/` holds only the shared type list, which
the storefront mirrors in `sparq/src/lib/warranty.ts`.

### Discount Coupons

**Two Owners, One Engine:**

```
ADMIN COUPONS                    VENDOR COUPONS
  • Any product/category           • Only vendor's products
  • Platform-wide                  • Shop-specific
  • Created by admins              • Created by vendors (plan limited)

Both Support:
  • Percentage (1-100%) or Fixed
  • Optional: productIds, categoryIds, minOrderAmount, maxDiscountAmount
  • Usage limits: total & per-customer
  • Date range with auto-expiry
```

**Validation:**
```javascript
// Server always recalculates
const eligibleItems = cart.items.filter(item => {
  if (coupon.ownerType === 'vendor' && item.vendorId !== coupon.vendorId) {
    return false;  // Vendor coupons don't cross shops
  }
  // Check productIds, categoryIds...
  return true;
});

const discount = calculateDiscount(eligibleItems, coupon);
```

### Featured Promotions

**Two Kinds:**
- **Product**: Feature one listing
- **Store**: Feature entire shop (admin grant only)

**Rules:**
- Only this module writes `Product.isFeatured` and `VendorStore.isFeatured`
- Vendor buys product slots (plan limits duration & quantity)
- Admin grants product OR store placements (1-365 days)
- State derived from `endsAt` (always accurate)
- Daily cron closes expired placements
- Unpublishing product ends its placement
- Expired subscription ends all vendor's placements

### Security

**Verifying the caller.** Every protected request resolves the account from the
`Authorization: Bearer <token>` header. A JWT is verified against the
storefront's JWKS endpoint; if that fails the token is treated as a session
token and looked up in the shared `session` collection. An expired session, a
suspended account and a missing user all end the same way — refused before any
handler runs.

**Roles and ownership.** `requireRole` checks the account's approved `roles`
array (never the claimed active role), and each service scopes its reads to the
caller: a customer reaches only their own orders, cart, wishlist and addresses,
a seller only their own listings and codes, a rider only their own jobs. Admins
reach everything, and a route that takes an id from the URL still checks
ownership before it answers.

**Prices are never trusted.** A request names products and quantities only. Every
price, discount, shipping fee, point redemption and total is recomputed from the
database, so a browser cannot make a 10% coupon worth 50% or force free shipping.

For the concrete guarantees that back this up — a required cron secret, signed
document links, guarded stock and coupon writes, suspension and expiry checks —
see [Security Notes](#security-notes).

---

## Implementation Status

### ✅ Currently Implemented

| Feature | Status |
|---------|--------|
| Core REST API | ✅ Production Ready |
| Authentication | ✅ JWKS + session token, suspension & expiry checks |
| Product Catalog | ✅ Full CRUD + search + review desk |
| Order Processing | ✅ Transactional |
| **Loyalty Points** | ✅ **Earning, redemption, tiers** |
| **Multi-Vendor** | ✅ **Stores, plans, subscriptions, commission** |
| **Rider Delivery** | ✅ **Assignment, GPS tracking, door code** |
| Discount Coupons | ✅ Store + vendor codes |
| Featured Promotions | ✅ Paid placements |
| Document Uploads | ✅ Internal key on write, signed link on read |
| Payment Demo | ✅ Wallet flow, refund on cancellation |
| Email Notifications | ✅ SMTP with templates |
| Scheduled Jobs | ✅ Daily cron tasks |
| Demo Admin Mode | ✅ Auto-restore |
| Activity Feed | ✅ Multi-role notifications |

### 📋 Future Enhancements (On Demand)

| Feature | Status |
|---------|--------|
| Warranty Claims | 📋 Only types defined |
| Rate Limiting | 📋 express-rate-limit |
| Redis Caching | 📋 For sessions/products |
| WebSocket | 📋 Real-time notifications |
| Docker | 📋 Containerization |
| Helmet.js | 📋 Security headers |
| Load Balancer | 📋 Nginx/PM2 |
| Kubernetes | 📋 Orchestration |
| Monitoring | 📋 Sentry/Datadog |
| Payment Gateways | 📋 Stripe, SSLCommerz |
| Elasticsearch | 📋 Advanced search |

---

## Demo Admin Mode

A demo admin (`DEMO_ADMIN_EMAIL`) has the same access as a real admin, but every
write it makes is recorded in a `demo_undo` log and reverted by the nightly
sweep — not after a rolling 24 hours, but once a day at 00:00 Asia/Dhaka
(`0 18 * * *` UTC on Vercel). Only the demo admin's own writes are logged; a real
admin's changes are never touched.

**What the restore does**

1. Created rows (`before: null`) are deleted — **unless something real still
   references them**. If a real product sits in a demo-created category, a cart
   holds a demo-created product, or an order points at a demo-created row, that
   row is kept and the sweep logs it (`kept`), so a reference is never left
   pointing at nothing.
2. Edited or deleted rows are put back from the snapshot, so a real row the demo
   admin changed returns to its original state.

The reference check scans the app's collections for any field (`userId`,
`categoryId`, `productId`, `orderId`, `storeId`, … and their array forms) equal
to the row's id. Ids are globally unique, so a match is always a genuine
dependency. A reference field the check does not know about fails safe: the row
is kept rather than orphaned. Each run reports `removed`, `restored` and `kept`
per collection.

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

### 1. Clone & Install

```bash
git clone https://github.com/demoprojectbdsoft/Sparq-Server.git
cd Sparq-Server
npm install
```

### 2. Configure Environment

Create `.env.local`:

```env
# Database
MONGODB_URI=mongodb://localhost:27017
DATABASE=sparq

# Server
PORT=5000
NEXT_PUBLIC_CLIENT_URL=http://localhost:3000

# Security
INTERNAL_API_KEY=your_random_32_char_key
CRON_SECRET=your_random_32_char_key

# Email (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM=your-email@gmail.com

# Demo
DEMO_ADMIN_EMAIL=demoadmin@example.com
CRON_TIMEZONE=Asia/Dhaka
```

**Gmail Setup:**
1. Enable 2FA on Google account
2. Generate app password at https://myaccount.google.com/apppasswords
3. Use app password as `SMTP_PASS`

### 3. Start Server

```bash
npm run dev      # Development (port 5000)
npm run build    # Production build
npm start        # Production server
```

---

## Project Structure

```
src/
├── app.ts                     Express app setup
├── index.ts                   Server entry + cron jobs
│
├── config/
│   ├── db.ts                  MongoDB connection
│   └── env.ts                 Environment validation
│
├── middlewares/
│   ├── auth.middleware.ts     JWT verification
│   ├── role.middleware.ts     Role guards
│   ├── internal.middleware.ts Internal API key check
│   ├── cron.middleware.ts     Cron job guard
│   ├── error.middleware.ts    Error handler
│   └── notFound.middleware.ts 404 handler
│
├── modules/
│   ├── user/                  User management
│   ├── product/               Product catalog + review desk
│   ├── product-engagement/    Views & favourites
│   ├── category/              Categories
│   ├── subcategory/           Subcategories
│   ├── cart/                  Shopping cart
│   ├── wishlist/              Wishlist
│   ├── order/                 Orders
│   ├── order-status/          Status history
│   ├── transaction/           Payment records
│   ├── review/                Reviews
│   ├── address/               Saved addresses
│   ├── coupon/                Store coupons
│   ├── slide/                 Hero slider
│   ├── promo/                 Promo banners
│   ├── contact/               Contact form
│   ├── message/               Stored messages
│   ├── activity/              Notifications & feed
│   ├── site-settings/         Store config
│   ├── file/                  Document uploads
│   ├── demo/                  Demo admin
│   ├── mail/                  Internal email
│   ├── delivery/              Riders, jobs, tracking
│   ├── rider/                 Rider applications
│   ├── warranty/              Warranty type list (no workflow)
│   └── vendor/                Multi-vendor
│       ├── vendor-application/
│       ├── vendor-store/
│       ├── vendor-product/
│       ├── vendor-order/
│       ├── vendor-plan/
│       ├── vendor-subscription/
│       ├── vendor-coupon/
│       ├── vendor-promotion/
│       ├── vendor-analytics/
│       ├── vendor-desk/
│       └── vendor-admin/
│
└── utils/
    ├── apiError.ts            Error class
    ├── apiResponse.ts         Response formatter
    ├── catchAsync.ts          Async wrapper
    ├── validate.ts            Zod middleware
    ├── authz.ts               Authorization helpers
    ├── transactions.ts        DB transaction wrapper
    ├── roles.ts               Role utilities
    ├── ids.ts                 ObjectId helpers
    ├── mailer.ts              SMTP sender
    └── emailTemplates.ts      Email HTML
```

---

## Environment Setup

### Required Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `DATABASE` | Database name |
| `PORT` | Server port (5000) |
| `NEXT_PUBLIC_CLIENT_URL` | Frontend URL (for JWKS and CORS) |
| `INTERNAL_API_KEY` | Shared secret with frontend |
| `CRON_SECRET` | Bearer secret for the scheduled HTTP routes |

### Email Configuration

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server |
| `SMTP_PORT` | SMTP port (587 for TLS) |
| `SMTP_SECURE` | Use SSL? (false for TLS) |
| `SMTP_USER` | Email address |
| `SMTP_PASS` | App password |
| `MAIL_FROM` | From address |

### Optional

| Variable | Default |
|----------|---------|
| `DEMO_ADMIN_EMAIL` | Demo admin email |
| `CRON_TIMEZONE` | UTC |
| `CORS_ORIGINS` | Comma-separated browser origins allowed by CORS (falls back to `NEXT_PUBLIC_CLIENT_URL`) |
| `FILE_URL_SECRET` | HMAC key for signed document links (falls back to `INTERNAL_API_KEY`) |

---

## Deployment

### Vercel

1. **Push to GitHub**
2. **Import to Vercel**
3. **Configure:**
   - Build: `npm run build`
   - Output: `dist`
   - Install: `npm install`
4. **Add environment variables** (all from `.env.local`)
5. **Deploy**

### Vercel Cron Jobs

Configured in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/demo/restore", "schedule": "0 18 * * *" },
    { "path": "/api/deliveries/expire", "schedule": "0 18 * * *" },
    { "path": "/api/vendor-subscription/expire", "schedule": "15 19 * * *" },
    { "path": "/api/promotions/expire", "schedule": "30 19 * * *" },
    { "path": "/api/products/expire", "schedule": "45 19 * * *" },
    { "path": "/api/currency/refresh", "schedule": "0 2 * * *" }
  ]
}
```

Every scheduled route requires `Authorization: Bearer <CRON_SECRET>`. Vercel sends
that header automatically once `CRON_SECRET` is set in the project, so the secret
must be configured or the jobs are refused. The `x-vercel-cron` header Vercel also
sends is spoofable and is never trusted on its own. A long-running host (not
Vercel) instead runs the same sweeps with `node-cron` in-process; those timers are
armed only when `VERCEL` is unset, so the jobs never run twice.

### Production Checklist

- [ ] Set a strong `CRON_SECRET` (required for the scheduled routes) and `INTERNAL_API_KEY`
- [ ] Configure MongoDB Atlas whitelist
- [ ] Set up production SMTP
- [ ] Update `NEXT_PUBLIC_CLIENT_URL` to production frontend
- [ ] Set `CORS_ORIGINS` to the production storefront origin(s)
- [ ] Test all cron jobs
- [ ] Verify email delivery
- [ ] Set `NODE_ENV=production`
- [ ] Add an edge rate limit in front of `/api/coupons/validate` and `POST /api/orders`

### Security Notes

- Suspended accounts are refused at the API, not only in the interface, and a
  session token past its `expiresAt` no longer authenticates.
- Scheduled HTTP routes require `CRON_SECRET`; the `x-vercel-cron` header is not
  trusted on its own.
- The delivery fee is re-derived on the server — a request cannot post
  `shippingMethod: "free"` to escape the charge.
- Coupon usage and per-customer limits are re-checked at the moment of the
  write, and a stock decrement carries its own guard, so two orders cannot both
  spend the last unit or the last redemption.
- Application documents are read only through the signed link the upload
  returns, or a store-team token. Links issued before this change carry no
  signature and must be re-uploaded.
- Account deletion removes the account's own rows and its better-auth sessions;
  orders, payments and a seller's products are kept as records.
- The site-settings patch is validated and unknown keys are dropped.

### Payments (demo)

This build has **no payment gateway** — online payment is simulated. The rules
that keep the demo honest:

- Every non-COD payment is stored with `isDemo: true` and marked `success` at
  checkout; cash on delivery starts `pending` and settles at the door.
- A wallet transaction id cannot be reused: a second order with the same
  reference is refused, so one demo TrxID cannot pay for two orders.
- Transaction statuses are `pending`, `success`, `failed` and `refunded`.
  Cancelling an order fails a payment that never landed and marks one that had
  gone through as `refunded`, which the customer dashboard shows as "Refunded".

---

## Development

### Adding a Module

1. **Create directory**: `mkdir src/modules/feature`
2. **Create files**:
   - `feature.model.ts` - Mongoose schema
   - `feature.service.ts` - Business logic
   - `feature.controller.ts` - HTTP handlers
   - `feature.validator.ts` - Zod schemas
   - `feature.route.ts` - Express routes
   - `feature.types.ts` - TypeScript types
3. **Mount routes** in `app.ts`:
   ```typescript
   import featureRoutes from './modules/feature/feature.route';
   app.use('/api/features', featureRoutes);
   ```

### Available Scripts

```bash
npm run dev              # Development (watch mode)
npm run build            # TypeScript compilation
npm start                # Production server
npm run dedupe:reviews   # Cleanup script
```

---

## Support & Links

- **Frontend Docs**: [Sparq README](https://github.com/demoprojectbdsoft/Sparq-Electronics-Store)
- **Issues**: [GitHub Issues](https://github.com/demoprojectbdsoft/Sparq-Server/issues)
- **Live API**: [sparq-api.vercel.app](https://sparq-api.vercel.app)

---

## License

MIT License - See [LICENSE](LICENSE)

---

<div align="center">

**Built with ❤️ by [BD Soft](https://github.com/demoprojectbdsoft)**

⚡ Sparq Server - Powering modern e-commerce

</div>
