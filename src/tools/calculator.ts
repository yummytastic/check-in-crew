// Pure, client-only arithmetic. No account context, storage, logs or network access.
// Mifflin et al. 1990, simplified equations 7/8: doi:10.1093/ajcn/51.2.241.
// Activity factors: Orgain Healthcare, Making Good Athletes Great Q&A, question 2.
export const activityLevels = [
  {
    id: 'low',
    label: 'Mostly sitting',
    factor: 1.2,
    description:
      'Most of the day seated, with routine walking and little planned exercise.',
  },
  {
    id: 'light',
    label: 'Lightly active',
    factor: 1.375,
    description:
      'Mostly seated work, with regular walks and light purposeful exercise on 1–3 days a week.',
  },
  {
    id: 'moderate',
    label: 'Moderately active',
    factor: 1.55,
    description:
      'Movement throughout the day AND purposeful exercise 3–5 days a week. Short workouts don’t cancel out a mostly seated day.',
  },
  {
    id: 'high',
    label: 'Very active',
    factor: 1.725,
    description:
      'Active throughout the day AND demanding exercise most days. Reserve for sustained high workloads; a gym session alone isn’t enough.',
  },
  {
    id: 'very-high',
    label: 'Extremely active',
    factor: 1.9,
    description:
      'Heavy activity throughout the day AND intensive training. Exceptional, athlete-level workloads; select only if this is your usual routine.',
  },
] as const;
export type CalculatorInput = {
  age: number;
  sex: string;
  heightCm: number;
  weightKg: number;
  activity: string;
};
export type CalculatorErrors = Partial<Record<keyof CalculatorInput, string>>;
export function validateCalculator(input: CalculatorInput): CalculatorErrors {
  const errors: CalculatorErrors = {};
  if (!Number.isFinite(input.age)) errors.age = 'Enter your age.';
  else if (input.age < 18) errors.age = 'For adults aged 18+ only.';
  else if (!Number.isInteger(input.age) || input.age > 120)
    errors.age = 'Use a whole age from 18–120.';
  if (!['female', 'male'].includes(input.sex))
    errors.sex = 'Choose a formula sex.';
  if (
    !Number.isFinite(input.heightCm) ||
    input.heightCm < 80 ||
    input.heightCm > 275
  )
    errors.heightCm = 'Check height: supported range 80–275 cm.';
  if (
    !Number.isFinite(input.weightKg) ||
    input.weightKg < 20 ||
    input.weightKg > 700
  )
    errors.weightKg = 'Check weight: supported range 20–700 kg.';
  if (!activityLevels.some((level) => level.id === input.activity))
    errors.activity = 'Choose an activity level.';
  return errors;
}
export function calculate(input: CalculatorInput) {
  const errors = validateCalculator(input);
  if (Object.keys(errors).length) return { errors };
  const resting =
    10 * input.weightKg +
    6.25 * input.heightCm -
    5 * input.age +
    (input.sex === 'male' ? 5 : -161);
  if (resting <= 0)
    return {
      errors: {
        weightKg: 'Check these measurements; no usable estimate.',
      } as CalculatorErrors,
    };
  const factor = activityLevels.find(
    (level) => level.id === input.activity
  )!.factor;
  return {
    errors: {} as CalculatorErrors,
    kcal: Math.round(resting * factor),
    bmi: (input.weightKg / (input.heightCm / 100) ** 2).toFixed(1),
  };
}
export const poundsToKg = (pounds: number) => pounds * 0.45359237;
export const kgToPounds = (kg: number) => kg / 0.45359237;
export const stoneToKg = (stone: number, pounds: number) =>
  poundsToKg(stone * 14 + pounds);
export function kgToStone(kg: number) {
  const total = kgToPounds(kg);
  const stone = Math.floor(total / 14);
  return { stone, pounds: total - stone * 14 };
}
export const imperialToCm = (feet: number, inches: number) =>
  (feet * 12 + inches) * 2.54;
export function cmToImperial(cm: number) {
  const total = cm / 2.54;
  const feet = Math.floor(total / 12);
  return { feet, inches: total - feet * 12 };
}
