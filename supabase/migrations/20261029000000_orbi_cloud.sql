-- Orbi Cloud on Supabase: profiles with credits, the usage ledger, video jobs and Stripe events.
-- Credits are stored in micro-credits (1 credit = 1,000,000) as bigint.
-- Users can only READ their own rows (RLS). All writes go through the Edge Functions (service role)
-- and the SECURITY DEFINER functions below, which are not callable by signed-in users.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  created_at timestamptz not null default now(),
  stripe_customer text unique,
  plan text,
  plan_status text,
  subscription_id text unique,
  period_end timestamptz,
  plan_balance bigint not null default 0,
  extra_balance bigint not null default 0,
  disabled boolean not null default false
);

create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null,
  amount bigint not null,
  cost_usd double precision not null default 0,
  model text not null default '',
  note text not null default '',
  ref text not null default ''
);
create index if not exists ledger_user_created on public.ledger (user_id, created_at desc);

create table if not exists public.video_jobs (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  model text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  charged boolean not null default false
);
create index if not exists video_jobs_user on public.video_jobs (user_id);

create table if not exists public.stripe_events (
  id text primary key,
  created_at timestamptz not null default now()
);

-- Row Level Security: read your own data, write nothing directly.
alter table public.profiles enable row level security;
alter table public.ledger enable row level security;
alter table public.video_jobs enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "read own ledger" on public.ledger;
create policy "read own ledger" on public.ledger for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "read own video jobs" on public.video_jobs;
create policy "read own video jobs" on public.video_jobs for select to authenticated using ((select auth.uid()) = user_id);

-- Welcome credits for every new account (change 300 to adjust; 0 turns it off).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  trial bigint := 300 * 1000000;
begin
  insert into public.profiles (id, email, name, plan_balance)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''), trial)
  on conflict (id) do nothing;
  if trial > 0 then
    insert into public.ledger (user_id, kind, amount, note) values (new.id, 'trial', trial, 'Welcome credits');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Spends credits: plan credits first, then extra. May go slightly negative on the last call.
create or replace function public.debit_credits(p_user uuid, p_amount bigint, p_cost double precision, p_model text, p_note text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bigint;
  from_plan bigint;
begin
  if p_amount <= 0 then return; end if;
  select plan_balance into b from public.profiles where id = p_user for update;
  from_plan := least(greatest(coalesce(b, 0), 0), p_amount);
  update public.profiles set plan_balance = plan_balance - from_plan, extra_balance = extra_balance - (p_amount - from_plan) where id = p_user;
  insert into public.ledger (user_id, kind, amount, cost_usd, model, note, ref) values (p_user, 'usage', -p_amount, p_cost, coalesce(p_model, ''), coalesce(p_note, ''), coalesce(p_ref, ''));
end $$;

-- Adds credits to the plan or extra bucket (purchases, grants).
create or replace function public.add_credits(p_user uuid, p_bucket text, p_amount bigint, p_kind text, p_note text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_bucket = 'plan' then
    update public.profiles set plan_balance = plan_balance + p_amount where id = p_user;
  else
    update public.profiles set extra_balance = extra_balance + p_amount where id = p_user;
  end if;
  insert into public.ledger (user_id, kind, amount, note, ref) values (p_user, p_kind, p_amount, coalesce(p_note, ''), coalesce(p_ref, ''));
end $$;

-- Monthly renewal: plan credits are set to the allowance (no rollover). Extra credits stay.
create or replace function public.reset_plan_credits(p_user uuid, p_amount bigint, p_note text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bigint;
begin
  select plan_balance into b from public.profiles where id = p_user for update;
  update public.profiles set plan_balance = p_amount where id = p_user;
  insert into public.ledger (user_id, kind, amount, note, ref) values (p_user, 'renewal', p_amount - greatest(coalesce(b, 0), 0), coalesce(p_note, ''), coalesce(p_ref, ''));
end $$;

-- Only the server (service role) may call these.
revoke all on function public.debit_credits(uuid, bigint, double precision, text, text, text) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, text, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.reset_plan_credits(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.debit_credits(uuid, bigint, double precision, text, text, text) to service_role;
grant execute on function public.add_credits(uuid, text, bigint, text, text, text) to service_role;
grant execute on function public.reset_plan_credits(uuid, bigint, text, text) to service_role;
