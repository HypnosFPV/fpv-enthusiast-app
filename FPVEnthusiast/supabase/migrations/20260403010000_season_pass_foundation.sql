begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seasonal XP + Pass foundation
-- Reuses the existing public.seasons concept and layers pass/progression data
-- on top so future seasons can be scheduled from backend data without app
-- releases.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  number integer not null,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists seasons_number_unique_idx
  on public.seasons (number);

alter table public.seasons add column if not exists slug text;
alter table public.seasons add column if not exists theme_key text;
alter table public.seasons add column if not exists description text;
alter table public.seasons add column if not exists banner_image_url text;
alter table public.seasons add column if not exists xp_per_level integer not null default 100;
alter table public.seasons add column if not exists max_level integer not null default 30;
alter table public.seasons add column if not exists pass_price_cents integer not null default 1499;
alter table public.seasons add column if not exists pass_enabled boolean not null default true;
alter table public.seasons add column if not exists claims_open_until timestamptz;
alter table public.seasons add column if not exists status text not null default 'draft';

alter table public.seasons
  drop constraint if exists seasons_status_check;
alter table public.seasons
  add constraint seasons_status_check
  check (status in ('draft', 'scheduled', 'active', 'ended', 'archived'));

create table if not exists public.season_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  reward_type text not null
    check (reward_type in ('props', 'badge', 'theme', 'frame', 'effect', 'title')),
  reward_key text not null,
  display_name text not null,
  description text,
  amount_int integer not null default 0,
  rarity text not null default 'standard'
    check (rarity in ('standard', 'rare', 'epic', 'legendary', 'seasonal')),
  is_evergreen boolean not null default true,
  is_premium_only boolean not null default false,
  season_theme_tag text,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint season_reward_catalog_reward_unique unique (reward_type, reward_key)
);

create table if not exists public.season_track_rewards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  level_number integer not null check (level_number >= 1),
  track_type text not null check (track_type in ('free', 'premium')),
  reward_catalog_id uuid not null references public.season_reward_catalog(id) on delete restrict,
  quantity integer not null default 1 check (quantity >= 1),
  claim_group text,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint season_track_rewards_unique unique (season_id, level_number, track_type)
);

create index if not exists season_track_rewards_season_track_idx
  on public.season_track_rewards (season_id, track_type, level_number);

create table if not exists public.user_season_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  xp_total integer not null default 0 check (xp_total >= 0),
  level_current integer not null default 0 check (level_current >= 0),
  premium_unlocked boolean not null default false,
  premium_unlocked_at timestamptz,
  season_completed_at timestamptz,
  last_xp_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_season_progress_unique unique (user_id, season_id)
);

create index if not exists user_season_progress_season_level_idx
  on public.user_season_progress (season_id, level_current desc, xp_total desc);

create table if not exists public.user_season_xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  event_type text not null,
  xp_amount integer not null check (xp_amount > 0),
  reference_id text not null default '',
  reference_subtype text not null default '',
  awarded_on_date date not null default current_date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_season_xp_events_dedupe_unique
    unique (user_id, season_id, event_type, reference_id, reference_subtype, awarded_on_date)
);

create index if not exists user_season_xp_events_user_created_idx
  on public.user_season_xp_events (user_id, created_at desc);

create table if not exists public.user_season_reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  track_reward_id uuid not null references public.season_track_rewards(id) on delete cascade,
  claimed_at timestamptz not null default timezone('utc', now()),
  meta jsonb not null default '{}'::jsonb,
  constraint user_season_reward_claims_unique unique (user_id, track_reward_id)
);

create index if not exists user_season_reward_claims_user_season_idx
  on public.user_season_reward_claims (user_id, season_id, claimed_at desc);

create or replace function public.touch_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_seasons_updated_at on public.seasons;
create trigger trg_touch_seasons_updated_at
before update on public.seasons
for each row execute function public.touch_updated_at_column();

drop trigger if exists trg_touch_season_reward_catalog_updated_at on public.season_reward_catalog;
create trigger trg_touch_season_reward_catalog_updated_at
before update on public.season_reward_catalog
for each row execute function public.touch_updated_at_column();

drop trigger if exists trg_touch_season_track_rewards_updated_at on public.season_track_rewards;
create trigger trg_touch_season_track_rewards_updated_at
before update on public.season_track_rewards
for each row execute function public.touch_updated_at_column();

