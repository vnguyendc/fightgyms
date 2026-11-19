-- outbound link clicks for a later per-gym monthly report.
-- no visitor id, ip, user agent, account or url. slug + link type + time only.
-- anon and authenticated may call record_outbound_click. they cannot read or insert the table.
-- monthly totals, as the database owner or service_role:
--   select * from outbound_clicks_monthly order by month desc, gym_slug;
create table if not exists public.outbound_clicks (
  id         uuid primary key default gen_random_uuid(),
  gym_slug   text not null check (gym_slug ~ '^[a-z0-9-]{1,120}$'),
  link_type  text not null check (link_type in ('website', 'phone', 'instagram', 'facebook', 'tiktok', 'youtube', 'x')),
  clicked_at timestamptz not null default now()
);
create index if not exists outbound_clicks_gym_clicked_idx on public.outbound_clicks (gym_slug, clicked_at desc);

alter table public.outbound_clicks enable row level security;
grant usage on schema public to service_role;
revoke all on public.outbound_clicks from public, anon, authenticated;
grant select on public.outbound_clicks to service_role;

-- extra calls in the same minute are ignored so a loop cannot fill the table.
-- 60/minute/gym is above any real visitor rate here; it is not a per-person limit.
create or replace function public.record_outbound_click(p_slug text, p_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,120}$' then return; end if;
  if p_type is null or p_type not in ('website', 'phone', 'instagram', 'facebook', 'tiktok', 'youtube', 'x') then return; end if;
  if (select count(*) from public.outbound_clicks
      where gym_slug = p_slug and clicked_at > now() - interval '1 minute') >= 60 then
    return;
  end if;
  insert into public.outbound_clicks (gym_slug, link_type) values (p_slug, p_type);
end $$;
revoke all on function public.record_outbound_click(text, text) from public, anon, authenticated;
grant execute on function public.record_outbound_click(text, text) to anon, authenticated;

create or replace view public.outbound_clicks_monthly with (security_invoker = true) as
select
  gym_slug,
  (date_trunc('month', clicked_at at time zone 'America/New_York'))::date as month,
  count(*)::int as clicks,
  count(*) filter (where link_type = 'website')::int as website_clicks,
  count(*) filter (where link_type = 'phone')::int as phone_clicks,
  count(*) filter (where link_type not in ('website', 'phone'))::int as social_clicks
from public.outbound_clicks
group by 1, 2;
revoke all on public.outbound_clicks_monthly from public, anon, authenticated;
grant select on public.outbound_clicks_monthly to service_role;
