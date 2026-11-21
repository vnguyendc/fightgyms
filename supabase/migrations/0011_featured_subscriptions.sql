-- stripe subscriptions behind featured listings. requires 0009. safe to re-run.
-- only the stripe webhook writes here, as service_role, through sync_featured_subscription.
-- visitors and owners can neither read the table nor call the function.
-- featured_until on gyms only moves forward: a paid period sets it to the period end plus grace,
-- a cancel or failed payment changes nothing and the listing lapses on that date.
-- a manual open-ended feature (featured = true, featured_until null) is never shortened.
--   select * from featured_subscriptions order by updated_at desc;
create table if not exists public.featured_subscriptions (
  stripe_subscription_id text primary key check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,250}$'),
  gym_id                 uuid not null references public.gyms(id),
  stripe_customer_id     text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  status                 text not null check (status ~ '^[a-z_]{1,40}$'),
  featured_until         date,
  last_event_id          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists featured_subscriptions_gym_idx on public.featured_subscriptions (gym_id);
alter table public.featured_subscriptions enable row level security;
grant usage on schema public to service_role;
revoke all on public.featured_subscriptions from public, anon, authenticated;
grant select on public.featured_subscriptions to service_role;

-- returns 'featured' when the gym's placement was set or extended, 'recorded' when only the
-- subscription row changed, 'unknown_gym' when the slug is not a real gym (nothing is written).
create or replace function public.sync_featured_subscription(
  p_slug text, p_subscription text, p_customer text, p_status text, p_until date, p_event text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid;
  v_paid boolean := p_status in ('active', 'trialing') and p_until is not null;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,120}$' then return 'unknown_gym'; end if;
  if p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9]{1,250}$' then raise exception 'invalid subscription id'; end if;
  if p_customer is not null and p_customer !~ '^cus_[A-Za-z0-9]{1,250}$' then raise exception 'invalid customer id'; end if;
  if p_status is null or p_status !~ '^[a-z_]{1,40}$' then raise exception 'invalid status'; end if;
  select id into v_gym from public.gyms where slug = p_slug and not is_sample;
  if v_gym is null then return 'unknown_gym'; end if;

  insert into public.featured_subscriptions as s (stripe_subscription_id, gym_id, stripe_customer_id, status, featured_until, last_event_id)
  values (p_subscription, v_gym, p_customer, p_status, case when v_paid then p_until end, p_event)
  on conflict (stripe_subscription_id) do update set
    stripe_customer_id = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
    status = excluded.status,
    featured_until = greatest(s.featured_until, excluded.featured_until),
    last_event_id = coalesce(excluded.last_event_id, s.last_event_id),
    updated_at = now();

  if not v_paid then return 'recorded'; end if;
  update public.gyms g set
    featured = true,
    featured_until = case when g.featured and g.featured_until is null then null
                          else greatest(g.featured_until, p_until) end
  where g.id = (select gym_id from public.featured_subscriptions where stripe_subscription_id = p_subscription);
  return 'featured';
end $$;
revoke all on function public.sync_featured_subscription(text, text, text, text, date, text) from public, anon, authenticated;
grant execute on function public.sync_featured_subscription(text, text, text, text, date, text) to service_role;
