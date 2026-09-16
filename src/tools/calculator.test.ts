import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculate,
  validateCalculator,
  kgToPounds,
  poundsToKg,
  cmToImperial,
  imperialToCm,
  activityLevels,
  stoneToKg,
  kgToStone,
} from './calculator.ts';

void test('calorie estimates match independently worked examples and BMI rounds neutrally', () => {
  // Male 30, 180 cm, 80 kg: 800 + 1125 - 150 + 5 = 1780; ×1.2 = 2136.
  const male = calculate({
    age: 30,
    sex: 'male',
    heightCm: 180,
    weightKg: 80,
    activity: 'low',
  });
  assert.equal(male.kcal, 2136);
  assert.equal(male.bmi, '24.7'); // 80 / 3.24 = 24.691358…
  // Female 40, 165 cm, 65 kg: 650 + 1031.25 - 200 - 161 = 1320.25; ×1.55 = 2046.3875.
  const female = calculate({
    age: 40,
    sex: 'female',
    heightCm: 165,
    weightKg: 65,
    activity: 'moderate',
  });
  assert.equal(female.kcal, 2046);
  assert.equal(female.bmi, '23.9'); // 65 / 2.7225 = 23.875114…
  assert.deepEqual(Object.keys(female).sort(), ['bmi', 'errors', 'kcal']);
  assert.deepEqual(
    activityLevels.map((level) => level.factor),
    [1.2, 1.375, 1.55, 1.725, 1.9]
  );
});
void test('imperial and metric inputs are equivalent with no conversion drift', () => {
  // 5 ft 10 in = 177.8 cm; 180 lb = 81.6466266 kg.
  assert.equal(imperialToCm(5, 10), 177.8);
  assert.ok(Math.abs(poundsToKg(180) - 81.6466266) < 1e-10);
  const common = { age: 35, sex: 'male', activity: 'light' };
  const a = calculate({ ...common, heightCm: 177.8, weightKg: 81.6466266 });
  const b = calculate({
    ...common,
    heightCm: imperialToCm(5, 10),
    weightKg: poundsToKg(180),
  });
  assert.deepEqual(a, b);
  // Resting = 1757.716266; ×1.375 = 2416.85986575; BMI = 25.826…
  assert.equal(a.kcal, 2417);
  assert.equal(a.bmi, '25.8');
  let cm = 173.1234,
    kg = 72.4567;
  for (let n = 0; n < 100; n++) {
    const imp = cmToImperial(cm);
    cm = imperialToCm(imp.feet, imp.inches);
    kg = poundsToKg(kgToPounds(kg));
  }
  assert.ok(Math.abs(cm - 173.1234) < 1e-9);
  assert.ok(Math.abs(kg - 72.4567) < 1e-9);
});
void test('invalid, missing and unsupported inputs cannot produce results', () => {
  const good = {
    age: 30,
    sex: 'female',
    heightCm: 170,
    weightKg: 70,
    activity: 'low',
  };
  assert.match(validateCalculator({ ...good, age: 17 }).age!, /18\+/);
  for (const age of [NaN, Infinity, 121, 30.5])
    assert.ok(validateCalculator({ ...good, age }).age);
  for (const weightKg of [NaN, Infinity, 0, -5, 701])
    assert.ok(validateCalculator({ ...good, weightKg }).weightKg);
  for (const heightCm of [NaN, Infinity, 0, -5, 276])
    assert.ok(validateCalculator({ ...good, heightCm }).heightCm);
  for (const sex of ['', 'other'])
    assert.ok(validateCalculator({ ...good, sex }).sex);
  assert.ok(validateCalculator({ ...good, activity: '' }).activity);
  assert.equal(calculate({ ...good, age: 17 }).kcal, undefined);
  assert.equal(
    calculate({ ...good, weightKg: 20, heightCm: 80, age: 120 }).kcal,
    undefined
  );
});
void test('stone and pounds match pounds and kilograms, including exact boundaries', () => {
  assert.ok(Math.abs(stoneToKg(12, 12) - 81.6466266) < 1e-10);
  assert.deepEqual(kgToStone(stoneToKg(12, 0)), { stone: 12, pounds: 0 });
  const measurement = {
    age: 35,
    sex: 'male',
    heightCm: 177.8,
    activity: 'light',
  };
  assert.deepEqual(
    calculate({ ...measurement, weightKg: stoneToKg(12, 12) }),
    calculate({ ...measurement, weightKg: poundsToKg(180) })
  );
  let kg = 72.4567;
  for (let i = 0; i < 100; i++) {
    const converted = kgToStone(kg);
    kg = stoneToKg(converted.stone, converted.pounds);
  }
  assert.ok(Math.abs(kg - 72.4567) < 1e-9);
});
