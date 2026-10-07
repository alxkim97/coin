# Supabase Setup for Coin

Coin reuses the same Supabase project as Ledger and NutriLog:
- Project: **lifelog** (`jpsisvaprkrcyvwnmasb`)
- URL: `https://jpsisvaprkrcyvwnmasb.supabase.co`

Sign in with the same email/password you already use for Ledger — same `auth.users` table, no new account needed.

## One-time setup

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/jpsisvaprkrcyvwnmasb/sql/new) and run:

```sql
-- Transactions: one row per transaction (not a single JSON blob per user).
-- This avoids the "last save wins, silently overwrites the other device's edits"
-- class of bug that Ledger's full-blob-replace sync had.
create table if not exists coin_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('income','expense')),
  amount numeric not null check (amount > 0),
  category text not null,
  subcategory text,
  notes text,
  budget_type text,
  created_at timestamptz not null default now()
);
alter table coin_transactions enable row level security;
create policy "own rows" on coin_transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists coin_transactions_user_date_idx on coin_transactions(user_id, date desc);

-- Budgets: one row per category with a monthly limit.
create table if not exists coin_budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null,
  monthly_limit numeric not null default 0,
  budget_type text,
  primary key (user_id, category)
);
alter table coin_budgets enable row level security;
create policy "own rows" on coin_budgets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Repeat purchases: either an auto-posting schedule (mode='auto', posts a real
-- row to coin_transactions on its own when its next_due date arrives) or a
-- quick-pick shortcut (mode='quick', just prefills the Add form — nothing
-- automatic). One table for both since they're the same shape of data.
create table if not exists coin_recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  category text not null,
  subcategory text,
  amount numeric not null check (amount > 0),
  notes text,
  mode text not null check (mode in ('auto','quick')),
  frequency text check (frequency in ('daily','weekly','monthly','quarterly','annually')),
  next_due date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table coin_recurring enable row level security;
create policy "own rows" on coin_recurring for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Net worth check-ins: a periodic manual snapshot (cash + invested), not a
-- per-asset ledger — logged like a check-in, charted over time in Analysis.
create table if not exists coin_networth (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  cash numeric not null default 0,
  invested numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
alter table coin_networth enable row level security;
create policy "own rows" on coin_networth for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-account breakdown for a check-in (e.g. "KBANK Savings", "GLD") — the
-- checkin's cash/invested columns above stay as a computed rollup of these,
-- so nothing that reads them (the Analysis chart, Projection) has to change.
-- No user_id column here — RLS is scoped via the parent checkin row instead.
create table if not exists coin_networth_items (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references coin_networth(id) on delete cascade,
  name text not null,
  category text not null check (category in ('cash', 'invested')),
  value numeric not null default 0
);
alter table coin_networth_items enable row level security;
create policy "own rows via checkin" on coin_networth_items for all
  using (exists (select 1 from coin_networth n where n.id = checkin_id and n.user_id = auth.uid()))
  with check (exists (select 1 from coin_networth n where n.id = checkin_id and n.user_id = auth.uid()));
```

## Usage

1. Run `npm run dev` (or open the deployed URL) and sign in with your existing Ledger account.
2. If it's a brand new Supabase account, "Create one" first — you'll get a confirmation email.
3. Every add/edit/delete writes straight to `coin_transactions` — no manual sync step, no local file to export.

## Adding repeat purchases (2026-08-07)

If you set up Coin before this date, run the `coin_recurring` block above once in the SQL Editor — it's additive, won't touch existing data. Manage repeat purchases from Settings → Repeat Purchases.

## Adding net worth check-ins (2026-08-10)

Run the `coin_networth` block above once — additive, won't touch existing data. Manage check-ins from Settings → Net Worth; the trend shows up under Analysis once you've logged at least one.

## Adding the Insurance net worth category (2026-08-14)

Run this once — additive, existing "cash"/"invested" rows are untouched:

```sql
alter table coin_networth_items drop constraint coin_networth_items_category_check;
alter table coin_networth_items add constraint coin_networth_items_category_check
  check (category in ('cash', 'invested', 'insurance'));
```

