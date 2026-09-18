import {
  cmToImperial,
  imperialToCm,
  kgToPounds,
  kgToStone,
  poundsToKg,
  stoneToKg,
} from './calculator.ts';

export type PostBmiHints = {
  teen: boolean;
  heightCm?: number;
  weightKg?: number;
  heightUnit?: 'cm' | 'ft';
  weightUnit?: 'kg' | 'lb' | 'st';
};

const finite = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value);

/** Conservative signals for text that may describe a person under 18. */
export function suggestsTeen(text: string): boolean {
  const value = text.toLowerCase();
  return (
    /\b(?:teen|teenager|minor|under\s*18)\b/.test(value) ||
    /\bage\s*[:=]?\s*(?:1[0-7])\b/.test(value) ||
    /\b(?:1[0-7])\s*(?:years?\s*old|y\/?o)\b/.test(value) ||
    /\b(?:1[0-7])\s*[/-]\s*[mf]\b/.test(value) ||
    /\b(?:1[0-7])\s*[mf]\b/.test(value)
  );
}

export function findPostBmiHints(text: string): PostBmiHints {
  const result: PostBmiHints = { teen: suggestsTeen(text) };
  if (result.teen) return result;

  const heightMetric = text.match(
    /\b(?:height\s*[:=]?\s*)?(\d{2,3}(?:\.\d+)?)\s*(?:cm|centimet(?:re|er)s?)\b/i
  );
  const heightImperial = text.match(
    /\b([4-8])\s*(?:'|ft|feet)\s*(\d{1,2})?\s*(?:"|in|inches)?\b/i
  );
  if (heightMetric) {
    const cm = Number(heightMetric[1]);
    if (cm >= 80 && cm <= 275) {
      result.heightCm = cm;
      result.heightUnit = 'cm';
    }
  } else if (heightImperial) {
    const feet = Number(heightImperial[1]);
    const inches = Number(heightImperial[2] ?? 0);
    const cm = imperialToCm(feet, inches);
    if (cm >= 80 && cm <= 275) {
      result.heightCm = cm;
      result.heightUnit = 'ft';
    }
  }

  const stone = text.match(
    /\b(?:weight\s*[:=]?\s*)?(\d{1,2})\s*(?:st|stone)\s*(?:(\d{1,2})\s*(?:lb|lbs|pounds)?)?\b/i
  );
  const pounds = text.match(
    /\b(?:weight\s*[:=]?\s*)?(\d{2,3}(?:\.\d+)?)\s*(?:lb|lbs|pounds)\b/i
  );
  const kilograms = text.match(
    /\b(?:weight\s*[:=]?\s*)?(\d{2,3}(?:\.\d+)?)\s*(?:kg|kgs|kilograms?)\b/i
  );
  if (stone) {
    const kg = stoneToKg(Number(stone[1]), Number(stone[2] ?? 0));
    if (kg >= 20 && kg <= 700) {
      result.weightKg = kg;
      result.weightUnit = 'st';
    }
  } else if (pounds) {
    const kg = poundsToKg(Number(pounds[1]));
    if (kg >= 20 && kg <= 700) {
      result.weightKg = kg;
      result.weightUnit = 'lb';
    }
  } else if (kilograms) {
    const kg = Number(kilograms[1]);
    if (kg >= 20 && kg <= 700) {
      result.weightKg = kg;
      result.weightUnit = 'kg';
    }
  }
  return result;
}

export function suggestedHeight(hints: PostBmiHints, unit: 'cm' | 'ft') {
  if (!finite(hints.heightCm)) return {};
  if (unit === 'cm') return { cm: String(Math.round(hints.heightCm! * 10) / 10) };
  const imperial = cmToImperial(hints.heightCm!);
  return {
    feet: String(imperial.feet),
    inches: String(Math.round(imperial.inches * 10) / 10),
  };
}

export function suggestedWeight(
  hints: PostBmiHints,
  unit: 'kg' | 'lb' | 'st'
) {
  if (!finite(hints.weightKg)) return {};
  if (unit === 'kg') return { kg: String(Math.round(hints.weightKg! * 10) / 10) };
  if (unit === 'lb')
    return { lb: String(Math.round(kgToPounds(hints.weightKg!) * 10) / 10) };
  const imperial = kgToStone(hints.weightKg!);
  return {
    stone: String(imperial.stone),
    pounds: String(Math.round(imperial.pounds * 10) / 10),
  };
}

export function rawBmiFromPostValues(
  heightCm: number,
  weightKg: number
): number | undefined {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return undefined;
  if (heightCm < 80 || heightCm > 275 || weightKg < 20 || weightKg > 700)
    return undefined;
  return weightKg / (heightCm / 100) ** 2;
}

export function bmiFromPostValues(
  heightCm: number,
  weightKg: number
): number | undefined {
  const raw = rawBmiFromPostValues(heightCm, weightKg);
  // The tiny offset avoids binary floating-point values such as 18.449999...
  // being displayed as 18.4 when the intended decimal value is 18.45.
  return raw === undefined ? undefined : Number((raw + 1e-9).toFixed(1));
}
