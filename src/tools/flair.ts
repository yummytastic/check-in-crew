// Shared formatting only: no accounts, persistence or network access.
export type FlairField = {
  id: string;
  label: string;
  type: string;
  help: string;
  required: boolean;
};
export type FlairFormat = { id: string; name: string; format: string };
export type FlairConfig = { fields: FlairField[]; formats: FlairFormat[] };
export type FlairValue = { value?: string; unit?: string; extra?: string };
export const flairDefaults = [
  ['Age', 'number'],
  ['Gender', 'text'],
  ['Starting weight', 'weight'],
  ['Current weight', 'weight'],
  ['Goal weight', 'weight'],
  ['Height', 'height'],
  ['Personal text', 'text'],
  ['', 'disabled'],
] as const;
export const formatDefaults = [
  [
    'Full stats',
    '{flair1}{flair2} | {flair6} | SW:{flair3} CW:{flair4} GW:{flair5}',
  ],
  ['Weight stats', 'SW:{flair3} | CW:{flair4} | GW:{flair5}'],
  ['Starting → current', '{flair3} → {flair4}'],
  ['Current → goal', '{flair4} → {flair5}'],
  ['Personal text', '{flair7}'],
] as const;
export function formatFields(format: string): string[] {
  return [
    ...new Set([...format.matchAll(/\{(flair[1-8])\}/g)].map((m) => m[1]!)),
  ];
}
export function validateFlairFormat(format: string): string | undefined {
  if (format.length > 300 || /\p{C}/u.test(format))
    return 'Use a single line of up to 300 characters.';
  if (/[{}]/.test(format.replace(/\{flair[1-8]\}/g, '')))
    return 'Use placeholders {flair1} through {flair8}.';
  if (format && !formatFields(format).length)
    return 'Include at least one field placeholder.';
}
// "72,5" means 72.5 in many locales; flair always shows a decimal point.
const decimalPoint = (text: string) =>
  /^\d+,\d+$/.test(text) ? text.replace(',', '.') : text;
