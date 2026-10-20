# Inventory Control

> This repository also contains **[Nestwise](daycare-crm/README.md)**, a childcare CRM with double-entry accounting and QuickBooks Online / Xero sync, in `daycare-crm/`.

A small internal app for requesting, approving, and tracking recurring inventory
purchases (toilet paper, paper towels, office supplies, etc.).

## How it works

1. **Requesters** submit an order request: pick quantities from the inventory
   catalog and optionally add a note.
2. **Managers** see pending requests and approve or reject them (with an
   optional reason).
3. When a request is approved, **Finance** is notified in-app and the item
   shows up on the finance purchase-frequency dashboard — how often each item
   is ordered, total quantity, and when it was last ordered — for budgeting
   and oversight.
4. **Admins** manage the inventory catalog — add items one at a time, or bulk
   import via CSV upload (columns: `name`, `unit`, `category`; a
   [template](public/inventory-template.csv) is downloadable from the page).
   Rows matching an existing item (by name + unit) update it; new rows are
   added. Admins can also deactivate items no longer purchased and see every
   area of the app.

Notifications are in-app only (a badge in the nav bar); there's no email/SMS
integration.

## Tech stack

- [Next.js](https://nextjs.org) (App Router, Server Actions)
- [Prisma](https://www.prisma.io) + SQLite (via `@prisma/adapter-better-sqlite3`)
- [Auth.js / NextAuth v5](https://authjs.dev) with a credentials (email + password) provider
- Tailwind CSS

## Getting started

```bash
npm install
cp .env.example .env   # then edit AUTH_SECRET (openssl rand -base64 32)
npm run db:migrate      # creates/updates the SQLite database
npm run db:seed         # demo users + sample inventory catalog
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo accounts

All seeded with the password `password123`:

| Role      | Email                 |
| --------- | ---------------------- |
| Requester | requester@demo.com     |
| Manager   | manager@demo.com       |
| Finance   | finance@demo.com       |
| Admin     | admin@demo.com         |

## Project structure

- `prisma/schema.prisma` — data model: `User`, `InventoryItem`, `OrderRequest`,
  `OrderRequestItem`, `Notification`.
- `prisma/seed.ts` — demo users, catalog, and a couple of sample requests.
- `src/auth.ts` — NextAuth configuration (credentials provider, JWT sessions).
- `src/proxy.ts` — route protection: redirects unauthenticated users to
  `/login` and restricts each section to the roles allowed to see it.
- `src/app/requests` — requester flow (submit + view own requests).
- `src/app/approvals` — manager flow (approve/reject pending requests).
- `src/app/finance` — finance dashboard (notifications + purchase frequency).
- `src/app/admin/items` — inventory catalog management.

## Other scripts

```bash
npm run build       # production build
npm run lint         # eslint
npm run db:studio    # browse the SQLite database in Prisma Studio
```
