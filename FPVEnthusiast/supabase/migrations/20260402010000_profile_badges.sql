begin;

create table if not exists public.user_profile_badge_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  featured_badge_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_profile_badge_preferences_max_badges
    check (coalesce(array_length(featured_badge_ids, 1), 0) <= 3)
);

create table if not exists public.user_profile_badge_unlocks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  badge_id text not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'granted', 'cancelled')),
  unlock_source text not null default 'stripe'
    check (unlock_source in ('stripe', 'admin_grant', 'season_reward', 'promo')),
  unlock_amount_cents integer not null default 0
    check (unlock_amount_cents >= 0),
  stripe_payment_intent text unique,
  purchased_at timestamptz,
  granted_by_user_id uuid references public.users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_profile_badge_unlocks_owner_badge_unique unique (owner_user_id, badge_id)
);

create index if not exists user_profile_badge_unlocks_owner_status_created_idx
  on public.user_profile_badge_unlocks (owner_user_id, status, created_at desc);

create index if not exists user_profile_badge_unlocks_badge_status_idx
  on public.user_profile_badge_unlocks (badge_id, status);

alter table public.user_profile_badge_preferences enable row level security;
alter table public.user_profile_badge_unlocks enable row level security;

drop policy if exists "badge preferences are publicly readable"
  on public.user_profile_badge_preferences;
create policy "badge preferences are publicly readable"
  on public.user_profile_badge_preferences
  for select
  to public
  using (true);

drop policy if exists "users can insert own badge preferences"
  on public.user_profile_badge_preferences;
create policy "users can insert own badge preferences"
  on public.user_profile_badge_preferences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update own badge preferences"
  on public.user_profile_badge_preferences;
create policy "users can update own badge preferences"
  on public.user_profile_badge_preferences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can read own badge unlocks"
  on public.user_profile_badge_unlocks;
create policy "users can read own badge unlocks"
  on public.user_profile_badge_unlocks
  for select
  to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "users can insert own badge unlocks"
  on public.user_profile_badge_unlocks;
create policy "users can insert own badge unlocks"
  on public.user_profile_badge_unlocks
  for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

drop policy if exists "users can update own badge unlocks"
  on public.user_profile_badge_unlocks;
create policy "users can update own badge unlocks"
  on public.user_profile_badge_unlocks
  for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create or replace function public.touch_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_user_profile_badge_preferences
  on public.user_profile_badge_preferences;
create trigger trg_touch_user_profile_badge_preferences
before update on public.user_profile_badge_preferences
for each row
execute function public.touch_updated_at_column();

drop trigger if exists trg_touch_user_profile_badge_unlocks
  on public.user_profile_badge_unlocks;
create trigger trg_touch_user_profile_badge_unlocks
before update on public.user_profile_badge_unlocks
for each row
execute function public.touch_updated_at_column();

create or replace function public.set_featured_profile_badges(p_badge_ids text[])
returns public.user_profile_badge_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_pref public.user_profile_badge_preferences;
  v_badge_ids text[] := '{}'::text[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(array_length(p_badge_ids, 1), 0) > 3 then
    raise exception 'You can feature at most 3 badges';
  end if;

  select coalesce(array_agg(badge_id order by ord), '{}'::text[])
    into v_badge_ids
  from (
    select badge_id, min(ord) as ord
    from unnest(coalesce(p_badge_ids, '{}'::text[])) with ordinality as requested(badge_id, ord)
    where badge_id is not null and btrim(badge_id) <> ''
    group by badge_id
    order by min(ord)
    limit 3
  ) deduped;

  if exists (
    select 1
    from unnest(v_badge_ids) as requested_badge_id
    left join public.user_profile_badge_unlocks unlocks
      on unlocks.owner_user_id = v_user_id
      and unlocks.badge_id = requested_badge_id
      and unlocks.status in ('paid', 'granted')
    where unlocks.badge_id is null
  ) then
    raise exception 'One or more selected badges are not owned by the user';
  end if;

  insert into public.user_profile_badge_preferences (
    user_id,
    featured_badge_ids
  )
  values (
    v_user_id,
    v_badge_ids
  )
  on conflict (user_id) do update
    set featured_badge_ids = excluded.featured_badge_ids,
        updated_at = timezone('utc', now());

  select *
    into v_pref
  from public.user_profile_badge_preferences
  where user_id = v_user_id;

  return v_pref;
end;
$$;

grant execute on function public.set_featured_profile_badges(text[]) to authenticated;

commit;
