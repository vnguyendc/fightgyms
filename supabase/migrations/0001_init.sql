-- fightgyms: initial schema
-- shared tables (places, sources, claims, submissions) + combat-sports gym tables.
-- run with: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
-- or: supabase db push

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- shared
-- ---------------------------------------------------------------------------

create table if not exists places (
  id          uuid primary key default gen_random_uuid(),
  state       char(2) not null,
  city        text not null,
  slug        text unique not null,        -- 'arlington-va'
  lat         double precision,
  lng         double precision,
  population  int,
  created_at  timestamptz default now(),
  unique (state, city)
);
create index if not exists places_state_idx on places (state);

-- every scraped / entered fact carries provenance
create table if not exists sources (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,               -- google_places | website | tapology | smoothcomp | sherdog | instagram | manual | user_submit
  url         text,
  fetched_at  timestamptz default now(),
  raw         jsonb                        -- always keep the raw payload
);
create index if not exists sources_kind_idx on sources (kind);

create table if not exists claims (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null default 'gym', -- gym (clinic later)
  entity_id   uuid not null,
  user_id     uuid references auth.users on delete set null,
  status      text not null default 'pending',  -- pending | verified | rejected
  plan        text not null default 'free',     -- free | premium
  created_at  timestamptz default now()
);
create index if not exists claims_entity_idx on claims (entity_type, entity_id);

create table if not exists submissions (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null default 'gym',
  entity_id      uuid,
  field          text not null,            -- 'prices' | 'classes' | 'website' | ...
  proposed_value jsonb not null,
  note           text,
  submitted_by   uuid references auth.users on delete set null,
  contact_email  text,
  status         text not null default 'pending',  -- pending | approved | rejected
  created_at     timestamptz default now()
);
create index if not exists submissions_status_idx on submissions (status);

-- ---------------------------------------------------------------------------
-- gyms
-- ---------------------------------------------------------------------------

create table if not exists gyms (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  styles          text[] not null default '{}',  -- muay_thai | kickboxing | dutch_kickboxing | boxing | mma | bjj | wrestling | judo
  place_id        uuid references places,
  address         text,
  lat             double precision,
  lng             double precision,
  website         text,
  instagram       text,
  phone           text,
  google_place_id text unique,
  google_rating   numeric(2,1),
  google_reviews  int,
  tapology_id     text,
  smoothcomp_id   text,
  affiliation     text,                   -- 'sitmonchai', 'tiger', null
  founded_year    int,
  tags            text[] not null default '{}',  -- beginner_friendly | fighter_gym | kids | womens | open_mat | thai_trainers
  description     text,
  claimed         bool not null default false,
  is_active       bool not null default true,
  is_sample       bool not null default false,   -- dev/demo rows, hidden in prod
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists gyms_place_idx on gyms (place_id);
create index if not exists gyms_styles_idx on gyms using gin (styles);
create index if not exists gyms_tags_idx on gyms using gin (tags);
create index if not exists gyms_name_trgm on gyms using gin (name gin_trgm_ops);

create table if not exists gym_prices (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references gyms on delete cascade,
  kind            text not null,           -- drop_in | monthly | fighter | trial | private | class_pack
  amount_cents    int,
  currency        text not null default 'usd',
  contract_months int,
  free_trial      bool,
  notes           text,
  source_id       uuid references sources,
  verified_at     date,
  verified_by     text                     -- website | phone | gym_claim | user_report
);
create index if not exists gym_prices_gym_idx on gym_prices (gym_id, kind, verified_at desc);

create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references gyms on delete cascade,
  dow         smallint not null check (dow between 0 and 6),  -- 0 = sunday
  start_time  time not null,
  end_time    time,
  name        text,
  level       text,                        -- beginner | all | advanced | fighters | kids
  style       text,
  source_id   uuid references sources,
  verified_at date
);
create index if not exists classes_gym_idx on classes (gym_id, dow, start_time);

create table if not exists coaches (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid references gyms on delete set null,
  slug        text unique not null,
  name        text not null,
  is_thai     bool,
  lineage     text,
  pro_record  text,
  instagram   text,
  bio         text
);

