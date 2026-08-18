-- =====================================================================
-- Colombia earthquake missing/found board — full Supabase setup
-- Safe to re-run: uses "if not exists" / "drop policy if exists" so
-- running this again won't error if some pieces already exist.
--
-- BEFORE RUNNING: create the storage bucket in the dashboard first.
--   Storage -> New bucket -> name it exactly "photos" -> toggle
--   "Public bucket" ON -> Create bucket.
-- Then come back here and run this whole script.
-- =====================================================================

-- 1. Table holding every report
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'missing',
  name text not null,
  age text,
  municipio text,
  barrio text,
  last_seen_date text,
  description text,
  medical_notes text,
  reporter_contact text,
  relationship text,
  photo_url text,
  updates jsonb not null default '[]'::jsonb
);

-- 2. Row Level Security on the reports table.
--    This app has no login system, so anyone using the app can
--    read/insert/update. Fine for a trusted-group tool; not meant
--    for a fully open, unmoderated public audience.
alter table reports enable row level security;

drop policy if exists "Public can read reports" on reports;
create policy "Public can read reports"
  on reports for select
  using (true);

drop policy if exists "Public can insert reports" on reports;
create policy "Public can insert reports"
  on reports for insert
  with check (true);

drop policy if exists "Public can update reports" on reports;
create policy "Public can update reports"
  on reports for update
  using (true);

-- 3. Realtime: lets everyone's app auto-refresh when someone else
--    adds a report or updates a status, without a page reload.
--    Skips silently if it's already added.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table reports;
  end if;
end $$;

-- 4. Storage policies for the "photos" bucket.
--    Requires the bucket to already exist (create it in the
--    dashboard first — see note at the top of this file).
drop policy if exists "Public can upload photos" on storage.objects;
create policy "Public can upload photos"
  on storage.objects for insert
  with check (bucket_id = 'photos');

drop policy if exists "Public can view photos" on storage.objects;
create policy "Public can view photos"
  on storage.objects for select
  using (bucket_id = 'photos');

-- =====================================================================
-- Done. To verify everything is in place, you can run:
--
--   select policyname, cmd from pg_policies
--   where tablename in ('reports', 'objects');
--
-- You should see 3 policies on "reports" and 2 on "objects".
-- =====================================================================
