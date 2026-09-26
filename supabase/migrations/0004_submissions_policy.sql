-- fightgyms: submissions insert policy
-- the public anon key can insert corrections, so the policy, not the route, is the boundary:
-- pending rows only, allowed fields only, bounded sizes, and no impersonating another user.
-- run with: cd scrapers && .venv/bin/python run_sql.py ../supabase/migrations/0004_submissions_policy.sql
drop policy if exists submissions_insert_any on submissions;
create policy submissions_insert_any on submissions
  for insert with check (
    status = 'pending'
    and entity_type = 'gym'
    and field in ('trial_price', 'drop_in_price', 'monthly_price', 'website', 'other')
    and (submitted_by is null or submitted_by = auth.uid())
    and coalesce(length(note), 0) <= 1000
    and coalesce(length(contact_email), 0) <= 254
    and pg_column_size(proposed_value) <= 4096
  );
