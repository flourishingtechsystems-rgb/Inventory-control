import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateByWeights, applyBps, centsToDecimal, parseMoneyToCents, roundDiv } from "@/lib/money";

test("parseMoneyToCents handles symbols, separators and partial cents", () => {
  assert.equal(parseMoneyToCents("$1,234.5"), 123450);
  assert.equal(parseMoneyToCents("0.07"), 7);
  assert.equal(parseMoneyToCents("-3.1"), -310);
  assert.equal(parseMoneyToCents(".99"), 99);
  assert.equal(parseMoneyToCents("12"), 1200);
  assert.equal(parseMoneyToCents("1.234"), null);
  assert.equal(parseMoneyToCents("abc"), null);
  assert.equal(parseMoneyToCents(""), null);
});

test("centsToDecimal formats without float error", () => {
  assert.equal(centsToDecimal(123456), "1234.56");
  assert.equal(centsToDecimal(-5), "-0.05");
  assert.equal(centsToDecimal(0), "0.00");
});

test("roundDiv rounds half away from zero", () => {
  assert.equal(roundDiv(5, 2), 3);
  assert.equal(roundDiv(-5, 2), -3);
  assert.equal(roundDiv(4, 3), 1);
  assert.equal(applyBps(12345, 1000), 1235);
});

test("allocateByWeights always sums to the total", () => {
  assert.deepEqual(allocateByWeights(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocateByWeights(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocateByWeights(10, [0, 0]), [10, 0]);
  assert.deepEqual(allocateByWeights(7, [0, 5, 5]), [0, 4, 3]);
  for (let total = 0; total < 500; total += 37) {
    const parts = allocateByWeights(total, [3, 7, 11, 13]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
  }
});
