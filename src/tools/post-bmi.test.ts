import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bmiFromPostValues,
  findPostBmiHints,
  rawBmiFromPostValues,
  suggestsTeen,
} from './post-bmi.ts';

void test('post BMI hints parse adult metric and imperial measurements', () => {
  const metric = findPostBmiHints('I am 170 cm and weigh 75 kg.');
  assert.equal(metric.teen, false);
  assert.equal(metric.heightCm, 170);
  assert.equal(metric.weightKg, 75);

  const imperial = findPostBmiHints("Height 5' 10\" and weight 12 st 4 lb");
  assert.equal(imperial.teen, false);
  assert.equal(imperial.heightUnit, 'ft');
  assert.equal(imperial.weightUnit, 'st');
  assert.ok(Math.abs(imperial.heightCm! - 177.8) < 0.01);
  assert.ok(Math.abs(imperial.weightKg! - 78.017) < 0.01);
});

void test('teen signals suppress all inferred measurements', () => {
  assert.equal(suggestsTeen('16/f, 5ft 4, 120 lb'), true);
  assert.deepEqual(
    findPostBmiHints('I am a teenager, 170 cm and 60 kg'),
    { teen: true }
  );
  assert.equal(suggestsTeen('I have been lifting for 15m'), true);
});

void test('BMI output validates supported adult measurement ranges', () => {
  assert.equal(bmiFromPostValues(170, 75), 26);
  assert.equal(bmiFromPostValues(170, 18.45 * 1.7 ** 2), 18.5);
  assert.ok(Math.abs(rawBmiFromPostValues(170, 18.45 * 1.7 ** 2)! - 18.45) < 0.000001);
  assert.equal(bmiFromPostValues(10, 75), undefined);
  assert.equal(bmiFromPostValues(170, Number.NaN), undefined);
});