create table if not exists fighters (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  gym_id        uuid references gyms on delete set null,
  tapology_id   text,
  smoothcomp_id text,
  sherdog_id    text,
  discipline    text,                      -- muay_thai | kickboxing | mma | bjj | boxing
  level         text,                      -- amateur | pro
  weight_class  text,
  record_w      int default 0,
  record_l      int default 0,
  record_d      int default 0,
  last_bout     date,
  source_id     uuid references sources,
  updated_at    timestamptz default now()
);
create index if not exists fighters_gym_idx on fighters (gym_id, last_bout desc);

create table if not exists events (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,
  name                text not null,
  promotion           text,
  sanctioning_body    text,                -- usmta | wka | ikf | state_commission
  date                date,
  venue               text,
  place_id            uuid references places,
  url                 text,
  accepting_amateurs  bool,
  source_id           uuid references sources
);
create index if not exists events_date_idx on events (date);

-- ---------------------------------------------------------------------------
-- derived
-- ---------------------------------------------------------------------------

create materialized view if not exists gym_fighter_stats as
select
  gym_id,
  count(*)                                                        as total_fighters,
  count(*) filter (where last_bout > now() - interval '18 months') as active_fighters,
  count(*) filter (where level = 'pro')                           as pro_fighters,
  max(last_bout)                                                  as most_recent_bout
from fighters
where gym_id is not null
group by gym_id;
create unique index if not exists gym_fighter_stats_gym_idx on gym_fighter_stats (gym_id);

-- latest verified price per (gym, kind)
create or replace view gym_current_prices as
select distinct on (gym_id, kind)
  gym_id, kind, amount_cents, currency, contract_months, free_trial, notes, verified_at, verified_by
from gym_prices
order by gym_id, kind, verified_at desc nulls last;

-- one row per gym with everything a listing card needs
create or replace view gym_cards as
select
  g.id, g.slug, g.name, g.styles, g.tags, g.address, g.lat, g.lng,
  g.website, g.instagram, g.google_rating, g.google_reviews, g.claimed, g.is_sample,
  p.slug as place_slug, p.city, p.state,
  di.amount_cents as drop_in_cents,
  mo.amount_cents as monthly_cents,
  coalesce(fs.active_fighters, 0) as active_fighters,
  coalesce(fs.pro_fighters, 0)    as pro_fighters
from gyms g
left join places p on p.id = g.place_id
left join gym_current_prices di on di.gym_id = g.id and di.kind = 'drop_in'
left join gym_current_prices mo on mo.gym_id = g.id and mo.kind = 'monthly'
left join gym_fighter_stats fs on fs.gym_id = g.id
where g.is_active;

-- ---------------------------------------------------------------------------
-- housekeeping
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists gyms_updated_at on gyms;
create trigger gyms_updated_at before update on gyms
  for each row execute function set_updated_at();

create or replace function refresh_gym_fighter_stats() returns void language sql as $$
  refresh materialized view concurrently gym_fighter_stats;
$$;

-- ---------------------------------------------------------------------------
-- RLS: public read on directory data, writes via service role only.
-- claims/submissions: users can insert their own, read their own.
-- ---------------------------------------------------------------------------

alter table places      enable row level security;
alter table sources     enable row level security;
alter table gyms        enable row level security;
alter table gym_prices  enable row level security;
alter table classes     enable row level security;
alter table coaches     enable row level security;
alter table fighters    enable row level security;
alter table events      enable row level security;
alter table claims      enable row level security;
alter table submissions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['places','gyms','gym_prices','classes','coaches','fighters','events'] loop
    execute format('drop policy if exists %I_public_read on %I', t, t);
    execute format('create policy %I_public_read on %I for select using (true)', t, t);
  end loop;
end $$;

-- sources hold raw scrapes; not public
drop policy if exists sources_service_only on sources;

drop policy if exists claims_own on claims;
create policy claims_own on claims
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists submissions_insert_any on submissions;
create policy submissions_insert_any on submissions
  for insert with check (true);
drop policy if exists submissions_read_own on submissions;
create policy submissions_read_own on submissions
  for select using (auth.uid() = submitted_by);
