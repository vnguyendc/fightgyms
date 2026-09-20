-- Dev/demo seed. Every gym is fictional and flagged is_sample = true.
-- The web app hides is_sample rows unless SHOW_SAMPLE=1.
-- psql "$DATABASE_URL" -f supabase/seed.sql

insert into places (state, city, slug, lat, lng, population) values
  ('VA', 'Arlington',     'arlington-va',     38.8816, -77.0910, 238000),
  ('VA', 'Alexandria',    'alexandria-va',    38.8048, -77.0469, 159000),
  ('VA', 'Fairfax',       'fairfax-va',       38.8462, -77.3064,  24000),
  ('VA', 'Vienna',        'vienna-va',        38.9012, -77.2653,  16000),
  ('DC', 'Washington',    'washington-dc',    38.9072, -77.0369, 690000),
  ('MD', 'Silver Spring', 'silver-spring-md', 38.9907, -77.0261,  81000)
on conflict (state, city) do nothing;

with p as (select id, slug from places)
insert into gyms (slug, name, styles, place_id, address, lat, lng, website, instagram, phone, google_rating, google_reviews, affiliation, founded_year, tags, description, claimed, is_sample)
values
  ('sample-siam-strike-arlington-va', 'Siam Strike Muay Thai', '{muay_thai,kickboxing}', (select id from p where slug='arlington-va'),
   '1200 Sample Blvd, Arlington, VA 22201', 38.8895, -77.0870, 'https://example.com/siamstrike', 'siamstrike', '(703) 555-0101', 4.9, 212, null, 2014,
   '{beginner_friendly,fighter_gym,thai_trainers}', 'Traditional Thai-run gym with a fundamentals track and an active amateur fight team.', true, true),
  ('sample-capital-fight-lab-washington-dc', 'Capital Fight Lab', '{muay_thai,mma,bjj}', (select id from p where slug='washington-dc'),
   '450 Sample St NW, Washington, DC 20001', 38.9010, -77.0200, 'https://example.com/capitalfightlab', 'capitalfightlab', '(202) 555-0102', 4.7, 340, null, 2011,
   '{fighter_gym,open_mat}', 'Hybrid MMA gym. Muay thai mornings and evenings, BJJ and wrestling in between, pro fighters on the mat.', true, true),
  ('sample-eight-limbs-alexandria-va', 'Eight Limbs Alexandria', '{muay_thai}', (select id from p where slug='alexandria-va'),
   '77 Sample Ave, Alexandria, VA 22314', 38.8060, -77.0500, 'https://example.com/eightlimbs', 'eightlimbsalx', '(703) 555-0103', 4.8, 98, null, 2019,
   '{beginner_friendly,womens,kids}', 'Boutique muay thai studio with small classes, a women-only track, and kids programs.', false, true),
  ('sample-nova-kickboxing-fairfax-va', 'NoVA Kickboxing & Muay Thai', '{kickboxing,muay_thai,boxing}', (select id from p where slug='fairfax-va'),
   '9000 Sample Pkwy, Fairfax, VA 22031', 38.8600, -77.3000, 'https://example.com/novakick', 'novakickboxing', '(703) 555-0104', 4.6, 155, null, 2008,
   '{beginner_friendly}', 'Dutch-style kickboxing with a muay thai clinch class twice a week.', false, true),
  ('sample-vienna-muay-thai-vienna-va', 'Vienna Muay Thai Academy', '{muay_thai}', (select id from p where slug='vienna-va'),
   '300 Sample Ln SE, Vienna, VA 22180', 38.8990, -77.2600, 'https://example.com/viennamt', 'viennamuaythai', '(703) 555-0105', 5.0, 41, 'sitmonchai', 2022,
   '{beginner_friendly,thai_trainers}', 'Small Sitmonchai-affiliated gym. Two Thai trainers, strong on fundamentals.', true, true),
  ('sample-silver-spring-fight-club-silver-spring-md', 'Silver Spring Fight Club', '{mma,muay_thai,bjj,wrestling}', (select id from p where slug='silver-spring-md'),
   '8500 Sample Rd, Silver Spring, MD 20910', 38.9950, -77.0300, 'https://example.com/ssfc', 'ssfightclub', '(301) 555-0106', 4.5, 267, null, 2012,
   '{fighter_gym,open_mat,kids}', 'Fight-team-first MMA gym. Muay thai program feeds the amateur MMA roster.', false, true)