Adds a third net worth account category for things like an insurance policy's cash/surrender value (e.g. "Tokio Marine Cash Value") — it's real money, but it's neither spendable cash nor a market investment, so it gets its own bucket instead of being miscounted as either. Shows as its own line on the dashboard widget and its own line in the Analysis Net Worth chart once you log at least one.

## Adding multi-asset net worth (2026-08-10)

Run the `coin_networth_items` block above once — additive, won't touch existing data or the `coin_networth` table's own columns. A check-in now records a list of named accounts (e.g. "KBANK Savings", "GLD") instead of two lump sums; older check-ins made before this date have no items and keep showing their original cash/invested breakdown.

## Adding the credit-card flag (2026-08-13)

Run this once — additive, existing rows default to `false`:

```sql
alter table coin_transactions add column if not exists is_credit_card boolean not null default false;
```

Marks whether an expense was paid on a credit card, so a card's own autopay/statement entry can be told apart from purchases already logged individually. Toggle it from the "Paid via credit card" checkbox on Add/Edit Transaction; a 💳 shows next to flagged transactions in History.

## Adding the credit-card flag to repeat purchases (2026-08-14)

Run this once — additive, existing rows default to `false`:

```sql
alter table coin_recurring add column if not exists is_credit_card boolean not null default false;
```

Lets a repeat purchase (Settings → Repeat Purchases, or the checkbox on Add Transaction) carry the same flag, so transactions it auto-posts show the 💳 badge too.

## Adding the "Remind" repeat-purchase mode (2026-09-02)

Run this once — additive, existing Automatic/Quick Pick rows are untouched (`installments_paid` defaults to 0, `installments_total` to null so nothing auto-stops unless you set it):

```sql
alter table coin_recurring drop constraint coin_recurring_mode_check;
alter table coin_recurring add constraint coin_recurring_mode_check
  check (mode in ('auto', 'quick', 'remind'));
alter table coin_recurring add column if not exists installments_total integer;
alter table coin_recurring add column if not exists installments_paid integer not null default 0;
```

