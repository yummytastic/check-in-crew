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
function fieldText(field: FlairField, entry: FlairValue): string {
  const value = typeof entry.value === 'string' ? entry.value.trim() : '';
  const extra = typeof entry.extra === 'string' ? entry.extra.trim() : '';
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
  // A label immediately attached to an omitted field (e.g. SW:) goes with it.
  let text = selected.format.replace(
    /(?:[\p{L}\p{N}_-]+:\s*)?\{(flair[1-8])\}/gu,
    (whole: string, id: string) =>
      rendered[id] ? whole.replace(`{${id}}`, rendered[id]!) : ''
  );
  text = text
    .split(/\s*\|\s*/)
    .map((part) => part.replace(/^\s*(?:→|->)\s*|\s*(?:→|->)\s*$/g, '').trim())
    .filter(Boolean)
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) throw Error('Enter at least one detail for your flair.');
  if (text.length > 64)
    throw Error(
      `Flair is ${text.length}/64 characters. Shorten a field or choose a shorter format.`
    );
  return text;
}
