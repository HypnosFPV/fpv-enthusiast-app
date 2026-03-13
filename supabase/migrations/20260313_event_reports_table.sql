-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: event_reports table
-- Purpose  : Allow users to flag fraudulent, inaccurate, or inappropriate
--            community events.  Mirrors the structure of spot_reports.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.event_reports (
  id           uuid        primary key default gen_random_uuid(),
  event_id     uuid        not null references public.race_events(id) on delete cascade,
  reporter_id  uuid        not null references auth.users(id)         on delete cascade,
  reason       text        not null
                           check (reason in (
                             'wrong_type',
                             'does_not_exist',
                             'spam',
                             'offensive_name',
                             'fake_event',
                             'wrong_date',
                             'other'
                           )),
  details      text,
  created_at   timestamptz not null default now(),

  -- One report per user per event
  unique (event_id, reporter_id)
);

-- Index for admin queries: "all reports for event X"
create index if not exists idx_event_reports_event_id
  on public.event_reports (event_id);

-- Index for moderation queries: "all reports by user Y"
create index if not exists idx_event_reports_reporter_id
  on public.event_reports (reporter_id);

-- Row-level security ──────────────────────────────────────────────────────────
alter table public.event_reports enable row level security;

-- Any authenticated user may insert their own report
create policy "Users can insert own event reports"
  on public.event_reports for insert
  with check (auth.uid() = reporter_id);

-- Users can only read their own reports (admins use service role)
create policy "Users can read own event reports"
  on public.event_reports for select
  using (auth.uid() = reporter_id);

-- Only service-role / admins may update or delete
-- (no policy = default deny for update/delete from client)
