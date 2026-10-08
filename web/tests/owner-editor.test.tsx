import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ClaimView, { type ClaimState } from "../src/components/ClaimView";
import { gym } from "./fixtures";
import { TEST_USER } from "./session";

const detail = { ...gym, phone: "202-555-0100", description: "Current description", affiliation: null, founded_year: null, prices: [], classes: [], coaches: [], fighters: [], photos: [], socials: [] };
const claim = { id: "c1", entity_id: gym.id, status: "verified", role: "owner", created_at: "2026-10-07T00:00:00Z" };
const state = { kind: "signed-in" as const, user: TEST_USER, gym, gymSlug: gym.slug, claims: [claim], submissions: [], gyms: [gym], editableGym: detail, saved: true };
const render = (s: ClaimState) => renderToStaticMarkup(<ClaimView state={s} />);

test("verified claimant sees a prefilled bounded editor with immediate publishing and honest provenance", () => {
  const html = render(state);
  assert.match(html, /action="\/api\/owner-edit" method="post"/);
  assert.match(html, /name="gym" value="test-gym"/);
  assert.match(html, /name="name"[^>]*value="Test gym"/);
  assert.match(html, /name="phone"[^>]*value="202-555-0100"/);
  assert.match(html, /name="description"[^>]*>Current description/);
  for (const kind of ["trial", "drop_in", "monthly"]) {
    assert.match(html, new RegExp(`name="${kind}_action"`));
    assert.match(html, new RegExp(`name="${kind}_price"`));
  }
  assert.match(html, /Publish changes/);
  assert.match(html, /publish immediately/i);
  assert.match(html, /owner-supplied[\s\S]*not independently checked/i);
  assert.match(html, /Changes published/);
  assert.match(html, /href="\/claim\?gym=test-gym#edit"/);
  assert.doesNotMatch(html, /name="(?:gym_id|claimed|role|submitted_by|status)"[^>]*value="(?:verified|test-gym)"/);
});

test("pending, rejected, another gym, absent detail and signed-out cannot render an owner editor or saved banner", () => {
  for (const s of [
    { ...state, claims: [{ ...claim, status: "pending" }] },
    { ...state, claims: [{ ...claim, status: "rejected" }] },
    { ...state, claims: [{ ...claim, entity_id: "other" }] },
    { ...state, editableGym: null },
    { ...state, editableGym: { ...detail, id: "other" } },
    { ...state, claims: [], gym: { ...gym, claimed: true } },
    { kind: "signed-out" as const, gym, gymSlug: gym.slug, notice: null },
  ]) assert.doesNotMatch(render(s), /action="\/api\/owner-edit"|Changes published/);
});

test("a saved edit with delayed cache refresh displays that limitation explicitly", () => {
  const html = render({ ...state, refreshDelayed: true });
  assert.match(html, /Changes saved[\s\S]*up to an hour/i);
  assert.doesNotMatch(html, /Changes published/);
});
