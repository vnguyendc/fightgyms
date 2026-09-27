-- fightgyms: gym social profiles
-- one active row per (gym, platform), found on the gym's own website by scrapers/fetch_photos.py
-- or added by a verified claimant. rows are never deleted; is_active=false hides them.
-- run with: cd scrapers && python run_sql.py ../supabase/migrations/0006_socials.sql

create table if not exists gym_socials (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references gyms on delete cascade,
  platform    text not null,               -- instagram | facebook | tiktok | youtube | x
  url         text not null,               -- canonical profile url
  handle      text,                        -- display handle without @, when the platform has one
  credit      text not null default 'website',  -- website | gym_claim | manual
  source_url  text,                        -- page the link was found on
  source_id   uuid references sources,
  is_active   bool not null default true,
  created_at  timestamptz default now()
);
create index if not exists gym_socials_gym_idx on gym_socials (gym_id, is_active);
-- one live link per platform; a re-run keeps the existing one (insert ... on conflict do nothing)
create unique index if not exists gym_socials_active_idx on gym_socials (gym_id, platform) where is_active;

-- ---------------------------------------------------------------------------
-- RLS: public read; verified claimants may add/update links on their gym (has_verified_claim is in 0002).
-- scrapers write with the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table gym_socials enable row level security;

drop policy if exists gym_socials_public_read on gym_socials;
create policy gym_socials_public_read on gym_socials for select using (true);

drop policy if exists gym_socials_claimant_insert on gym_socials;
create policy gym_socials_claimant_insert on gym_socials
  for insert to authenticated
  with check (credit = 'gym_claim' and has_verified_claim(gym_id));

drop policy if exists gym_socials_claimant_update on gym_socials;
create policy gym_socials_claimant_update on gym_socials
  for update to authenticated
  using (has_verified_claim(gym_id)) with check (has_verified_claim(gym_id));
