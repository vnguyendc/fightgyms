-- founding featured listings. requires 0008. do not re-run 0008 after this:
-- create or replace cannot drop the columns added here.
-- visitors never write these columns. set them in the sql editor:
--   update gyms set featured = true, featured_until = date '2027-11-19' where slug = '<slug>';
--   update gyms set featured = false where slug = '<slug>';
-- featured_until is the last day the placement is shown, inclusive, in America/New_York.
-- null featured_until means no end date while featured is true.
-- the site hides a row once that date has passed; this view still returns the raw flag and date.
alter table gyms add column if not exists featured boolean not null default false;
alter table gyms add column if not exists featured_until date;
create index if not exists gyms_featured_idx on gyms (featured_until) where featured;

create or replace view gym_cards as
select
  g.id, g.slug, g.name, g.styles, g.tags, g.address, g.lat, g.lng,
  g.website, g.instagram, g.google_rating, g.google_reviews, g.claimed, g.is_sample,
  p.slug as place_slug, p.city, p.state,
  di.amount_cents as drop_in_cents,
  mo.amount_cents as monthly_cents,
  coalesce(fs.active_fighters, 0) as active_fighters,
  coalesce(fs.pro_fighters, 0)    as pro_fighters,
  ph.storage_path as photo_path,
  tr.amount_cents as trial_cents,
  coalesce(cc.n, 0)::int as class_count,
  greatest(pv.verified_at, cc.verified_at, g.owner_updated_at::date) as last_verified_at,
  g.featured,
  g.featured_until
from gyms g
left join places p on p.id = g.place_id
left join gym_current_prices di on di.gym_id = g.id and di.kind = 'drop_in'
left join gym_current_prices mo on mo.gym_id = g.id and mo.kind = 'monthly'
left join gym_current_prices tr on tr.gym_id = g.id and tr.kind = 'trial'
left join gym_fighter_stats fs on fs.gym_id = g.id
left join lateral (
  select storage_path from gym_photos x
  where x.gym_id = g.id and x.is_active
  order by x.is_primary desc, x.sort_order, x.created_at
  limit 1
) ph on true
left join lateral (
  select count(*) as n, max(c.verified_at) as verified_at from classes c where c.gym_id = g.id
) cc on true
left join lateral (
  select max(x.verified_at) as verified_at from gym_prices x where x.gym_id = g.id
) pv on true
where g.is_active;
