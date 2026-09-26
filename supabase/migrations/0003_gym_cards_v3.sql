-- fightgyms: gym_cards v3
-- appends trial_cents (latest verified trial/intro price) and class_count (schedule rows).
-- rebuilt with drop, not replace, so the column set matches this file exactly (same as 0002).
-- run with: cd scrapers && .venv/bin/python run_sql.py ../supabase/migrations/0003_gym_cards_v3.sql
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
  ph.storage_path as photo_path,
  tr.amount_cents as trial_cents,
  coalesce(cc.n, 0)::int as class_count
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
  select count(*) as n from classes c where c.gym_id = g.id
) cc on true
where g.is_active;
