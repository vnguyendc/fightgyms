import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_GYMS_TITLE, PAGE_SIZE, allGymsDescription, allGymsPath, allGymsTitle, pageCount, pageSlice, pageWindow } from "../src/lib/listing";

test("all-gyms paging: 30 per page, page 1 is /gyms/all, compact numbered windows, alphabetical order", () => {
  assert.equal(PAGE_SIZE, 30);
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(30), 1);
  assert.equal(pageCount(31), 2);
  assert.equal(allGymsPath(1), "/gyms/all");
  assert.equal(allGymsPath(2), "/gyms/all/page/2");
  const items = Array.from({ length: 31 }, (_, i) => i);
  assert.deepEqual(pageSlice(items, 1), items.slice(0, 30));
  assert.deepEqual(pageSlice(items, 2), [30]);
  assert.deepEqual(pageSlice(items, 3), []);
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(2, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(5, 20), [1, null, 3, 4, 5, 6, 7, null, 20]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, 3, null, 20]);
  assert.deepEqual(pageWindow(20, 20), [1, null, 18, 19, 20]);
  assert.equal(allGymsTitle(1), ALL_GYMS_TITLE);
  assert.equal(allGymsTitle(2), `${ALL_GYMS_TITLE} (Page 2)`);
  assert.doesNotMatch(allGymsDescription(1, 1), /page/);
  assert.match(allGymsDescription(2, 3), /page 2 of 3/);
  assert.doesNotMatch(allGymsDescription(2, 3), /Every /);
});
