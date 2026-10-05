# StayFlow

**An automated operating system for PGs.**

StayFlow replaces the notebook, the WhatsApp group and the daily phone calls that most paying-guest
accommodations run on. It is a multi-tenant SaaS with four connected surfaces — a platform admin
portal, a PG owner dashboard, a resident app and a worker app — all served from one PostgreSQL
database.

The product promise is a single sentence: **enter information once, and everything connected to it
updates itself.**

---

## What that actually means

| You do this once | StayFlow does the rest |
| --- | --- |
| Check a resident in | Bed marked occupied · room, floor and PG occupancy recalculated · rent schedule created and pro-rated from the joining date · first invoice raised · deposit ledger opened · food plan activated · resident app account created · welcome message queued |
| Record a payment | Oldest invoice cleared first · invoice balance and status updated · ledger credited · receipt numbered · dashboard collection refreshed · resident and owner notified · receipt queued to WhatsApp |
| Assign a complaint | Worker task created · worker notified in their app · resident told someone is on it · status and timeline updated |
| A worker marks a task done | Complaint resolved · resident notified with what was fixed · activity logged · owner's open-complaint count drops |
| Check a resident out | Final settlement calculated from live invoices, deposit and unbilled utilities · bed released · occupancy recalculated · rent schedule stopped · food plan ended · app account closed · settlement written to the ledger |
| Record a grocery purchase | Stock topped up · expense filed under Groceries · low-stock alert cleared · profit estimate updated |
| Serve a meal | Grocery stock deducted using each item's configured per-resident quantity · low-stock alerts raised |

Nothing on any dashboard is hard-coded. Every figure is computed from the database at request time.

---

## Tech stack

- **Next.js 16** (App Router, React Server Components, Turbopack) + **TypeScript**
- **PostgreSQL** + **Prisma 6**
- **Tailwind CSS** + Radix primitives (shadcn-style component layer)
- **Framer Motion** for animation, **Recharts** for charts, **Lucide** for icons
- **Zod** + **React Hook Form** for validation, shared between client and server
- Session auth: signed JWT cookie over a hashed, revocable database session

---

## Getting started

### 1. Prerequisites

- Node.js 20.9 or newer
- A running PostgreSQL 14+ server

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Then edit `.env`. The only two values you must set are:

```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/stayflow?schema=public"
AUTH_SECRET="<a long random string>"
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Everything else has a safe default. Integrations you leave blank run in **demo mode**, which is
always clearly labelled in the UI (see [Demo mode](#demo-mode)).

### 4. Create the database and seed it

```bash
npm run db:migrate    # creates the database and applies migrations
npm run db:seed       # loads a complete, realistic demo organisation
```

### 5. Run it

```bash
npm run dev
```

Open <http://localhost:3100>.

---

## Demo accounts

The seed creates one fully-populated organisation, **StayFlow Demo Residences**, with two PGs.

| Role | Email | What they see |
| --- | --- | --- |
| Super Admin | `admin@stayflow.app` | The platform: organizations, subscriptions, payments, plans, leads, audit |
| PG Owner | `owner@stayflow.app` | Both PGs, all modules, subscription and settings |
| Manager | `manager@stayflow.app` | Day-to-day operations, but not settings or billing |
| Worker | `worker@stayflow.app` | Only their own task list, kitchen board and shopping list |
| Resident | `tenant@stayflow.app` | Only their own rent, complaints, food and documents |

**Password for every demo account:** `StayFlow@2026`

(Change `SEED_PASSWORD` in `.env` before seeding to use a different one.)

### What the seed contains

Roughly: 2 PGs · 44 rooms · 116 beds · 97 residents in mixed states · 10 months of invoices and
payments with realistic payment behaviour · complaints at every stage · staff with 30 days of
attendance · food plans, menus and meal counts · grocery stock and purchases · 6 months of expenses ·
visitors, assets, announcements, notifications and activity logs · subscriptions with billing
history · website leads across the pipeline.

Payment behaviour is deliberately varied — some residents pay early, some late, some not at all — so
the dashboards, ageing and reports have something real to show.

---

## Walking through the demo

A good 10-minute path for showing a real PG owner:

1. **Sign in as the owner.** The dashboard opens on all PGs. Switch to Men's (blue) and Women's
   (pink) with the property selector in the header.
2. **Rooms & Beds** → the live bed map. Click an occupied bed to see who is in it; click a vacant
   one to check somebody in.
3. **Residents → Check in resident.** Six steps, pro-rated rent, a bed picker that refuses an
   occupied bed. Finish it and read the success panel — everything it lists actually happened.
4. **Rent & Payments → Generate rent / Send reminders.** These run the same services the nightly
   automation runs.
5. **WhatsApp Outbox.** Read the exact message a resident would receive, marked *not sent* because
   no WhatsApp account is connected.
6. **Sign in as the resident** (`tenant@stayflow.app`) → pay rent, raise a complaint.
7. **Back as the owner** → the complaint is waiting. Assign a worker.
8. **Sign in as the worker** (`worker@stayflow.app`) → the task is there. Mark it done.
9. **Back as the resident** → it shows resolved, with the note the worker wrote.
10. **Reports** → collections, occupancy, expenses and profit, all from those same records.

---

## Automation

One daily pass does the recurring work:

```bash
npm run cron
```

or, for a scheduler:

```bash
curl -X POST https://your-app.example.com/api/cron/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

