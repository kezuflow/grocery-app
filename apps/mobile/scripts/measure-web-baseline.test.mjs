import assert from "node:assert/strict";
import test from "node:test";
import { regressionGate, summarize, trialOrder } from "./measure-web-baseline.mjs";

test("both sides receive five warmups and thirty strictly alternating pairs", () => {
  const order = trialOrder();
  assert.equal(order.length, 70);
  assert.deepEqual(order.slice(8, 14), [
    { phase: "warmup", pair: 5, side: "baseline" },
    { phase: "warmup", pair: 5, side: "head" },
    { phase: "measured", pair: 1, side: "baseline" },
    { phase: "measured", pair: 1, side: "head" },
    { phase: "measured", pair: 2, side: "baseline" },
    { phase: "measured", pair: 2, side: "head" },
  ]);
  assert.deepEqual(order.slice(-2), [
    { phase: "measured", pair: 30, side: "baseline" },
    { phase: "measured", pair: 30, side: "head" },
  ]);
});

test("nearest-rank p95 preserves the thirty-sample tail and median", () => {
  assert.deepEqual(summarize(Array.from({ length: 30 }, (_, index) => 30 - index)), {
    count: 30,
    medianMs: 15.5,
    minimumMs: 1,
    maximumMs: 30,
    p95Ms: 29,
    p95Method: "nearest-rank",
  });
  assert.throws(() => summarize([1, NaN]), /finite/);
  assert.throws(() => summarize([]), /nonempty/);
});

test("the regression gate requires both strict thresholds", () => {
  assert.equal(regressionGate({ p95Ms: 1000 }, { p95Ms: 1150 }).regression, false);
  assert.equal(regressionGate({ p95Ms: 500 }, { p95Ms: 600 }).regression, false);
  assert.equal(regressionGate({ p95Ms: 1000 }, { p95Ms: 1151 }).regression, true);
  assert.equal(regressionGate({ p95Ms: 1000 }, { p95Ms: 900 }).regression, false);
});