drop trigger if exists trg_touch_user_season_progress_updated_at on public.user_season_progress;
create trigger trg_touch_user_season_progress_updated_at
before update on public.user_season_progress
for each row execute function public.touch_updated_at_column();

alter table public.season_reward_catalog enable row level security;
alter table public.season_track_rewards enable row level security;
alter table public.user_season_progress enable row level security;
alter table public.user_season_xp_events enable row level security;
alter table public.user_season_reward_claims enable row level security;

drop policy if exists "season reward catalog is publicly readable"
  on public.season_reward_catalog;
create policy "season reward catalog is publicly readable"
  on public.season_reward_catalog
  for select
  to public
  using (active = true);

drop policy if exists "season track rewards are publicly readable"
  on public.season_track_rewards;
create policy "season track rewards are publicly readable"
  on public.season_track_rewards
  for select
  to public
  using (true);

drop policy if exists "users read own season progress"
  on public.user_season_progress;
create policy "users read own season progress"
  on public.user_season_progress
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users read own season xp events"
  on public.user_season_xp_events;
create policy "users read own season xp events"
  on public.user_season_xp_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users read own season reward claims"
  on public.user_season_reward_claims;
create policy "users read own season reward claims"
  on public.user_season_reward_claims
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.calculate_season_level(
  p_xp_total integer,
  p_xp_per_level integer,
  p_max_level integer
)
returns integer
language sql
immutable
as $$
  select greatest(
    0,
    least(
      greatest(coalesce(p_max_level, 30), 0),
      floor(greatest(coalesce(p_xp_total, 0), 0)::numeric / greatest(coalesce(p_xp_per_level, 100), 1))::int
    )
  );
$$;

create or replace function public.ensure_user_season_progress(
  p_user_id uuid,
  p_season_id uuid
)
returns public.user_season_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_season_progress;
begin
  insert into public.user_season_progress (user_id, season_id)
  values (p_user_id, p_season_id)
  on conflict (user_id, season_id) do nothing;

  select *
    into v_row
  from public.user_season_progress
  where user_id = p_user_id
    and season_id = p_season_id;

  return v_row;
end;
$$;