Each run:

1. Generates this month's rent for every active resident, pro-rated from their joining date
2. Flags overdue invoices and applies late fees after the configured grace period
3. Sends rent reminders — before due, on the due date, and repeating after
4. Bills SaaS subscriptions and attempts AutoPay
5. Moves unpaid accounts into their grace period, then restricts them
6. Snapshots occupancy (this is what the trend charts read)
7. Refreshes expected meal counts from live food subscriptions

Every step is idempotent for a given day, so running it twice is harmless. A signed-in Super Admin
can also trigger it from the platform dashboard.

---

## Demo mode

This is the part most demos get wrong, so it is worth being explicit: **StayFlow never claims
something happened when it did not.**

| Integration | Without credentials | With credentials |
| --- | --- | --- |
| **WhatsApp** | Messages are written to the organization's outbox with status `DEMO_NOT_SENT`, rendered as a WhatsApp bubble so you can read exactly what a resident would receive. The UI says *not sent*. | Real delivery through the WhatsApp Business Cloud API using approved templates. |
| **Payments** | The resident's pay button records a payment flagged `isDemo` end-to-end — in the receipt, the ledger, the payments table and the reports. The dialog says plainly that no money moved. | A real gateway order. The payment is only marked paid from the **verified webhook** at `/api/webhooks/payment` — never from the browser. |
| **Subscription AutoPay** | A labelled simulation that deterministically produces both successes and failures, so you can demo the failure → grace → restriction path. | A real recurring debit. |

To go live, fill in the relevant variables in `.env`:

```bash
WHATSAPP_PROVIDER="meta"
WHATSAPP_PHONE_NUMBER_ID="..."
WHATSAPP_ACCESS_TOKEN="..."

PAYMENT_PROVIDER="razorpay"
PAYMENT_KEY_ID="..."
PAYMENT_KEY_SECRET="..."
PAYMENT_WEBHOOK_SECRET="..."
```

The Settings page and the platform's System Settings page both show which mode each integration is
in.

---

## Pricing model

Subscriptions are charged **per PG**, and the price is a *rule*, not a number:

- **Standard rent basis** (default) — a percentage of that PG's own standard rent. At 100%, one PG
  costs about what one resident pays in rent. A ₹8,000-rent PG and a ₹14,000-rent PG price
  themselves.
- **Per bed** — a rate multiplied by the PG's bed count.
- **Flat** — one fee per PG.

Each rule is bounded by a minimum and a maximum, and carries its own trial and grace periods. The
Super Admin edits all of this under **Plans & Pricing**, with a live calculator. The public pricing
calculator on the marketing site reads the same rule, so the site can never quote a price the
product would not charge.

