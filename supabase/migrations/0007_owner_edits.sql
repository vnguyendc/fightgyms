-- verified owner editing. apply this migration before deploying the editor; no claim is auto-verified.
begin;

alter table public.gyms add column owner_updated_at timestamptz;
-- dates alone cannot order successive owner edits on the same day. keep all existing price rows.
alter table public.gym_prices
  add column recorded_at timestamptz not null default clock_timestamp(),
  add column revision bigint generated always as identity;
create or replace view public.gym_current_prices as
select distinct on (gym_id, kind)
  gym_id, kind, amount_cents, currency, contract_months, free_trial, notes, verified_at, verified_by, source_id
from public.gym_prices
order by gym_id, kind, verified_at desc nulls last, recorded_at desc, revision desc;

create table public.gym_owner_edits (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms,
  actor_id uuid not null, -- retained even if an auth account is removed
  claim_id uuid not null references public.claims,
  source_id uuid not null references public.sources,
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index gym_owner_edits_gym_created on public.gym_owner_edits (gym_id, created_at desc);
alter table public.gym_owner_edits enable row level security;
revoke all on public.gym_owner_edits from public, anon, authenticated;
grant select on public.gym_owner_edits to service_role;

create function public.gym_owner_edits_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'owner audit is append-only';
end $$;
revoke all on function public.gym_owner_edits_immutable() from public, anon, authenticated;
create trigger gym_owner_edits_immutable before update or delete on public.gym_owner_edits
for each row execute function public.gym_owner_edits_immutable();

-- the only new write privilege is execution of this bounded, atomic operation.
-- lock the claim before the gym, matching reviewer updates through claims_sync_gym.
-- a revocation committed before the lock is acquired prevents the edit; a later revocation waits.
create function public.edit_owned_gym(p_slug text, p_changes jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  claim uuid;
  g public.gyms%rowtype;
  source uuid;
  before_value jsonb;
  after_value jsonb;
  k text;
  v jsonb;
  s text;
  price_value int;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,120}$'
     or p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb or octet_length(p_changes::text) > 8192 then
    raise exception 'invalid owner edit' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_changes) loop
    if k not in ('name', 'address', 'website', 'phone', 'description', 'prices') then
      raise exception 'invalid owner edit' using errcode = '22023';
    end if;
    if k = 'prices' then
      if jsonb_typeof(v) <> 'object' then raise exception 'invalid owner edit' using errcode = '22023'; end if;
    else
      if jsonb_typeof(v) not in ('string', 'null') or (k = 'name' and jsonb_typeof(v) <> 'string') then
        raise exception 'invalid owner edit' using errcode = '22023';
      end if;
      s := p_changes ->> k;
      if s is not null and (
        s <> btrim(s) or length(s) < 1
        or length(s) > case k when 'name' then 160 when 'address' then 240 when 'website' then 500 when 'phone' then 40 else 2000 end
        or (k <> 'description' and s ~ '[[:cntrl:]]')
        or (k = 'description' and translate(s, chr(9) || chr(10) || chr(13), '') ~ '[[:cntrl:]]')
        or (k = 'phone' and (s !~ '^[+0-9(). #x-]+$' or s !~ '[0-9]'))
        or (k = 'website' and s !~ '^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}([/?#][^[:space:]\\]*)?$')
      ) then raise exception 'invalid owner edit' using errcode = '22023'; end if;
    end if;
  end loop;
  for k, v in select * from jsonb_each(coalesce(p_changes -> 'prices', '{}'::jsonb)) loop
    if k not in ('trial', 'drop_in', 'monthly') or jsonb_typeof(v) not in ('number', 'null') then
      raise exception 'invalid owner edit' using errcode = '22023';
    end if;
    if jsonb_typeof(v) = 'number' then
      if v::numeric <> trunc(v::numeric) or v::numeric < (case when k = 'trial' then 0 else 1 end) or v::numeric > 100000 then
        raise exception 'invalid owner edit' using errcode = '22023';
      end if;
    end if;
  end loop;

  select c.id into claim from public.claims c join public.gyms gym on gym.id = c.entity_id
  where c.user_id = actor and c.entity_type = 'gym' and c.status = 'verified' and gym.slug = p_slug
  for update of c;
  if claim is null then raise exception 'verified claim required' using errcode = '42501'; end if;
  select * into g from public.gyms where slug = p_slug and is_active and not is_sample for update;
  if not found then raise exception 'verified claim required' using errcode = '42501'; end if;

  before_value := jsonb_build_object('name', g.name, 'address', g.address, 'website', g.website, 'phone', g.phone, 'description', g.description, 'lat', g.lat, 'lng', g.lng,
    'prices', coalesce((select jsonb_object_agg(p.kind, to_jsonb(p) - 'gym_id' - 'kind') from public.gym_current_prices p where p.gym_id = g.id and p.kind in ('trial','drop_in','monthly')), '{}'::jsonb));
  insert into public.sources (kind, raw) values ('gym_claim', jsonb_build_object('actor_id', actor, 'claim_id', claim, 'changes', p_changes)) returning id into source;
  update public.gyms set
    name = case when p_changes ? 'name' then p_changes ->> 'name' else name end,
    address = case when p_changes ? 'address' then p_changes ->> 'address' else address end,
    lat = case when p_changes ? 'address' and (p_changes ->> 'address') is distinct from address then null else lat end,
    lng = case when p_changes ? 'address' and (p_changes ->> 'address') is distinct from address then null else lng end,
    website = case when p_changes ? 'website' then p_changes ->> 'website' else website end,
    phone = case when p_changes ? 'phone' then p_changes ->> 'phone' else phone end,
    description = case when p_changes ? 'description' then p_changes ->> 'description' else description end,
    owner_updated_at = clock_timestamp()
  where id = g.id returning * into g;
  for k, v in select * from jsonb_each(coalesce(p_changes -> 'prices', '{}'::jsonb)) loop
    price_value := case when v = 'null'::jsonb then null else v::int end;
    insert into public.gym_prices (gym_id, kind, amount_cents, free_trial, notes, source_id, verified_at, verified_by)
    values (g.id, k, price_value, case when k = 'trial' then price_value = 0 else null end,
      case when price_value is null then 'Price withdrawn by gym.' else 'Owner-supplied price; confirm terms with gym.' end,
      source, current_date, 'gym_claim');
  end loop;
  after_value := jsonb_build_object('name', g.name, 'address', g.address, 'website', g.website, 'phone', g.phone, 'description', g.description, 'lat', g.lat, 'lng', g.lng,
    'prices', coalesce((select jsonb_object_agg(p.kind, to_jsonb(p) - 'gym_id' - 'kind') from public.gym_current_prices p where p.gym_id = g.id and p.kind in ('trial','drop_in','monthly')), '{}'::jsonb));
  insert into public.gym_owner_edits (gym_id, actor_id, claim_id, source_id, before_data, after_data)
    values (g.id, actor, claim, source, before_value, after_value);
  return g.slug;
end $$;
revoke all on function public.edit_owned_gym(text, jsonb) from public, anon, authenticated;
grant execute on function public.edit_owned_gym(text, jsonb) to authenticated;

-- retirement follows the editor in this migration. old submissions and review/read paths remain intact.
drop policy if exists submissions_insert_any on public.submissions;
create policy submissions_insert_new_gym on public.submissions
  for insert to authenticated with check (
    status = 'pending' and entity_type = 'gym' and field = 'new_gym' and entity_id is null
    and submitted_by = (select auth.uid())
    and coalesce(length(note), 0) <= 1000
    and coalesce(length(contact_email), 0) <= 254
    and pg_column_size(proposed_value) <= 4096
  );

commit;