create or replace function public.grant_season_catalog_reward(
  p_user_id uuid,
  p_season_id uuid,
  p_reward_catalog_id uuid,
  p_reference_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog public.season_reward_catalog;
  v_awarded boolean := false;
  v_reference text := coalesce(nullif(btrim(p_reference_id), ''), p_reward_catalog_id::text);
begin
  select *
    into v_catalog
  from public.season_reward_catalog
  where id = p_reward_catalog_id
    and active = true;

  if not found then
    raise exception 'Reward catalog item not found';
  end if;

  if v_catalog.reward_type = 'props' then
    select public.award_props(
      p_user_id,
      'season_track_reward',
      greatest(v_catalog.amount_int, 0),
      v_reference
    ) into v_awarded;

    return jsonb_build_object(
      'reward_type', v_catalog.reward_type,
      'reward_key', v_catalog.reward_key,
      'props_awarded', greatest(v_catalog.amount_int, 0),
      'awarded', coalesce(v_awarded, false)
    );
  elsif v_catalog.reward_type = 'badge' then
    insert into public.user_profile_badge_unlocks (
      owner_user_id,
      badge_id,
      status,
      unlock_source,
      unlock_amount_cents,
      purchased_at,
      meta
    )
    values (
      p_user_id,
      v_catalog.reward_key,
      'granted',
      'season_reward',
      0,
      timezone('utc', now()),
      jsonb_build_object('season_id', p_season_id, 'reward_catalog_id', v_catalog.id)
    )
    on conflict (owner_user_id, badge_id) do update
      set status = case
          when public.user_profile_badge_unlocks.status in ('paid', 'granted') then public.user_profile_badge_unlocks.status
          else 'granted'
        end,
          unlock_source = case
          when public.user_profile_badge_unlocks.status in ('paid', 'granted') then public.user_profile_badge_unlocks.unlock_source
          else 'season_reward'
        end,
          updated_at = timezone('utc', now());

    return jsonb_build_object(
      'reward_type', v_catalog.reward_type,
      'reward_key', v_catalog.reward_key,
      'awarded', true
    );
  elsif v_catalog.reward_type in ('theme', 'frame', 'effect') then
    insert into public.user_profile_appearance_purchases (
      owner_user_id,
      item_type,
      item_id,
      status,
      purchase_amount_cents,
      stripe_payment_intent,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      v_catalog.reward_type,
      v_catalog.reward_key,
      'paid',
      0,
      null,
      timezone('utc', now()),
      timezone('utc', now())
    )
    on conflict (owner_user_id, item_type, item_id) do update
      set status = 'paid',
          updated_at = timezone('utc', now());

    return jsonb_build_object(
      'reward_type', v_catalog.reward_type,
      'reward_key', v_catalog.reward_key,
      'awarded', true
    );
  else
    return jsonb_build_object(
      'reward_type', v_catalog.reward_type,
      'reward_key', v_catalog.reward_key,
      'awarded', false,
      'note', 'Reward type is reserved for future use'
    );
  end if;
end;
$$;

create or replace function public.award_season_xp(
  p_user_id uuid default null,
  p_event_type text default '',
  p_xp_amount integer default 0,
  p_reference_id text default '',
  p_reference_subtype text default '',
  p_awarded_on_date date default current_date,
  p_metadata jsonb default '{}'::jsonb,
  p_season_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := coalesce(p_user_id, auth.uid());
  v_auth_role text := auth.role();
  v_season public.seasons;
  v_progress public.user_season_progress;
  v_previous_level integer := 0;
  v_next_level integer;
  v_inserted_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_auth_role <> 'service_role' and auth.uid() is distinct from v_actor_id then
    raise exception 'Not authorized to award xp for another user';
  end if;

  if coalesce(btrim(p_event_type), '') = '' then
    raise exception 'event_type is required';
  end if;

  if coalesce(p_xp_amount, 0) <= 0 then
    raise exception 'xp_amount must be positive';
  end if;

  if p_season_id is not null then
    select * into v_season
    from public.seasons
    where id = p_season_id;
  else
    select * into v_season
    from public.seasons
    where status = 'active'
    order by starts_at desc
    limit 1;

    if not found then
      select * into v_season
      from public.seasons
      order by starts_at desc nulls last, number desc
      limit 1;
    end if;
  end if;

  if not found then
    raise exception 'No season available';
  end if;

  perform public.ensure_user_season_progress(v_actor_id, v_season.id);

  insert into public.user_season_xp_events (
    user_id,
    season_id,
    event_type,
    xp_amount,
    reference_id,
    reference_subtype,
    awarded_on_date,
    metadata
  )
  values (
    v_actor_id,
    v_season.id,
    p_event_type,
    p_xp_amount,
    coalesce(p_reference_id, ''),
    coalesce(p_reference_subtype, ''),
    coalesce(p_awarded_on_date, current_date),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select * into v_progress
    from public.user_season_progress
    where user_id = v_actor_id
      and season_id = v_season.id;

    return jsonb_build_object(
      'ok', true,
      'awarded', false,
      'season_id', v_season.id,
      'xp_total', coalesce(v_progress.xp_total, 0),
      'level_current', coalesce(v_progress.level_current, 0),
      'reason', 'duplicate'
    );
  end if;

  select * into v_progress
  from public.user_season_progress
  where user_id = v_actor_id
    and season_id = v_season.id
  for update;

  v_previous_level := coalesce(v_progress.level_current, 0);
  v_next_level := public.calculate_season_level(
    coalesce(v_progress.xp_total, 0) + p_xp_amount,
    v_season.xp_per_level,
    v_season.max_level
  );

  update public.user_season_progress
     set xp_total = coalesce(xp_total, 0) + p_xp_amount,
         level_current = v_next_level,
         last_xp_at = timezone('utc', now()),
         season_completed_at = case
           when v_next_level >= v_season.max_level then coalesce(season_completed_at, timezone('utc', now()))
           else season_completed_at
         end,
         updated_at = timezone('utc', now())
   where id = v_progress.id
   returning * into v_progress;

  return jsonb_build_object(
    'ok', true,
    'awarded', true,
    'season_id', v_season.id,
    'xp_total', v_progress.xp_total,
    'level_current', v_progress.level_current,
    'leveled_up', v_progress.level_current > v_previous_level
  );
end;
$$;

create or replace function public.claim_season_reward(
  p_track_reward_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_track public.season_track_rewards;
  v_season public.seasons;
  v_progress public.user_season_progress;
  v_claim public.user_season_reward_claims;
  v_reward_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_track
  from public.season_track_rewards
  where id = p_track_reward_id;

  if not found then
    raise exception 'Reward not found';
  end if;

  select *
    into v_season
  from public.seasons
  where id = v_track.season_id;

  if not found then
    raise exception 'Season not found';
  end if;

  if v_season.claims_open_until is not null and v_season.claims_open_until < timezone('utc', now()) then
    raise exception 'Reward claiming for this season is closed';
  end if;

  perform public.ensure_user_season_progress(v_user_id, v_season.id);

  select *
    into v_progress
  from public.user_season_progress
  where user_id = v_user_id
    and season_id = v_season.id
  for update;

  if coalesce(v_progress.level_current, 0) < v_track.level_number then
    raise exception 'Reach level % to claim this reward', v_track.level_number;
  end if;

  if v_track.track_type = 'premium' and coalesce(v_progress.premium_unlocked, false) = false then
    raise exception 'Unlock the season pass to claim premium rewards';
  end if;

  insert into public.user_season_reward_claims (
    user_id,
    season_id,
    track_reward_id,
    meta
  )
  values (
    v_user_id,
    v_season.id,
    v_track.id,
    jsonb_build_object('level_number', v_track.level_number, 'track_type', v_track.track_type)
  )
  on conflict (user_id, track_reward_id) do nothing
  returning * into v_claim;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'already_claimed',
      'track_reward_id', v_track.id
    );
  end if;

  select public.grant_season_catalog_reward(
    v_user_id,
    v_season.id,
    v_track.reward_catalog_id,
    concat(v_track.id::text, ':', v_user_id::text)
  )
  into v_reward_result;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'track_reward_id', v_track.id,
    'season_id', v_season.id,
    'level_number', v_track.level_number,
    'track_type', v_track.track_type,
    'reward', v_reward_result
  );
end;
$$;

create or replace function public.set_user_season_pass(
  p_season_id uuid,
  p_premium_unlocked boolean default true,
  p_user_id uuid default null
)
returns public.user_season_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_progress public.user_season_progress;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' and auth.uid() is distinct from v_user_id then
    raise exception 'Not authorized to set another user''s season pass';
  end if;

  perform public.ensure_user_season_progress(v_user_id, p_season_id);

  update public.user_season_progress
     set premium_unlocked = p_premium_unlocked,
         premium_unlocked_at = case when p_premium_unlocked then coalesce(premium_unlocked_at, timezone('utc', now())) else null end,
         updated_at = timezone('utc', now())
   where user_id = v_user_id
     and season_id = p_season_id
   returning * into v_progress;

  return v_progress;
end;
$$;

grant execute on function public.calculate_season_level(integer, integer, integer) to authenticated, anon;
grant execute on function public.ensure_user_season_progress(uuid, uuid) to authenticated, service_role;
grant execute on function public.grant_season_catalog_reward(uuid, uuid, uuid, text) to service_role;
grant execute on function public.award_season_xp(uuid, text, integer, text, text, date, jsonb, uuid) to authenticated, service_role;
grant execute on function public.claim_season_reward(uuid) to authenticated;
grant execute on function public.set_user_season_pass(uuid, boolean, uuid) to authenticated, service_role;

create or replace view public.season_track_reward_details as
select
  str.id,
  str.season_id,
  str.level_number,
  str.track_type,
  str.quantity,
  str.claim_group,
  str.sort_order,
  src.id as reward_catalog_id,
  src.reward_type,
  src.reward_key,
  src.display_name,
  src.description,
  src.amount_int,
  src.rarity,
  src.is_evergreen,
  src.is_premium_only,
  src.season_theme_tag,
  src.metadata
from public.season_track_rewards str
join public.season_reward_catalog src
  on src.id = str.reward_catalog_id;

grant select on public.season_track_reward_details to authenticated, anon;

-- ── Seed reward catalog and a first 30-level ladder for the current season ───
do $$
declare
  v_season_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select id
    into v_season_id
  from public.seasons
  where is_active = true
  order by starts_at desc
  limit 1;

  if v_season_id is null then
    select id
      into v_season_id
    from public.seasons
    order by starts_at desc nulls last, number desc
    limit 1;
  end if;

  if v_season_id is null then
    insert into public.seasons (
      number,
      name,
      slug,
      starts_at,
      ends_at,
      is_active,
      theme_key,
      description,
      xp_per_level,
      max_level,
      pass_price_cents,
      pass_enabled,
      claims_open_until,
      status
    )
    values (
      1,
      'Season 1',
      'season-1',
      v_now,
      v_now + interval '35 days',
      true,
      'neon-drift',
      'Kickoff season for the new XP and pass system.',
      100,
      30,
      1499,
      true,
      v_now + interval '49 days',
      'active'
    )
    returning id into v_season_id;
  else
    update public.seasons
       set slug = coalesce(slug, concat('season-', number)),
           theme_key = coalesce(theme_key, 'neon-drift'),
           description = coalesce(description, 'Kickoff season for the new XP and pass system.'),
           xp_per_level = coalesce(xp_per_level, 100),
           max_level = coalesce(max_level, 30),
           pass_price_cents = coalesce(pass_price_cents, 1499),
           pass_enabled = coalesce(pass_enabled, true),
           claims_open_until = coalesce(claims_open_until, ends_at + interval '14 days'),
           status = case
             when status is not null and status <> 'draft' then status
             when is_active then 'active'
             when ends_at < v_now then 'ended'
             when starts_at > v_now then 'scheduled'
             else 'active'
           end
     where id = v_season_id;
  end if;

  insert into public.season_reward_catalog (reward_type, reward_key, display_name, description, amount_int, rarity, is_evergreen, is_premium_only, season_theme_tag)
  values
    ('props',  'props_25',        '25 Props',                'Small props bundle.', 25,  'standard',  true,  false, null),
    ('props',  'props_40',        '40 Props',                'Steady progression props bundle.', 40,  'standard',  true,  false, null),
    ('props',  'props_60',        '60 Props',                'Mid-tier props bundle.', 60,  'rare',      true,  false, null),
    ('props',  'props_100',       '100 Props',               'Large props bundle.', 100, 'epic',      true,  true,  null),
    ('props',  'props_150',       '150 Props',               'High-value props bundle.', 150, 'legendary', true, true, null),
    ('badge',  'founder_signal',  'Founder Signal',          'Early supporter energy with a clean neon founder mark.', 0, 'rare', true, false, 'neon-drift'),
    ('badge',  'aerial_ace',      'Aerial Ace',              'Fast, sharp, and unmistakably FPV.', 0, 'common', true, false, 'neon-drift'),
    ('badge',  'midnight_orbit',  'Midnight Orbit',          'Dark premium badge with orbit-core styling.', 0, 'epic', true, true, 'neon-drift'),
    ('badge',  'season_zero',     'Season Zero',             'A premium first-wave collectible for early adopters.', 0, 'seasonal', false, true, 'neon-drift'),
    ('theme',  'hypnos_violet',   'Hypnos Violet',           'A polished violet identity pass with richer hero gradients and a crisp electric accent.', 0, 'epic', true, true, 'neon-drift'),
    ('theme',  'aurora_teal',     'Aurora Teal',             'A cool sci-fi profile shell that makes the hero and stat card feel more futuristic.', 0, 'legendary', true, true, 'neon-drift'),
    ('frame',  'ion_ring',        'Ion Ring',                'A bright cyan ring with subtle outer glow for a sharper profile photo.', 0, 'rare', true, false, 'neon-drift'),
    ('frame',  'violet_crown',    'Violet Crown',            'Adds a richer purple edge treatment that pairs well with darker banners.', 0, 'epic', true, true, 'neon-drift'),
    ('frame',  'solar_forge',     'Solar Forge',             'A premium gold-ember frame that feels mechanical and rare without being noisy.', 0, 'legendary', true, true, 'neon-drift'),
    ('effect', 'soft_pulse',      'Soft Pulse',              'A restrained animated pulse that adds life without distracting from the avatar.', 0, 'rare', true, false, 'neon-drift'),
    ('effect', 'star_orbit',      'Star Orbit',              'Tiny orbiting highlights move around the profile photo for a more premium identity effect.', 0, 'epic', true, true, 'neon-drift'),
    ('effect', 'storm_field',     'Storm Field',             'A stronger dual-ring storm aura designed to feel special on public profile visits.', 0, 'legendary', true, true, 'neon-drift')
  on conflict (reward_type, reward_key) do update
    set display_name = excluded.display_name,
        description = excluded.description,
        amount_int = excluded.amount_int,
        rarity = excluded.rarity,
        is_evergreen = excluded.is_evergreen,
        is_premium_only = excluded.is_premium_only,
        season_theme_tag = excluded.season_theme_tag,
        active = true,
        updated_at = timezone('utc', now());

  insert into public.season_track_rewards (
    season_id,
    level_number,
    track_type,
    reward_catalog_id,
    quantity,
    sort_order
  )
  select
    v_season_id,
    lvl,
    'free',
    case
      when lvl = 5  then (select id from public.season_reward_catalog where reward_type = 'badge' and reward_key = 'founder_signal')
      when lvl = 10 then (select id from public.season_reward_catalog where reward_type = 'frame' and reward_key = 'ion_ring')
      when lvl = 15 then (select id from public.season_reward_catalog where reward_type = 'effect' and reward_key = 'soft_pulse')
      when lvl = 20 then (select id from public.season_reward_catalog where reward_type = 'badge' and reward_key = 'aerial_ace')
      when lvl = 25 then (select id from public.season_reward_catalog where reward_type = 'props' and reward_key = 'props_60')
      when lvl = 30 then (select id from public.season_reward_catalog where reward_type = 'theme' and reward_key = 'hypnos_violet')
      when mod(lvl, 4) = 0 then (select id from public.season_reward_catalog where reward_type = 'props' and reward_key = 'props_40')
      else (select id from public.season_reward_catalog where reward_type = 'props' and reward_key = 'props_25')
    end,
    1,
    lvl
  from generate_series(1, 30) as lvl
  on conflict (season_id, level_number, track_type) do update
    set reward_catalog_id = excluded.reward_catalog_id,
        quantity = excluded.quantity,
        sort_order = excluded.sort_order,
        updated_at = timezone('utc', now());

  insert into public.season_track_rewards (
    season_id,
    level_number,
    track_type,
    reward_catalog_id,
    quantity,
    sort_order
  )
  select
    v_season_id,
    lvl,
    'premium',
    case
      when lvl = 2  then (select id from public.season_reward_catalog where reward_type = 'frame' and reward_key = 'ion_ring')
      when lvl = 4  then (select id from public.season_reward_catalog where reward_type = 'effect' and reward_key = 'soft_pulse')
      when lvl = 6  then (select id from public.season_reward_catalog where reward_type = 'badge' and reward_key = 'midnight_orbit')
      when lvl = 8  then (select id from public.season_reward_catalog where reward_type = 'theme' and reward_key = 'hypnos_violet')
      when lvl = 12 then (select id from public.season_reward_catalog where reward_type = 'frame' and reward_key = 'violet_crown')
      when lvl = 16 then (select id from public.season_reward_catalog where reward_type = 'effect' and reward_key = 'star_orbit')
      when lvl = 20 then (select id from public.season_reward_catalog where reward_type = 'theme' and reward_key = 'aurora_teal')
      when lvl = 24 then (select id from public.season_reward_catalog where reward_type = 'frame' and reward_key = 'solar_forge')
      when lvl = 27 then (select id from public.season_reward_catalog where reward_type = 'effect' and reward_key = 'storm_field')
      when lvl = 30 then (select id from public.season_reward_catalog where reward_type = 'badge' and reward_key = 'season_zero')
      when mod(lvl, 5) = 0 then (select id from public.season_reward_catalog where reward_type = 'props' and reward_key = 'props_150')
      else (select id from public.season_reward_catalog where reward_type = 'props' and reward_key = 'props_60')
    end,
    1,
    lvl
  from generate_series(1, 30) as lvl
  on conflict (season_id, level_number, track_type) do update
    set reward_catalog_id = excluded.reward_catalog_id,
        quantity = excluded.quantity,
        sort_order = excluded.sort_order,
        updated_at = timezone('utc', now());
end
$$;

commit;