A third repeat-purchase mode for anything that shouldn't silently post itself (Auto) or wait to be manually picked (Quick) — a due or overdue item shows up under **Bills Due** on the Dashboard instead, where you confirm the amount and date and tap Mark Paid. Handles three cases the old modes didn't: a card autopay that can fail (so the date arriving doesn't necessarily mean it was paid), a utility bill whose due date shifts cycle to cycle (the amount/date are editable at confirm time, not locked to what was typed when the reminder was created), and a fixed-term installment like a 0%-interest purchase plan — set `installments_total` (e.g. 10) and it auto-deactivates once that many payments are confirmed, instead of reminding forever.

## Adding the Shopee flag (2026-08-18)

Run this once — additive, existing rows default to `false`:

```sql
alter table coin_transactions add column if not exists is_shopee boolean not null default false;
alter table coin_recurring add column if not exists is_shopee boolean not null default false;
```

Marks whether an expense was bought via Shopee, same pattern as the credit-card flag. Toggle it from the "Bought via Shopee" checkbox on Add/Edit Transaction and on Repeat Purchases; a 🛍️ shows next to flagged transactions in History, and a repeat purchase carries the flag through to whatever it auto-posts.

## Adding Claude-suggested transactions (2026-10-07)

Run this once — additive, new table only:

```sql
create table if not exists coin_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  amount numeric not null check (amount > 0),
  category text not null,
  subcategory text,
  notes text,
  date date not null,
  is_credit_card boolean not null default false,
  is_shopee boolean not null default false,
  budget_type text,
  source_note text,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
alter table coin_suggestions enable row level security;
create policy "own rows" on coin_suggestions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists coin_suggestions_user_status_idx on coin_suggestions(user_id, status);
```

Lets Claude propose a transaction (e.g. from a bank-statement reconciliation) without ever writing to `coin_transactions` directly. Shows up as a **Suggestions** card on the Dashboard — Accept posts it as a real transaction through your own session, Decline just removes it. Claude authenticates via a session saved by `scripts/save-session.js` (you run that yourself — your password is never seen by Claude), then writes rows with `scripts/suggest.js`. That saved session technically carries the same access your login does (Supabase can't scope a session to one table), so `.coin-session.json` is gitignored and should be treated like a saved browser session — delete it any time to revoke access.

## Adding free-form tags to transactions (2026-09-27)

Run this once — additive, existing rows default to an empty array:

```sql
alter table coin_transactions add column if not exists tags text[] not null default '{}';
```

Optional free-text labels on a transaction (e.g. "reimbursable", a trip name), separate from the fixed `category`/`subcategory` fields. Collapsed behind a "+ Add tags" link on Add/Edit Transaction so it doesn't add visual weight to the common case of not using them. Searchable from Transactions' existing filter box, and included in the CSV/JSON exports.

## Adding savings goals (2026-09-27)

Run this once — a new table, doesn't touch anything existing:

```sql
create table coin_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  target_date date,
  current_amount numeric not null default 0,
  linked_account text, -- optional: matches a net-worth item name for auto-tracked progress
  created_at timestamptz not null default now()
);
alter table coin_goals enable row level security;
create policy "own rows" on coin_goals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Sinking funds / savings targets (Settings → Goals, and a Dashboard widget). Progress either comes from `current_amount`, which you update by hand, or — if `linked_account` names one of your net-worth accounts — from that account's latest logged value, same lookup Analysis's Net Worth section already uses.

## Adding receipt photo attachments (2026-09-27)

Run this once — a new private Storage bucket plus one new column:

```sql
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);
create policy "own receipt files" on storage.objects for all
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

alter table coin_transactions add column if not exists receipt_path text;
```

Private bucket (these are financial documents) — every object lives under `<user_id>/...`, and the policy scopes access to that folder matching `auth.uid()`, same ownership model as every table's RLS policy above but for Storage objects instead of rows. The app fetches images via a short-lived signed URL, never a public one.

## Adding budget threshold push alerts (2026-09-27)

Run this once — two new tables:

```sql
create table coin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table coin_push_subscriptions enable row level security;
create policy "own rows" on coin_push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Written only by api/check-budget-alerts.js via the service-role key, which
-- bypasses RLS regardless — enabled with no policies so anon/authenticated
-- clients are flat-out denied instead of implicitly allowed (Supabase Studio
-- flags a table with RLS off as a warning when you run this; choose "Run and
-- enable RLS" rather than "Run without RLS").
create table coin_budget_alerts_sent (
  user_id uuid not null,
  category text not null,
  month text not null, -- 'YYYY-MM'
  sent_at timestamptz not null default now(),
  primary key (user_id, category, month)
);
alter table coin_budget_alerts_sent enable row level security;
```

A daily Vercel Cron job (`api/check-budget-alerts.js`) checks everyone's current-month spend per category against `coin_budgets.monthly_limit` and sends a push notification the first time a category crosses 90% or 100% that month — `coin_budget_alerts_sent` is just a dedupe log so it doesn't repeat.

**This needs real setup before it does anything** (same relationship the AI Q&A feature has with `OPENAI_API_KEY` — the code ships regardless, it just won't send anything until these are done):

1. Generate a VAPID key pair: `npx web-push generate-vapid-keys`
2. In Vercel (Project Settings → Environment Variables), set: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:you@example.com`), `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → Project Settings → API → service_role key — never expose this client-side), `CRON_SECRET` (any random string — Vercel sends it back as the cron request's own Bearer token automatically once set)
3. Put the same `VAPID_PUBLIC_KEY` value into `src/views/settings.js`'s subscribe flow (it's a public key, safe client-side, but still not hardcoded there yet as of this migration — see that file)
4. Deploy — `vercel.json`'s `crons` entry picks it up automatically

## One-time data migration

To bring over your existing 1,416 transactions from Ledger's `manual logs/ledger-import-all.json`, see `scripts/migrate.js` in this repo.
