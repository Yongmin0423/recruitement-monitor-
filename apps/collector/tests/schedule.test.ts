import assert from "node:assert/strict";
import test from "node:test";
import { collectionPlanAt } from "../src/schedule.ts";

test("weekday business hours run hourly in KST", () => {
  assert.equal(collectionPlanAt(new Date("2026-10-26T00:00:00Z")).window, "workday");
  assert.equal(collectionPlanAt(new Date("2026-10-26T08:30:00Z")).due, false);
  assert.equal(collectionPlanAt(new Date("2026-10-26T08:00:00Z")).window, "workday");
  assert.equal(collectionPlanAt(new Date("2026-10-26T09:00:00Z")).due, false);
});

test("morning catches overnight postings; weekends have three runs", () => {
  assert.deepEqual(collectionPlanAt(new Date("2026-10-25T23:00:00Z")), {
    due: true, window: "morning", maxPages: 3,
  });
  assert.equal(collectionPlanAt(new Date("2026-10-31T01:00:00Z")).window, "weekend");
  assert.equal(collectionPlanAt(new Date("2026-10-31T07:00:00Z")).window, "weekend");
  assert.equal(collectionPlanAt(new Date("2026-10-31T13:00:00Z")).window, "weekend");
  assert.equal(collectionPlanAt(new Date("2026-10-31T03:00:00Z")).due, false);
});
