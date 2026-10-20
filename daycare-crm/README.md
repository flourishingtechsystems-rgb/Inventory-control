# Nestwise — childcare CRM with real accounting

Nestwise runs a childcare center end to end: enrollment pipeline, families, classrooms, attendance and ratios, tuition billing and a parent portal. Under it sits a **full double-entry general ledger** that syncs to **QuickBooks Online** and **Xero**.

Most childcare platforms treat accounting as a payments list plus an export. Nestwise is built so a CPA can trust the numbers: every dollar posts as a balanced journal entry, the receivables sub-ledger is reconciled to the GL on every page load, and closed periods are locked.

## Why the accounting holds up

| What accountants check | How Nestwise handles it |
| --- | --- |
| Does it balance? | Every posting goes through one engine that rejects unbalanced entries. A/R and Undeposited Funds are reconciled live (Dashboard → *Books health*, Reports → *Reconciliation*). |
| Processing fees separate from revenue? | Card/ACH fees are expensed at receipt (configurable rates or the processor's actual fee). Payouts land in the bank net, so bank rec is a 1:1 match. |
| Can I map to *my* chart of accounts? | Every Nestwise account maps to any QuickBooks/Xero account, and every classroom maps to a QuickBooks **Class** or Xero **tracking category**. |
| Discounts visible? | Revenue is booked gross; sibling, staff and scholarship discounts go to a contra-revenue account. |
| Split households and subsidies? | Per-enrollment billing splits: a fixed agency amount (CCAP etc.) first, then co-parent percentages. Each payer has their own A/R, statements and autopay. Rounding always sums to the cent (largest-remainder). |
| Proration? | Start/end dates prorate by enrolled weekdays. |
| Duplicate billing? | Billing runs are previewed first, then posted atomically. Every charge carries a dedupe key, so re-running a period only bills what's missing. |
| Audit trail? | Posted entries are immutable. Voids and corrections are reversing entries. An audit log records who did what. |
| Period close? | A lock date blocks any posting, void or backdate on or before it. |
| Year-end? | Dependent-care (Form 2441 / FSA) statements per guardian, net of refunds, excluding subsidy payments, with your EIN. |
| A/R collections? | Aging by payer (Current / 1–30 / 31–60 / 61–90 / 90+), automatic late fees once per invoice after a grace period, and credits applied automatically to the oldest invoices. |

### QuickBooks Online & Xero sync

- **OAuth 2.0** connect flow with CSRF state. Tokens are encrypted at rest (AES-256-GCM) and refreshed automatically; rotated refresh tokens are stored.
- **Two sync modes**
  - *Daily summary journal* (recommended): one balanced journal per day, netted by account and class. Your books stay clean.
  - *Every transaction*: one journal per Nestwise entry. In QuickBooks, A/R lines carry the **customer**, and customers are created automatically, so customer balances and aging work there too.
- **Exactly-once posting.** Each entry is tracked in `ExternalRef`. Requests use QuickBooks `requestid` and Xero `Idempotency-Key`, and QuickBooks is checked for an existing `DocNumber` before posting, so a crashed or retried sync never double-posts. Corrections and backdated entries go out as new journals rather than rewriting synced history.
- **Guard rails.** Sync refuses to run while any used account is unmapped. The mapping screen disables destination accounts the provider would reject. Xero system accounts like *Accounts Receivable* can't take manual journals, and QuickBooks A/R needs a customer in summary mode. In both cases the screen explains why and what to map instead.
- **429/5xx retry** with `Retry-After` support. Each push is logged in a per-provider sync log.
- **No connection needed for exports:** Xero manual-journal import CSV, QuickBooks Desktop IIF, and general-ledger CSV.

## Everything else

- **Leads & tours:** kanban pipeline, activity log, tour scheduling, conversion rate, one-click convert to family + guardian + billing account + child.
- **Families:** guardians and authorized pickups, children (allergies, immunization due dates), enrollments, split billing, statements, messages.
- **Drop-off, pick-up & whereabouts:**
  - **Check-in** records the time, who dropped the child off (a guardian, or "someone else" by name) and which staff member recorded it.
  - **Check-out** is limited to adults on the authorized-pickup list. Anyone else is refused with the list shown.
  - **Areas** cover every space a child can be in: each classroom's home room plus shared spaces like the playground, gym or nap room (managed under *Rooms & Ratios*).
  - **Location and caregiver at all times:** while a child is in the building they always have exactly one current **area** and **responsible caregiver**. Staff move one child or a selected group ("preschool → Playground with Omar"), and every move is time-stamped.
  - **Caregivers** must be clocked in to take children, and can't clock out while children are still assigned to them.
  - **Where is everyone:** a live board showing each area, who is with whom and since when. Caregiver load is checked against the strictest ratio in each group, so one infant in a mixed group applies the infant ratio.
  - **Daily log:** each visit's drop-off and pick-up (time, person, recorded by) plus the full area/caregiver timeline, with CSV download for licensing records.
  - **Multiple visits per day** are supported (e.g. out for an appointment and back).
  - **Families and parents** see the same information: today's status and history on the family page, and the live location plus today's timeline in the parent portal.
- **Dashboard:** occupancy, MTD revenue/collections, A/R aging, books health, ratio status, pipeline, compliance alerts.
- **Parent self check-in:**
  - **Kiosk:** a front-desk tablet signed in as the *Check-in kiosk* role shows a PIN pad. Each adult has their own 6-digit PIN, issued by staff on the family page or set by the parent in the portal. After entering it, they tap a child to check in or out.
    - Check-outs follow the same authorized-pickup rules as staff check-outs.
    - The screen resets itself after 45 seconds.
    - Five wrong PINs within 10 minutes lock the kiosk briefly.
  - **Phone:** parents check in or out from the portal by entering the 6-digit **center code** shown on the kiosk (and on staff check-in screens). The code changes every 15 minutes, so it can't be done from home, and repeated wrong codes lock out.
  - **Recorded as self-service:** every visit records who did it and how, e.g. "recorded by Self check-in (kiosk)".
  - **PIN storage:** PINs are stored only as a keyed HMAC tied to `AUTH_SECRET`. If you rotate that secret, PINs must be re-issued.
- **One-time release to someone not on the pickup list:**
  - **Request:** staff record the person's name, relationship, ID type and number (only the last 4 characters are kept), and which authorized guardian gave consent and how (phone call, written note, in person).
  - **Approval:** a teacher's request waits for a **director or admin to approve or deny**. It shows on the check-in screen and the dashboard. A director at the desk approves in one step.
  - **On approval:** the child is checked out, the family gets an immediate message with the details, and the daily log flags the visit as a one-time release.
  - **Audit trail:** every request and decision is audit-logged.
- **Parent portal:** today's check-in status, billing history, pay balance, autopay, messages.
- **Roles:** Admin, Director, Bookkeeper, Teacher, Parent. Enforced in `src/proxy.ts` *and* in every page and server action.

## Getting started

```bash
cd daycare-crm
npm install
cp .env.example .env    # set AUTH_SECRET; QuickBooks/Xero keys are optional
npm run db:migrate      # create the SQLite database
npm run db:seed         # demo center with two months of activity
npm run dev
```

Demo logins (password `password123`): `director@demo.com`, `books@demo.com`, `teacher@demo.com`, `parent@demo.com`, `admin@demo.com`, and `kiosk@demo.com` for the front-desk tablet (demo PINs: Maria Garcia `246810`, Luis Garcia `135792`).

### Connecting QuickBooks / Xero

1. Create an app at developer.intuit.com and/or developer.xero.com.
2. Set the redirect URIs to `${APP_URL}/api/integrations/quickbooks/callback` and `${APP_URL}/api/integrations/xero/callback`.
3. Put the client id/secret in `.env` (see `.env.example`), then open **QuickBooks & Xero → Connect**.
4. Map accounts and classrooms, choose a sync mode and a "sync from" date, then **Sync now**.
5. Schedule `POST /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`. It applies late fees and pushes to every connected provider. `npm run sync` does the push from a shell.

## Development

```bash
npm test           # unit + end-to-end ledger and sync tests (temporary SQLite DBs)
npm run typecheck
npm run lint
npm run build
```

### Layout

- `src/lib/accounting/`: the ledger engine
  - `billing.ts`: proration, discounts, split billing (pure)
  - `ledger.ts`: balancing, trial balance, P&L, balance sheet, aging (pure)
  - `posting.ts`: the only writer to the GL (period lock, numbering, reversals)
  - `receivables.ts`: invoices, payments, credits, write-offs, refunds, deposits, late fees
  - `billing-run.ts`, `reports.ts`, `statement.ts`
- `src/lib/presence.ts`: kiosk PINs, rotating center code, kiosk session tokens
- `src/lib/attendance.ts`: check-in/out, self check-in, one-time pickup releases, movements between areas and caregivers, pickup authorization, caregiver load, daily log
- `src/lib/integrations/`: OAuth (`oauth.ts`), token crypto, QuickBooks/Xero HTTP clients (`clients.ts`), payload mappers and file exports (`mappers.ts`), sync engine (`sync.ts`)
- `src/app/`: pages and server actions by area (`leads`, `families`, `attendance`, `billing`, `accounting`, `integrations`, `portal`)

All money is integer cents and all percentages are basis points. Nothing passes through a float.

### Production notes

- **Card processing.** The parent-portal "Pay" button records a settled card payment exactly as a processor webhook would. Wire it to your processor (e.g. Stripe Checkout plus a webhook calling `recordPayment`) before taking real cards.
- **Database.** SQLite suits a single center. For multi-site, switch the Prisma datasource to Postgres.
- **Xero scopes.** New Xero apps may require granular scopes. Override `XERO_SCOPES` to match your app's configuration.
