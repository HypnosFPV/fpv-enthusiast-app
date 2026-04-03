begin;

create table if not exists public.user_season_pass_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'cancelled')),
  purchase_amount_cents integer not null default 0 check (purchase_amount_cents >= 0),
  stripe_payment_intent text,
  purchased_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_season_pass_purchases_user_season_unique unique (user_id, season_id)
);

create unique index if not exists user_season_pass_purchases_pi_unique_idx
  on public.user_season_pass_purchases (stripe_payment_intent)
  where stripe_payment_intent is not null;

create index if not exists user_season_pass_purchases_user_created_idx
  on public.user_season_pass_purchases (user_id, created_at desc);

alter table public.user_season_pass_purchases enable row level security;

drop policy if exists "users read own season pass purchases"
  on public.user_season_pass_purchases;
create policy "users read own season pass purchases"
  on public.user_season_pass_purchases
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users insert own season pass purchases"
  on public.user_season_pass_purchases;
create policy "users insert own season pass purchases"
  on public.user_season_pass_purchases
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users update own season pass purchases"
  on public.user_season_pass_purchases;
create policy "users update own season pass purchases"
  on public.user_season_pass_purchases
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists trg_touch_user_season_pass_purchases_updated_at on public.user_season_pass_purchases;
create trigger trg_touch_user_season_pass_purchases_updated_at
before update on public.user_season_pass_purchases
for each row execute function public.touch_updated_at_column();

create or replace function public.award_season_xp_internal(
  p_user_id uuid,
  p_event_type text,
  p_xp_amount integer,
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
  v_actor_id uuid := p_user_id;
  v_season public.seasons;
  v_progress public.user_season_progress;
  v_previous_level integer := 0;
  v_next_level integer;
  v_inserted_id uuid;
begin
  if v_actor_id is null then
    raise exception 'user_id is required';
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
begin
  if v_actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_auth_role <> 'service_role' and auth.uid() is distinct from v_actor_id then
    raise exception 'Not authorized to award xp for another user';
  end if;

  return public.award_season_xp_internal(
    v_actor_id,
    p_event_type,
    p_xp_amount,
    p_reference_id,
    p_reference_subtype,
    p_awarded_on_date,
    p_metadata,
    p_season_id
  );
end;
$$;

grant execute on function public.award_season_xp_internal(uuid, text, integer, text, text, date, jsonb, uuid) to service_role;
grant execute on function public.award_season_xp(uuid, text, integer, text, text, date, jsonb, uuid) to authenticated, service_role;

create or replace function public.trg_season_xp_on_post_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_season_xp_internal(
    new.user_id,
    'feed_post_created',
    20,
    new.id::text,
    'post',
    current_date,
    jsonb_build_object('post_scope', coalesce(new.post_scope, 'public')),
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_post_created on public.posts;
create trigger trg_season_xp_on_post_created
after insert on public.posts
for each row execute function public.trg_season_xp_on_post_created();

create or replace function public.trg_season_xp_on_comment_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_owner uuid;
begin
  perform public.award_season_xp_internal(
    new.user_id,
    'feed_comment_created',
    6,
    new.id::text,
    'comment',
    current_date,
    jsonb_build_object('post_id', new.post_id, 'parent_id', new.parent_id),
    null
  );

  select user_id into v_post_owner
  from public.posts
  where id = new.post_id;

  if v_post_owner is not null and v_post_owner <> new.user_id then
    perform public.award_season_xp_internal(
      v_post_owner,
      'feed_comment_received',
      4,
      new.id::text,
      new.user_id::text,
      current_date,
      jsonb_build_object('post_id', new.post_id, 'commenter_id', new.user_id),
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_comment_created on public.comments;
create trigger trg_season_xp_on_comment_created
after insert on public.comments
for each row execute function public.trg_season_xp_on_comment_created();

create or replace function public.trg_season_xp_on_like_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_owner uuid;
begin
  select user_id into v_post_owner
  from public.posts
  where id = new.post_id;

  if v_post_owner is not null and v_post_owner <> new.user_id then
    perform public.award_season_xp_internal(
      v_post_owner,
      'feed_like_received',
      2,
      new.post_id::text,
      new.user_id::text,
      current_date,
      jsonb_build_object('post_id', new.post_id, 'liker_id', new.user_id),
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_like_created on public.likes;
create trigger trg_season_xp_on_like_created
after insert on public.likes
for each row execute function public.trg_season_xp_on_like_created();

create or replace function public.trg_season_xp_on_comment_like_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment_owner uuid;
begin
  select user_id into v_comment_owner
  from public.comments
  where id = new.comment_id;

  if v_comment_owner is not null and v_comment_owner <> new.user_id then
    perform public.award_season_xp_internal(
      v_comment_owner,
      'comment_like_received',
      1,
      new.comment_id::text,
      new.user_id::text,
      current_date,
      jsonb_build_object('comment_id', new.comment_id, 'liker_id', new.user_id),
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_comment_like_created on public.comment_likes;
create trigger trg_season_xp_on_comment_like_created
after insert on public.comment_likes
for each row execute function public.trg_season_xp_on_comment_like_created();

create or replace function public.trg_season_xp_on_listing_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_season_xp_internal(
    new.seller_id,
    'marketplace_listing_created',
    20,
    new.id::text,
    'listing',
    current_date,
    jsonb_build_object('category', new.category, 'listing_type', new.listing_type),
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_listing_created on public.marketplace_listings;
create trigger trg_season_xp_on_listing_created
after insert on public.marketplace_listings
for each row execute function public.trg_season_xp_on_listing_created();

create or replace function public.trg_season_xp_on_challenge_entry_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_season_xp_internal(
    new.pilot_id,
    'challenge_entry_submitted',
    40,
    new.id::text,
    coalesce(new.challenge_id::text, 'challenge'),
    current_date,
    jsonb_build_object('challenge_id', new.challenge_id),
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_challenge_entry_created on public.challenge_entries;
create trigger trg_season_xp_on_challenge_entry_created
after insert on public.challenge_entries
for each row execute function public.trg_season_xp_on_challenge_entry_created();

create or replace function public.trg_season_xp_on_challenge_vote_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_season_xp_internal(
    new.voter_id,
    'challenge_vote_cast',
    8,
    coalesce(new.challenge_id::text, new.entry_id::text),
    new.entry_id::text,
    current_date,
    jsonb_build_object('challenge_id', new.challenge_id, 'entry_id', new.entry_id),
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_season_xp_on_challenge_vote_created on public.challenge_votes;
create trigger trg_season_xp_on_challenge_vote_created
after insert on public.challenge_votes
for each row execute function public.trg_season_xp_on_challenge_vote_created();

commit;
