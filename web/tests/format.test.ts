import assert from "node:assert/strict";
import { test } from "node:test";
import { fullAddress } from "../src/lib/format";

test("a street-only address gains its city and state; printed full addresses stay as they are", () => {
  assert.equal(fullAddress({ address: "67 Ingraham St", city: "Brooklyn", state: "NY" }), "67 Ingraham St, Brooklyn, NY");
  assert.equal(fullAddress({ address: "123 Washington St", city: "Washington", state: "DC" }), "123 Washington St, Washington, DC");
  assert.equal(fullAddress({ address: "213 W 35th Street, New York, NY 10001", city: "New York", state: "NY" }), "213 W 35th Street, New York, NY 10001");
  assert.equal(fullAddress({ address: "4231 Duke St # B, Alexandria, VA 22304, USA", city: "Alexandria", state: "VA" }), "4231 Duke St # B, Alexandria, VA 22304, USA");
  assert.equal(fullAddress({ address: "3487 Kennedy Blvd. Jersey City, NJ 07307", city: "Jersey City", state: "NJ" }), "3487 Kennedy Blvd. Jersey City, NJ 07307");
  assert.equal(fullAddress({ address: null, city: "Brooklyn", state: "NY" }), null);
});
