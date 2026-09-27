-- fightgyms: gym claims
-- claims: a signed-in user inserts pending rows for themselves only; the reviewer sets status as postgres.
-- submissions: 0004's policy plus the new_gym field (signed-in submitter, no entity) and a shape check.
-- no new tables. run with: cd scrapers && .venv/bin/python run_sql.py ../supabase/migrations/0005_claims.sql

alter table claims
  add column if not exists role          text,
  add column if not exists note          text,
  add column if not exists contact_email text,
  add column if not exists website_host  text,
  add column if not exists domain_match  bool not null default false,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists updated_at    timestamptz default now();

alter table claims drop constraint if exists claims_status_check;
alter table claims add constraint claims_status_check check (status in ('pending', 'verified', 'rejected'));
alter table claims drop constraint if exists claims_plan_check;
alter table claims add constraint claims_plan_check check (plan in ('free', 'premium'));
alter table claims drop constraint if exists claims_role_check;
alter table claims add constraint claims_role_check check (role is null or role in ('owner', 'manager', 'coach', 'other'));
alter table claims drop constraint if exists claims_note_check;
alter table claims add constraint claims_note_check check (note is null or length(note) <= 1000);
-- one open claim per user per gym; a rejected owner can file again
create unique index if not exists claims_open_per_user_gym on claims (entity_type, entity_id, user_id) where status <> 'rejected';

-- rls: own rows to read, pending own rows to insert, nothing else for users
drop policy if exists claims_own on claims;
drop policy if exists claims_select_own on claims;
create policy claims_select_own on claims
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists claims_insert_pending on claims;
create policy claims_insert_pending on claims
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and status = 'pending' and plan = 'free' and entity_type = 'gym' and reviewed_at is null
    and exists (select 1 from gyms g where g.id = entity_id and g.is_active and not g.is_sample)
  );

-- stamp the verified email and the domain hint; the form never supplies contact_email for signed-in inserts
create or replace function claims_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.contact_email := auth.jwt() ->> 'email';
  end if;
  select lower(regexp_replace(substring(g.website from '^[A-Za-z]+://([^/:?#]+)'), '^www\.', ''))
    into new.website_host from gyms g where g.id = new.entity_id;
  new.domain_match := new.website_host is not null and new.contact_email is not null
    and lower(split_part(new.contact_email, '@', 2)) = new.website_host;
  return new;
end $$;
drop trigger if exists claims_stamp on claims;
create trigger claims_stamp before insert on claims for each row execute function claims_stamp();

create or replace function claims_touch() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then new.reviewed_at := now(); end if;
  return new;
end $$;
drop trigger if exists claims_touch on claims;
create trigger claims_touch before update on claims for each row execute function claims_touch();

-- gyms.claimed follows verified claims; a pending insert never touches gyms
create or replace function claims_sync_gym() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'verified' or (tg_op = 'UPDATE' and old.status = 'verified') then
    update gyms set claimed = exists (
      select 1 from claims c where c.entity_type = 'gym' and c.entity_id = new.entity_id and c.status = 'verified'
    ) where id = new.entity_id;
  end if;
  return new;
end $$;
drop trigger if exists claims_sync_gym on claims;
create trigger claims_sync_gym after insert or update of status on claims for each row execute function claims_sync_gym();

-- submissions: 0004's policy with new_gym added
drop policy if exists submissions_insert_any on submissions;
create policy submissions_insert_any on submissions
  for insert with check (
    status = 'pending'
    and entity_type = 'gym'
    and field in ('trial_price', 'drop_in_price', 'monthly_price', 'website', 'other', 'new_gym')
    and (submitted_by is null or submitted_by = auth.uid())
    and (field <> 'new_gym' or (submitted_by is not null and entity_id is null))
    and coalesce(length(note), 0) <= 1000
    and coalesce(length(contact_email), 0) <= 254
    and pg_column_size(proposed_value) <= 4096
  );
alter table submissions drop constraint if exists submissions_new_gym_shape;
alter table submissions add constraint submissions_new_gym_shape check ((field = 'new_gym') = (entity_id is null));

create or replace function submissions_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.contact_email := auth.jwt() ->> 'email';
  end if;
  return new;
end $$;
drop trigger if exists submissions_stamp on submissions;
create trigger submissions_stamp before insert on submissions for each row execute function submissions_stamp();

-- reviewer views: security invoker, not for the data api
create or replace view claim_review with (security_invoker = true) as
select c.*, g.slug as gym_slug, g.name as gym_name, g.website as gym_website
from claims c join gyms g on g.id = c.entity_id;
revoke all on claim_review from anon, authenticated;

create or replace view submission_review with (security_invoker = true) as
select s.*, g.slug as gym_slug, g.name as gym_name,
  exists (
    select 1 from claims c
    where c.user_id = s.submitted_by and c.entity_type = 'gym' and c.entity_id = s.entity_id and c.status = 'verified'
  ) as from_verified_claimant
from submissions s left join gyms g on g.id = s.entity_id;
revoke all on submission_review from anon, authenticated;
