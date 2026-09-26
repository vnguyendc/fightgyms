-- fightgyms: gym photos
-- photos live in the public storage bucket `gym-photos` under <gym_id>/<hash>.webp.
-- rows are never deleted; is_active=false hides them.
-- run with: cd scrapers && python run_sql.py ../supabase/migrations/0002_photos.sql

-- ---------------------------------------------------------------------------
-- drift: the live db grew an uncommitted google-places-shaped gym_photos table
-- (url, position, author_*, google_maps_uri) and a hero_url column on gym_cards.
-- that design was dropped (places photos can't be stored). keep its rows under a
-- legacy name; the view is rebuilt below from this file's definition.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'gym_photos')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_photos' and column_name = 'storage_path')
  then
    alter table gym_photos rename to gym_photos_legacy_places;
  end if;
end $$;

create table if not exists gym_photos (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references gyms on delete cascade,
  storage_path  text not null unique,     -- '<gym_id>/<sha1-16>.webp' in bucket gym-photos
  width         int,
  height        int,
  alt           text,
  credit        text not null default 'website',  -- website | gym_claim
  source_url    text,                     -- original image url, if scraped
  source_id     uuid references sources,
  is_primary    bool not null default false,
  sort_order    smallint not null default 0,
  is_active     bool not null default true,
  created_at    timestamptz default now()
);
create index if not exists gym_photos_gym_idx on gym_photos (gym_id, is_active, sort_order);
-- at most one primary per gym
create unique index if not exists gym_photos_primary_idx on gym_photos (gym_id) where is_primary and is_active;

-- gym_cards: rebuilt (drop, not replace) so the column set matches this definition exactly.
-- appends photo_path: primary, else first active by sort_order.
drop view if exists gym_cards;
create view gym_cards as
select
  g.id, g.slug, g.name, g.styles, g.tags, g.address, g.lat, g.lng,
  g.website, g.instagram, g.google_rating, g.google_reviews, g.claimed, g.is_sample,
  p.slug as place_slug, p.city, p.state,
  di.amount_cents as drop_in_cents,
  mo.amount_cents as monthly_cents,
  coalesce(fs.active_fighters, 0) as active_fighters,
  coalesce(fs.pro_fighters, 0)    as pro_fighters,
  ph.storage_path as photo_path
from gyms g
left join places p on p.id = g.place_id
left join gym_current_prices di on di.gym_id = g.id and di.kind = 'drop_in'
left join gym_current_prices mo on mo.gym_id = g.id and mo.kind = 'monthly'
left join gym_fighter_stats fs on fs.gym_id = g.id
left join lateral (
  select storage_path from gym_photos x
  where x.gym_id = g.id and x.is_active
  order by x.is_primary desc, x.sort_order, x.created_at
  limit 1
) ph on true
where g.is_active;

-- ---------------------------------------------------------------------------
-- RLS: public read; verified claimants may add/update photos on their gym.
-- scrapers write with the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table gym_photos enable row level security;

drop policy if exists gym_photos_public_read on gym_photos;
create policy gym_photos_public_read on gym_photos for select using (true);

create or replace function has_verified_claim(gym uuid) returns bool
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from claims c
    where c.user_id = auth.uid() and c.status = 'verified'
      and c.entity_type = 'gym' and c.entity_id = gym
  )
$$;

drop policy if exists gym_photos_claimant_insert on gym_photos;
create policy gym_photos_claimant_insert on gym_photos
  for insert to authenticated
  with check (credit = 'gym_claim' and has_verified_claim(gym_id));

drop policy if exists gym_photos_claimant_update on gym_photos;
create policy gym_photos_claimant_update on gym_photos
  for update to authenticated
  using (has_verified_claim(gym_id)) with check (has_verified_claim(gym_id));

-- ---------------------------------------------------------------------------
-- storage bucket + object policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-photos', 'gym-photos', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists gym_photos_objects_public_read on storage.objects;
create policy gym_photos_objects_public_read on storage.objects
  for select using (bucket_id = 'gym-photos');

-- claimants may upload only under their own gym's folder
drop policy if exists gym_photos_objects_claimant_insert on storage.objects;
create policy gym_photos_objects_claimant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gym-photos'
    and has_verified_claim(((storage.foldername(name))[1])::uuid)
  );