on conflict (slug) do nothing;

-- prices (verified_by=manual so the badge reads well in the demo)
with g as (select id, slug from gyms where is_sample)
insert into gym_prices (gym_id, kind, amount_cents, contract_months, free_trial, notes, verified_at, verified_by)
select id, v.kind, v.cents, v.months, v.trial, v.notes, current_date, 'manual' from g
join lateral (values
  ('sample-siam-strike-arlington-va',        'drop_in', 3000, null, null, null),
  ('sample-siam-strike-arlington-va',        'monthly', 17900, 12, true, 'first class free'),
  ('sample-siam-strike-arlington-va',        'fighter', 9900, null, null, 'fight team rate, coach approval'),
  ('sample-capital-fight-lab-washington-dc', 'drop_in', 3500, null, null, null),
  ('sample-capital-fight-lab-washington-dc', 'monthly', 21900, 6, false, null),
  ('sample-eight-limbs-alexandria-va',       'drop_in', 2500, null, null, null),
  ('sample-eight-limbs-alexandria-va',       'monthly', 15900, 0, true, 'month to month'),
  ('sample-nova-kickboxing-fairfax-va',      'drop_in', 2000, null, null, null),
  ('sample-nova-kickboxing-fairfax-va',      'monthly', 13900, 12, true, null),
  ('sample-vienna-muay-thai-vienna-va',      'drop_in', 2500, null, null, null),
  ('sample-vienna-muay-thai-vienna-va',      'monthly', 16500, 0, true, null),
  ('sample-silver-spring-fight-club-silver-spring-md', 'drop_in', 3000, null, null, null),
  ('sample-silver-spring-fight-club-silver-spring-md', 'monthly', 18900, 12, false, null)
) as v(slug, kind, cents, months, trial, notes) on v.slug = g.slug;

-- a week of classes for two gyms
with g as (select id from gyms where slug = 'sample-siam-strike-arlington-va')
insert into classes (gym_id, dow, start_time, end_time, name, level, style, verified_at)
select id, d, s::time, e::time, n, l, 'muay_thai', current_date from g, (values
  (1, '06:30', '07:30', 'Morning Muay Thai', 'all'),
  (1, '18:00', '19:00', 'Fundamentals', 'beginner'),
  (1, '19:00', '20:30', 'Fight Team', 'fighters'),
  (2, '18:00', '19:00', 'Muay Thai All Levels', 'all'),
  (3, '06:30', '07:30', 'Morning Muay Thai', 'all'),
  (3, '18:00', '19:00', 'Fundamentals', 'beginner'),
  (3, '19:00', '20:30', 'Fight Team', 'fighters'),
  (4, '18:00', '19:00', 'Clinch & Sparring', 'advanced'),
  (5, '18:00', '19:00', 'Muay Thai All Levels', 'all'),
  (6, '10:00', '11:30', 'Open Mat / Sparring', 'advanced')
) as v(d, s, e, n, l);

with g as (select id from gyms where slug = 'sample-eight-limbs-alexandria-va')
insert into classes (gym_id, dow, start_time, end_time, name, level, style, verified_at)
select id, d, s::time, e::time, n, l, 'muay_thai', current_date from g, (values
  (1, '17:30', '18:30', 'Beginner Muay Thai', 'beginner'),
  (1, '18:30', '19:30', 'Women''s Muay Thai', 'all'),
  (2, '17:30', '18:30', 'All Levels', 'all'),
  (3, '17:30', '18:30', 'Beginner Muay Thai', 'beginner'),
  (4, '17:30', '18:30', 'All Levels', 'all'),
  (6, '09:00', '10:00', 'Kids Muay Thai', 'kids'),
  (6, '10:00', '11:00', 'All Levels', 'all')
) as v(d, s, e, n, l);