function fieldText(field: FlairField, entry: FlairValue): string {
  const raw = typeof entry.value === 'string' ? entry.value.trim() : '';
  const value = field.type === 'text' ? raw : decimalPoint(raw);
  const extra = decimalPoint(
    typeof entry.extra === 'string' ? entry.extra.trim() : ''
  );
  if (!value && !extra) {
    if (field.required) throw Error(`${field.label} is required.`);
    return '';
  }
  if (/\p{C}/u.test(value) || /\p{C}/u.test(extra))
    throw Error(`${field.label}: use a single line of plain text.`);
  if (field.type === 'text') {
    if (value.length > 64)
      throw Error(`${field.label}: use up to 64 characters.`);
    return value;
  }
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
    throw Error(`${field.label}: enter a valid number.`);
  const n = Number(value);
  if (field.type === 'number') {
    if (!Number.isInteger(n) || n > 9999)
      throw Error(`${field.label}: enter a whole number from 0 to 9999.`);
    return String(n);
  }
  if (n <= 0 || n > 9999)
    throw Error(
      `${field.label}: enter a number greater than zero, up to 9999.`
    );
  if (field.type === 'weight' && ['kg', 'lb'].includes(entry.unit ?? ''))
    return `${n}${entry.unit}`;
  if (field.type === 'height' && entry.unit === 'cm') return `${n}cm`;
  const split =
    (field.type === 'weight' && entry.unit === 'st') ||
    (field.type === 'height' && entry.unit === 'ft');
  if (!split) throw Error(`${field.label}: choose a supported unit.`);
  const limit = entry.unit === 'st' ? 14 : 12;
  if (
    !Number.isInteger(n) ||
    !/^\d+(\.\d+)?$/.test(extra) ||
    Number(extra) >= limit
  )
    throw Error(
      `${field.label}: use whole ${entry.unit === 'st' ? 'stone' : 'feet'} and a remainder from 0 to under ${limit}.`
    );
  return entry.unit === 'st'
    ? `${n}st ${Number(extra)}lb`
    : `${n}'${Number(extra)}"`;
}
/** Places rendered field text into a format, tidying omitted fields away. */
function assembleFlair(format: string, rendered: Record<string, string>) {
  // A label immediately attached to an omitted field (e.g. SW:) goes with it.
  const text = format.replace(
    /(?:[\p{L}\p{N}_-]+:\s*)?\{(flair[1-8])\}/gu,
    (whole: string, id: string) =>
      rendered[id] ? whole.replace(`{${id}}`, rendered[id]!) : ''
  );
  return text
    .split(/\s*\|\s*/)
    .map((part) => part.replace(/^\s*(?:→|->)\s*|\s*(?:→|->)\s*$/g, '').trim())
    .filter(Boolean)
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function renderFlair(
  config: FlairConfig,
  formatId: string,
  values: Record<string, FlairValue>
) {
  const selected = config.formats.find((f) => f.id === formatId);
  if (!selected) throw Error('Choose an available flair format.');
  const invalid = validateFlairFormat(selected.format);
  if (invalid) throw Error(invalid);
  const rendered: Record<string, string> = {};
  for (const id of formatFields(selected.format)) {
    const field = config.fields.find((f) => f.id === id);
    if (!field)
      throw Error(
        'This format uses a disabled field. Ask a moderator to update it.'
      );
    rendered[id] = fieldText(field, values[id] ?? {});
  }
  const text = assembleFlair(selected.format, rendered);
  if (!text) throw Error('Enter at least one detail for your flair.');
  if (text.length > 64)
    throw Error(
      `Flair is ${text.length}/64 characters. Shorten a field or choose a shorter format.`
    );
  return text;
}

const valuePatterns: Record<string, string> = {
  number: '(\\d{1,4})',
  text: '(.+?)',
  weight: '(\\d+(?:\\.\\d+)?(?:kg|lb)|\\d+st \\d+(?:\\.\\d+)?lb)',
  height: '(\\d+(?:\\.\\d+)?cm|\\d+\'\\d+(?:\\.\\d+)?")',
};
function parseFieldText(type: string, text: string): FlairValue {
  if (type === 'weight') {
    const split = /^(\d+)st (\d+(?:\.\d+)?)lb$/.exec(text);
    if (split) return { value: split[1]!, extra: split[2]!, unit: 'st' };
    const single = /^(\d+(?:\.\d+)?)(kg|lb)$/.exec(text)!;
    return { value: single[1]!, unit: single[2]! };
  }
  if (type === 'height') {
    const split = /^(\d+)'(\d+(?:\.\d+)?)"$/.exec(text);
    if (split) return { value: split[1]!, extra: split[2]!, unit: 'ft' };
    return { value: text.slice(0, -2), unit: 'cm' };
  }
  return { value: text };
}
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reads a member's current flair back into form values when it is exactly
 * what one of the configured formats would produce. Every candidate is
 * re-rendered and must reproduce the flair exactly, so a near miss returns
 * undefined rather than a guess. Runs on the device; nothing is stored.
 */
export function parseFlair(
  config: FlairConfig,
  current: string
): { formatId: string; values: Record<string, FlairValue> } | undefined {
  const text = current.trim();
  if (!text) return undefined;
  let best:
    | { formatId: string; values: Record<string, FlairValue>; score: number }
    | undefined;
  let tied = false;
  for (const format of config.formats) {
    if (validateFlairFormat(format.format)) continue;
    const ids = formatFields(format.format);
    const fields = ids.map((id) => config.fields.find((f) => f.id === id));
    if (fields.some((f) => !f || !valuePatterns[f.type])) continue;
    const hasMeasured = fields.some((f) => f!.type !== 'text');
    // Try every combination of filled and omitted fields (at most 2^8).
    for (let mask = 1; mask < 1 << ids.length; mask++) {
      const present = ids.filter((_, i) => mask & (1 << i));
      const marks: Record<string, string> = {};
      present.forEach((id, i) => (marks[id] = `\uE000${i}\uE000`));
      const skeleton = assembleFlair(format.format, marks);
      const source = skeleton
        .split(/\uE000(\d+)\uE000/)
        .map((part, i) => {
          if (i % 2 === 0) return escapeRegExp(part);
          const field = fields[ids.indexOf(present[Number(part)]!)]!;
          // Beside measurements, free text (e.g. Gender) holds no digits,
          // labels or separators, so it cannot swallow "SW:250lbs".
          return field.type === 'text' && hasMeasured
            ? '([^|:\\d]+?)'
            : valuePatterns[field.type];
        })
        .join('');
      const match = new RegExp(`^${source}$`, 'u').exec(text);
      if (!match) continue;
      const values: Record<string, FlairValue> = {};
      present.forEach((id, i) => {
        const field = fields[ids.indexOf(id)]!;
        values[id] = parseFieldText(field.type, match[i + 1]!);
      });
      try {
        if (renderFlair(config, format.id, values) !== text) continue;
      } catch {
        continue;
      }
      // Prefer the most specific reading: measured fields, then field count.
      const measured = present.filter((id) => {
        const type = fields[ids.indexOf(id)]!.type;
        return type !== 'text';
      }).length;
      // Free text alone fits almost anything; trust it only in a format with
      // no measurements (e.g. "Personal text"), not as a stray Gender field.
      if (!measured && hasMeasured) continue;
      const score = measured * 100 + present.length;
      if (!best || score > best.score) {
        best = { formatId: format.id, values, score };
        tied = false;
      } else if (
        score === best.score &&
        JSON.stringify([format.id, values]) !==
          JSON.stringify([best.formatId, best.values])
      )
        tied = true;
    }
  }
  // Two equally good readings are ambiguous: prefill nothing.
  if (!best || tied) return undefined;
  return { formatId: best.formatId, values: best.values };
}

export type InferredUnits = {
  weight?: 'kg' | 'lb' | 'st';
  height?: 'cm' | 'ft';
};

/**
 * Infers preferred units from any flair text, including flair the app did not
 * create (e.g. "SW 250lbs"). Conflicting signals (kg and lb) give no answer.
 * Returns unit choices only, never the measurements.
 */
export function inferUnits(text: string): InferredUnits {
  const units: InferredUnits = {};
  const stone = /\d\s*st\b|\d\s*stone\b/i.test(text);
  const pounds = /\d\s*(?:lbs?|pounds?)\b/i.test(text);
  const kilos = /\d\s*(?:kgs?|kilos?)\b/i.test(text);
  if (stone && !kilos) units.weight = 'st';
  else if (pounds && !kilos) units.weight = 'lb';
  else if (kilos && !pounds && !stone) units.weight = 'kg';
  const cm = /\d\s*cm\b/i.test(text);
  const feet = /\d\s*['’′]\s*\d|\d\s*(?:ft|feet)\b/i.test(text);
  if (cm && !feet) units.height = 'cm';
  else if (feet && !cm) units.height = 'ft';
  return units;
}
