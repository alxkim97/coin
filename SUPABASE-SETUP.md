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

## Adding projection events (2026-10-09)

Run this once — a new table, doesn't touch anything existing:

```sql
create table coin_projection_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  amount numeric not null check (amount >= 0),
  frequency text not null default 'once' check (frequency in ('once', 'monthly', 'yearly')),
  start_month date not null, -- 1st of the month the event starts
  end_month date,            -- optional last month for monthly/yearly events
  notes text,
  created_at timestamptz not null default now()
);
alter table coin_projection_events enable row level security;
create policy "own rows" on coin_projection_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Desktop Projection page: your own one-off or repeating money events (a renovation, rent income starting, an annual bonus) layered on top of the run-rate projection. Without this table the page still works from the run-rate alone and shows a setup note instead of the events list.

## Claude access — suggest, time-boxed editing, activity log (2026-10-10)

Paste only this block (not the sections above it). Safe to run more than once — new tables/functions plus extra policies; nothing existing is changed or removed:

```sql
-- Who may act on whose data. Claude gets its OWN Coin account (never your
-- login); this row is what lets that account see/suggest/edit your rows.
create table if not exists coin_delegates (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  delegate_id uuid not null references auth.users(id) on delete cascade,
  delegate_email text not null,
  can_suggest boolean not null default true,
  edit_until timestamptz, -- direct editing allowed until this moment; null/past = off
  edit_note text,         -- what the window is for, e.g. "September KBank statement"
  created_at timestamptz not null default now(),
  primary key (owner_id, delegate_id)
);
alter table coin_delegates enable row level security;
drop policy if exists "owner manages" on coin_delegates;
create policy "owner manages" on coin_delegates for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "delegate reads own grant" on coin_delegates;
create policy "delegate reads own grant" on coin_delegates for select
  using (auth.uid() = delegate_id);

create or replace function coin_can_read(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coin_delegates where owner_id = owner and delegate_id = auth.uid()
    and (can_suggest or edit_until > now()))
$$;
create or replace function coin_can_suggest(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coin_delegates where owner_id = owner and delegate_id = auth.uid() and can_suggest)
$$;
create or replace function coin_can_edit(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coin_delegates where owner_id = owner and delegate_id = auth.uid() and edit_until > now())
$$;

-- Connect a helper account by email (it must already be signed up).
create or replace function coin_add_delegate(helper_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into d from auth.users where lower(email) = lower(trim(helper_email));
  if d is null then raise exception 'No Coin account with that email — create it first'; end if;
  if d = auth.uid() then raise exception 'That is your own account — use a separate one for Claude'; end if;
  insert into coin_delegates (owner_id, delegate_id, delegate_email)
    values (auth.uid(), d, lower(trim(helper_email)))
    on conflict (owner_id, delegate_id) do update set can_suggest = true;
  return d;
end $$;
revoke all on function coin_add_delegate(text) from public, anon;
grant execute on function coin_add_delegate(text) to authenticated;

-- Transactions: read while suggesting or editing; write only inside the window.
drop policy if exists "delegate read" on coin_transactions;
create policy "delegate read" on coin_transactions for select using (coin_can_read(user_id));
drop policy if exists "delegate insert" on coin_transactions;
create policy "delegate insert" on coin_transactions for insert with check (coin_can_edit(user_id));
drop policy if exists "delegate update" on coin_transactions;
create policy "delegate update" on coin_transactions for update using (coin_can_edit(user_id)) with check (coin_can_edit(user_id));
drop policy if exists "delegate delete" on coin_transactions;
create policy "delegate delete" on coin_transactions for delete using (coin_can_edit(user_id));

-- Suggestions can now propose edits and deletes, not just new entries.
alter table coin_suggestions add column if not exists action text not null default 'add'
  check (action in ('add', 'edit', 'delete'));
alter table coin_suggestions add column if not exists target_id uuid references coin_transactions(id) on delete cascade;
alter table coin_suggestions add column if not exists tags text[];
drop policy if exists "delegate suggests" on coin_suggestions;
create policy "delegate suggests" on coin_suggestions for all
  using (coin_can_suggest(user_id)) with check (coin_can_suggest(user_id));

-- Every change a helper makes to a transaction is logged automatically, so
-- it can be reviewed and undone. Helpers can't read or alter the log.
create table if not exists coin_delegate_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null,
  action text not null, -- insert | update | delete
  txn_id uuid not null,
  before jsonb,
  after jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
alter table coin_delegate_log enable row level security;
drop policy if exists "owner reads" on coin_delegate_log;
create policy "owner reads" on coin_delegate_log for select using (auth.uid() = owner_id);
drop policy if exists "owner marks undone" on coin_delegate_log;
create policy "owner marks undone" on coin_delegate_log for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create or replace function coin_log_delegate_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid := coalesce(new.user_id, old.user_id);
begin
  if auth.uid() is null or auth.uid() = owner then return null; end if;
  insert into coin_delegate_log (owner_id, actor_id, action, txn_id, before, after)
  values (owner, auth.uid(), lower(tg_op), coalesce(new.id, old.id),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
drop trigger if exists coin_transactions_delegate_log on coin_transactions;
create trigger coin_transactions_delegate_log after insert or update or delete on coin_transactions
  for each row execute function coin_log_delegate_change();
```

Lets Claude help log and fix transactions **through its own Coin account**, never your login. Settings → Claude access connects that account and controls it: **Suggest** (read transactions and propose adds/edits/deletes you Accept or Decline on the Dashboard) and **Direct editing** for a window you choose (1 hour, rest of today, 24 hours) — when the window ends the database itself refuses its writes. Every direct change shows in Settings → Claude activity with an Undo button. The helper account sees transactions and suggestions only — not budgets, net worth, goals, receipts, or settings. Removing it in Settings revokes everything immediately.

Setup: create the helper account (sign out, "Create one", use an address like `you+claude@gmail.com`), sign back in as yourself, connect it in Settings, then run `node scripts/save-session.js` **yourself** and sign in as the helper — the script refuses to save your main account.

## One-time data migration

To bring over your existing 1,416 transactions from Ledger's `manual logs/ledger-import-all.json`, see `scripts/migrate.js` in this repo.