-- coaches
with g as (select id, slug from gyms where is_sample)
insert into coaches (gym_id, slug, name, is_thai, lineage, pro_record)
select id, v.cslug, v.name, v.thai, v.lineage, v.rec from g join lateral (values
  ('sample-siam-strike-arlington-va', 'sample-kru-somchai', 'Kru Somchai', true, 'Fought out of a Bangkok stadium gym for 12 years', '112-30-4'),
  ('sample-siam-strike-arlington-va', 'sample-coach-danny-r', 'Danny R.', false, 'Student of Kru Somchai since 2014', '8-2-0 (am)'),
  ('sample-vienna-muay-thai-vienna-va', 'sample-kru-nok', 'Kru Nok', true, 'Sitmonchai camp', '80-25-2'),
  ('sample-capital-fight-lab-washington-dc', 'sample-coach-marcus-t', 'Marcus T.', false, 'Former regional MMA champion', '14-5-0 (pro)')
) as v(slug, cslug, name, thai, lineage, rec) on v.slug = g.slug
on conflict (slug) do nothing;

-- fighters (drives the fighter-gym ranking)
with g as (select id, slug from gyms where is_sample)
insert into fighters (slug, name, gym_id, discipline, level, weight_class, record_w, record_l, record_d, last_bout)
select v.fslug, v.name, g.id, v.disc, v.level, v.wc, v.w, v.l, v.d, v.last from g join lateral (values
  ('sample-siam-strike-arlington-va', 'sample-fighter-a1', 'A. Nguyen', 'muay_thai', 'amateur', '147', 6, 1, 0, current_date - 40),
  ('sample-siam-strike-arlington-va', 'sample-fighter-a2', 'J. Park',   'muay_thai', 'amateur', '135', 3, 2, 0, current_date - 90),
  ('sample-siam-strike-arlington-va', 'sample-fighter-a3', 'M. Reyes',  'muay_thai', 'pro',     '155', 9, 3, 0, current_date - 20),
  ('sample-capital-fight-lab-washington-dc', 'sample-fighter-b1', 'T. Okafor', 'mma', 'pro', '170', 11, 4, 0, current_date - 60),
  ('sample-capital-fight-lab-washington-dc', 'sample-fighter-b2', 'L. Chen',   'mma', 'amateur', '145', 4, 0, 0, current_date - 15),
  ('sample-capital-fight-lab-washington-dc', 'sample-fighter-b3', 'R. Diaz',   'muay_thai', 'amateur', '160', 2, 1, 0, current_date - 200),
  ('sample-silver-spring-fight-club-silver-spring-md', 'sample-fighter-c1', 'K. Mensah', 'mma', 'amateur', '185', 5, 2, 0, current_date - 30),
  ('sample-silver-spring-fight-club-silver-spring-md', 'sample-fighter-c2', 'D. Ali',    'mma', 'pro',     '155', 7, 6, 1, current_date - 400),
  ('sample-vienna-muay-thai-vienna-va', 'sample-fighter-d1', 'P. Tran', 'muay_thai', 'amateur', '125', 1, 0, 0, current_date - 10)
) as v(slug, fslug, name, disc, level, wc, w, l, d, last) on v.slug = g.slug
on conflict (slug) do nothing;

-- events
insert into events (slug, name, promotion, sanctioning_body, date, venue, place_id, url, accepting_amateurs)
select 'sample-dmv-fight-night-12', 'DMV Fight Night 12', 'Sample Promotions', 'usmta', current_date + 21, 'Sample Arena, Fairfax, VA', id, 'https://example.com/dfn12', true
from places where slug = 'fairfax-va'
on conflict (slug) do nothing;

refresh materialized view gym_fighter_stats;
