import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Runs the real migration chain on an in-process Postgres with the Supabase-managed schemas stubbed.
// Policies are exercised as the `authenticated` role with a fake JWT in request.jwt.claims, the way PostgREST sets it.
const root = join(import.meta.dirname, "..", "..");
const sql = (file: string) => readFileSync(join(root, "supabase", file), "utf8");
export const OWNER = "00000000-0000-4000-8000-000000000001";
export const OTHER = "00000000-0000-4000-8000-000000000002";

export async function boot(ownerEditing = false) {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
  `);
  for (const f of ["migrations/0001_init.sql", "migrations/0002_photos.sql", "migrations/0003_gym_cards_v3.sql", "migrations/0004_submissions_policy.sql", "migrations/0005_claims.sql", "migrations/0006_socials.sql", ...(ownerEditing ? ["migrations/0007_owner_edits.sql"] : []), "seed.sql"]) {
    if (f === "migrations/0007_owner_edits.sql") await db.exec("grant select, insert, update, delete on all tables in schema public to anon, authenticated");
    await db.exec(sql(f));
  }
  await db.exec(`
    ${ownerEditing ? "" : "grant select, insert, update, delete on all tables in schema public to anon, authenticated;"}
    insert into auth.users (id, email) values ('${OWNER}', 'owner@siamstrike.example'), ('${OTHER}', 'other@example.com');
    insert into places (state, city, slug) values ('VA', 'Reston', 'reston-va');
    insert into gyms (slug, name, styles, place_id, website, is_sample) values
      ('real-gym-reston-va', 'Real Gym', '{muay_thai}', (select id from places where slug = 'reston-va'), 'https://www.SiamStrike.example/', false),
      ('real-no-site-reston-va', 'No Site Gym', '{kickboxing}', (select id from places where slug = 'reston-va'), null, false);
  `);
  return db;
}

/** Run one statement as `role` with the given JWT claims, then drop back to the superuser. */
export async function as<T>(db: PGlite, role: "anon" | "authenticated", claims: Record<string, string> | null, query: string, params: unknown[] = []) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  try {
    return await db.query<T>(query, params);
  } finally {
    await db.exec("reset role");
  }
}

export const owner = { sub: OWNER, email: "owner@siamstrike.example", role: "authenticated" };
export const other = { sub: OTHER, email: "other@example.com", role: "authenticated" };
export const gymId = async (db: PGlite, slug: string) => (await db.query<{ id: string }>("select id from gyms where slug = $1", [slug])).rows[0].id;
