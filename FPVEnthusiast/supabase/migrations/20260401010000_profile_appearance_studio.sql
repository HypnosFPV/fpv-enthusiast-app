-- Profile appearance studio
-- Public-facing profile cosmetics with visitor-visible active selections.

create table if not exists public.user_profile_appearance_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  active_theme_id text not null default 'default',
  active_avatar_frame_id text not null default 'none',
  active_avatar_effect_id text not null default 'none',
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_profile_appearance_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  item_type text not null check (item_type in ('theme', 'frame', 'effect')),
  item_id text not null,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled')),
  purchase_amount_cents integer not null default 0,
  stripe_payment_intent text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists user_profile_appearance_purchases_owner_item_idx
  on public.user_profile_appearance_purchases(owner_user_id, item_type, item_id);

create index if not exists user_profile_appearance_purchases_owner_status_idx
  on public.user_profile_appearance_purchases(owner_user_id, status, created_at desc);

alter table public.user_profile_appearance_preferences enable row level security;
alter table public.user_profile_appearance_purchases enable row level security;

create policy "profile appearance preferences are publicly readable"
  on public.user_profile_appearance_preferences
  for select
  using (true);

create policy "users manage their own profile appearance preferences"
  on public.user_profile_appearance_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users read their own profile appearance purchases"
  on public.user_profile_appearance_purchases
  for select
  using (auth.uid() = owner_user_id);

create policy "users insert their own profile appearance purchases"
  on public.user_profile_appearance_purchases
  for insert
  with check (auth.uid() = owner_user_id);

create policy "users update their own profile appearance purchases"
  on public.user_profile_appearance_purchases
  for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create or replace function public.touch_user_profile_appearance_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger trg_touch_user_profile_appearance_preferences
before update on public.user_profile_appearance_preferences
for each row
execute function public.touch_user_profile_appearance_updated_at();

create trigger trg_touch_user_profile_appearance_purchases
before update on public.user_profile_appearance_purchases
for each row
execute function public.touch_user_profile_appearance_updated_at();
