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
```

## Usage

1. Run `npm run dev` (or open the deployed URL) and sign in with your existing Ledger account.
2. If it's a brand new Supabase account, "Create one" first — you'll get a confirmation email.
3. Every add/edit/delete writes straight to `coin_transactions` — no manual sync step, no local file to export.

## Adding repeat purchases (2026-08-07)

If you set up Coin before this date, run the `coin_recurring` block above once in the SQL Editor — it's additive, won't touch existing data. Manage repeat purchases from Settings → Repeat Purchases.

## One-time data migration

To bring over your existing 1,416 transactions from Ledger's `manual logs/ledger-import-all.json`, see `scripts/migrate.js` in this repo.
