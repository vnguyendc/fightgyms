import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { boot } from "./db";

// Executes the exact importer SQL, not a hand-maintained copy, with validated
// fictional inputs on in-process Postgres. Never connects to a live database.
const payload = JSON.parse(execFileSync("python3", ["-c", `
import importlib.util,json,pathlib,tempfile
spec=importlib.util.spec_from_file_location('manual_prices',pathlib.Path('../scrapers/manual_prices.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 p=pathlib.Path(folder)/'prices.csv'
 p.write_text('gym_slug,kind,amount_dollars,verified_at,notes\\nreal-gym-reston-va,monthly,150,2026-10-01,Phone verified fixture\\nreal-gym-reston-va,trial,0,2026-10-01,Free trial fixture\\n')
 print(json.dumps({'sql':m.IMPORT_SQL.replace('%s','$1'),'rows':m.read_prices(p)}))
`], { encoding: "utf8" })) as { sql: string; rows: Record<string, unknown>[] };

test("phone import appends prices with source provenance and is idempotent on retry", async () => {
  const db = await boot(true);
  try {
    const run = () => db.query(payload.sql, [JSON.stringify(payload.rows)]);
    assert.equal((await run()).rows.length, 2);
    assert.equal((await run()).rows.length, 0);
    const rows = (await db.query<{ kind: string; amount_cents: number; free_trial: boolean; verified_by: string; source_kind: string; fingerprint: string }>(
      "select p.kind,p.amount_cents,p.free_trial,p.verified_by,s.kind as source_kind,s.raw->>'phone_import_id' as fingerprint from gym_prices p join sources s on s.id=p.source_id where s.raw ? 'phone_import_id' order by p.kind")).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.verified_by === "phone" && r.source_kind === "manual" && r.fingerprint.length === 64));
    assert.equal(rows[0].amount_cents, 15000);
    assert.equal(rows[1].free_trial, true);
    assert.equal(rows[1].amount_cents, 0);
    const changed = { ...payload.rows[0], amount_cents: 16000, verified_at: "2026-10-02", phone_import_id: "different-confirmation" };
    assert.equal((await db.query(payload.sql, [JSON.stringify([changed])])).rows.length, 1);
    assert.equal((await db.query<{ amount_cents: number }>("select amount_cents from gym_current_prices where gym_id=(select id from gyms where slug='real-gym-reston-va') and kind='monthly'")).rows[0].amount_cents, 16000);
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from gym_prices where source_id in (select id from sources where raw ? 'phone_import_id')")).rows[0].n, 3);
    await db.exec("begin");
    await assert.rejects(db.query(payload.sql, [JSON.stringify([{ ...changed, kind: null, phone_import_id: "rollback-confirmation" }]) ]));
    await db.exec("rollback");
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from sources where raw->>'phone_import_id'='rollback-confirmation'")).rows[0].n, 0);
  } finally { await db.close(); }
});