---

## Project structure

```
prisma/
  schema.prisma          the full data model
  seed.ts, seed-data.ts  the demo organisation
src/
  app/
    (marketing)/         public website, pricing calculator, demo form
    (auth)/login/
    (owner)/app/         PG owner dashboard — 18 modules
    (tenant)/tenant/     resident app (mobile-first)
    (worker)/worker/     worker app (deliberately small)
    (admin)/admin/       platform portal
    api/                 route handlers
  components/
    ui/                  design system primitives
    app/                 shells, charts, tables, shared app pieces
    marketing/           landing page sections
  lib/                   auth, tenancy, validation, theming, utilities
  server/
    services/            business logic (billing, residents, complaints, kitchen, subscriptions)
    integrations/        WhatsApp and payment adapters
    events.ts            activity log + notification fan-out
scripts/                 CLI automation runner and helpers
```

### Conventions worth knowing

- **Money is always a whole-rupee integer.** PG rent, deposits and settlements are transacted in
  whole rupees, so this keeps arithmetic exact and avoids `Decimal` serialisation across the
  server/client boundary.
- **Multi-tenancy is enforced server-side.** Every scoped query goes through `lib/tenancy.ts`. A
  client-supplied organization or property id is never trusted.
- **Transactions where it matters.** Check-in, checkout and payment recording each run as a single
  transaction, so the bed, the ledger, the invoice and the audit trail can never drift apart.
- **The audit log is written inside the transaction**; notifications and messages are sent after it
  commits, so a failed WhatsApp send can never roll back a recorded payment.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3100 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run verify` | Typecheck + build |
| `npm run db:migrate` | Create/apply migrations |
| `npm run db:seed` | Load the demo data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run cron` | Run the daily automation once |

---

## Deployment

### Database

Any managed PostgreSQL works (Neon, Supabase, RDS, Railway). Apply migrations on deploy:

```bash
npm run db:deploy
```

### Application

The app uses Server Components, route handlers and a live database connection, so it needs a Node
runtime — a static export will not work. Vercel, Railway, Render, Fly or a container platform are
all fine.

**Netlify** is supported through `@netlify/plugin-nextjs`, which is wired up in `netlify.toml`.
Set the environment variables in the Netlify UI; never commit `.env`.

### Required in production

```bash
DATABASE_URL=          # your managed PostgreSQL
AUTH_SECRET=           # long random string
CRON_SECRET=           # protects the automation endpoint
NEXT_PUBLIC_SITE_URL=  # your real domain, used in links and the sitemap
```

### After deploying

1. Point a scheduler at `POST /api/cron/run` once a day with the `CRON_SECRET` bearer token.
2. If using a payment gateway, set its webhook to `POST /api/webhooks/payment`.
3. Sign in as the Super Admin and set your pricing rules under **Plans & Pricing**.

---

## Security

- Passwords are hashed with bcrypt and never stored in readable form.
- The session cookie carries a signed JWT whose id is an opaque secret; only its SHA-256 is stored,
  so a leaked database row cannot be replayed. Every request re-checks the session row, making
  logout and suspension take effect immediately.
- Authorisation is checked on the server for every page and every route handler. Client-side routing
  is never the gate.
- Each organization is isolated. Cross-tenant access throws before any query runs.
- Online payments are confirmed only from a signature-verified gateway webhook.
- Secrets are read through a server-only module; the browser bundle can only ever see
  `NEXT_PUBLIC_*` values.
- The single public write endpoint (the demo form) is rate-limited per IP and echoes nothing back.

---

## Notes and honest limits

- **File uploads are not wired to storage.** Resident documents create records so the KYC workflow
  is real, but the files themselves are not stored. Connect an S3-compatible bucket to complete it.
- **Prisma deprecation warning.** `package.json#prisma` still works in Prisma 6 and warns about
  Prisma 7. Migrating to `prisma.config.ts` is a small follow-up.
- **No fake social proof.** There are no invented testimonials, customer logos or user counts
  anywhere on the marketing site — only claims the product can actually back.
