// Applies supabase/migrations/*.sql that the linked project has not recorded yet, over the Supabase Management API.
// History lives in supabase_migrations.schema_migrations, the same table `supabase db push` uses, so the CLI stays an option.
// Each file and its history row go in one request, which Postgres runs as one implicit transaction: a failing
// migration leaves nothing behind. Do not put begin/commit in new migrations; that would break the atomicity.
//
// env: SUPABASE_ACCESS_TOKEN (required), SUPABASE_PROJECT_REF, DRY_RUN=1, BASELINE_THROUGH=<version>
// BASELINE_THROUGH records every local version up to and including it as applied without running it,
// for migrations applied by hand before this workflow existed.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF || "jufepgavugrbbejqdvif";
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const baseline = (process.env.BASELINE_THROUGH || "").trim();
const dir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("invalid project ref");
if (baseline && !/^\d+$/.test(baseline)) throw new Error("BASELINE_THROUGH must be a migration version like 0010");

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`management api ${res.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : [];
}

const lit = (s) => `'${s.replaceAll("'", "''")}'`;
function dollar(body) {
  let tag;
  do tag = `$ffg_${randomBytes(6).toString("hex")}$`; while (body.includes(tag));
  return `${tag}${body}${tag}`;
}

const local = readdirSync(dir)
  .map((file) => ({ file, m: /^(\d+)_(.+)\.sql$/.exec(file) }))
  .filter((x) => x.m)
  .map(({ file, m }) => ({ file, version: m[1], name: m[2], sql: readFileSync(join(dir, file), "utf8") }))
  .sort((a, b) => Number(a.version) - Number(b.version) || a.file.localeCompare(b.file));
const dupes = local.filter((x, i) => local.findIndex((y) => y.version === x.version) !== i);
if (dupes.length) throw new Error(`duplicate migration versions: ${dupes.map((d) => d.file).join(", ")}`);

const historyDdl = `
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
  alter table supabase_migrations.schema_migrations add column if not exists statements text[];
  alter table supabase_migrations.schema_migrations add column if not exists name text;`;
const record = (m) =>
  `insert into supabase_migrations.schema_migrations (version, name, statements) values (${lit(m.version)}, ${lit(m.name)}, array[${dollar(m.sql)}]) on conflict (version) do nothing;`;

const [{ exists }] = await query("select to_regclass('supabase_migrations.schema_migrations') is not null as exists");
const applied = new Set(exists ? (await query("select version from supabase_migrations.schema_migrations")).map((r) => r.version) : []);
const [{ hand }] = await query("select to_regclass('public.gyms') is not null as hand");

const baselined = baseline ? local.filter((m) => Number(m.version) <= Number(baseline) && !applied.has(m.version)) : [];
const pending = local.filter((m) => !applied.has(m.version) && !baselined.includes(m));
console.log(`project ${ref}: ${applied.size} recorded, ${baselined.length} to baseline, ${pending.length} to apply${dryRun ? " (dry run)" : ""}`);
for (const m of baselined) console.log(`  baseline ${m.file}`);
for (const m of pending) console.log(`  apply    ${m.file}`);

if (applied.size === 0 && hand && !baselined.length && pending.length && pending[0].version === local[0].version) {
  throw new Error("the database already has the schema but no migration history. Run this workflow once by hand with " +
    "baseline_through set to the last migration that is already applied (for example 0010).");
}
if (dryRun) process.exit(0);

if (!exists || baselined.length) await query(historyDdl + baselined.map(record).join("\n"));
for (const m of pending) {
  await query(`${historyDdl}\n${m.sql}\n;\n${record(m)}`);
  console.log(`  applied  ${m.file}`);
}
console.log("done");
