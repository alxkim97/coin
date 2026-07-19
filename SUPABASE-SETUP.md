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
```

## Usage

1. Run `npm run dev` (or open the deployed URL) and sign in with your existing Ledger account.
2. If it's a brand new Supabase account, "Create one" first — you'll get a confirmation email.
3. Every add/edit/delete writes straight to `coin_transactions` — no manual sync step, no local file to export.

## One-time data migration

To bring over your existing 1,416 transactions from Ledger's `manual logs/ledger-import-all.json`, see `scripts/migrate.js` in this repo.
