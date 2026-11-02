import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  flairDefaults,
  formatDefaults,
  inferUnits,
  parseFlair,
  renderFlair,
  validateFlairFormat,
  type FlairConfig,
} from './flair.ts';
const config: FlairConfig = {
  fields: flairDefaults
    .map(([label, type], i) => ({
      id: `flair${i + 1}`,
      label,
      type,
      help: '',
      required: false,
    }))
    .filter((f) => f.type !== 'disabled'),
  formats: formatDefaults.map(([name, format], i) => ({
    id: String(i + 1),
    name,
    format,
  })),
};
void test('flair defaults use only selected optional fields and clean empty labels/separators', () => {
  assert.equal(
    renderFlair(config, '1', {
      flair2: { value: 'F' },
      flair4: { value: '75', unit: 'kg' },
    }),
    'F | CW:75kg'
  );
  assert.equal(
    renderFlair(config, '3', { flair4: { value: '75', unit: 'kg' } }),
    '75kg'
  );
  assert.equal(
    renderFlair(config, '2', {
      flair3: { value: '12', extra: '12', unit: 'st' },
      flair4: { value: '180', unit: 'lb' },
    }),
    'SW:12st 12lb | CW:180lb'
  );
  assert.equal(
    renderFlair(config, '1', {
      flair6: { value: '5', extra: '10', unit: 'ft' },
    }),
    '5\'10"'
  );
  assert.equal(
    renderFlair(config, '5', {
      flair7: { value: 'My custom flair' },
      flair1: { value: 'invalid' },
    }),
    'My custom flair'
  );
});
void test('flair validates units, limits, configured fields, and required details', () => {
  assert.throws(() => renderFlair(config, '1', {}), /at least one/);
  assert.throws(
    () =>
      renderFlair(config, '2', {
        flair3: { value: '12', extra: '14', unit: 'st' },
      }),
    /under 14/
  );
  assert.throws(
    () =>
      renderFlair(config, '1', {
        flair6: { value: '5', extra: '12', unit: 'ft' },
      }),
    /under 12/
  );
  assert.throws(
    () =>
      renderFlair(config, '2', { flair3: { value: '75', unit: 'made-up' } }),
    /supported unit/
  );
  assert.throws(
    () => renderFlair(config, '5', { flair7: { value: 'x'.repeat(65) } }),
    /64/
  );
  assert.throws(
    () => renderFlair(config, '5', { flair7: { value: 'hello\nworld' } }),
    /plain text/
  );
  assert.throws(
    () =>
      renderFlair(
        { ...config, fields: config.fields.filter((f) => f.id !== 'flair3') },
        '2',
        {}
      ),
    /disabled field/
  );
  assert.throws(
    () =>
      renderFlair(
        {
          ...config,
          fields: config.fields.map((f) => ({ ...f, required: true })),
        },
        '1',
        {}
      ),
    /required/
  );
  assert.ok(validateFlairFormat('{unknown}'));
  assert.ok(validateFlairFormat('{flair9}'));
  assert.equal(validateFlairFormat('{flair8}'), undefined);
});
void test('flair measurements accept a decimal comma and show a decimal point', () => {
  assert.equal(
    renderFlair(config, '3', { flair4: { value: '72,5', unit: 'kg' } }),
    '72.5kg'
  );
  assert.equal(
    renderFlair(config, '3', {
      flair4: { value: '11', extra: '6,5', unit: 'st' },
    }),
    '11st 6.5lb'
  );
  assert.throws(() =>
    renderFlair(config, '3', { flair4: { value: '1,2,3', unit: 'kg' } })
  );
});
void test('current flair is read back only when a format reproduces it exactly', () => {
  // Every value rendered by a format parses back to the same flair.
  const samples: [
    string,
    Record<string, { value: string; unit?: string; extra?: string }>,
  ][] = [
    [
      '1',
      {
        flair1: { value: '34' },
        flair2: { value: 'F' },
        flair6: { value: '5', extra: '6', unit: 'ft' },
        flair3: { value: '210', unit: 'lb' },
        flair4: { value: '180.5', unit: 'lb' },
        flair5: { value: '150', unit: 'lb' },
      },
    ],
    ['1', { flair2: { value: 'M' }, flair4: { value: '95', unit: 'kg' } }],
    [
      '2',
      {
        flair3: { value: '16', extra: '4', unit: 'st' },
        flair4: { value: '14', extra: '0', unit: 'st' },
      },
    ],
    ['5', { flair7: { value: 'Slow and steady | day 40' } }],
  ];
  for (const [formatId, values] of samples) {
    const text = renderFlair(config, formatId, values);
    const parsed = parseFlair(config, text);
    assert.ok(parsed, text);
    assert.equal(renderFlair(config, parsed.formatId, parsed.values), text);
  }
  const full = parseFlair(config, '34F | 5\'6" | SW:210lb CW:180.5lb GW:150lb');
  assert.equal(full?.formatId, '1');
  assert.deepEqual(full?.values.flair4, { value: '180.5', unit: 'lb' });
  assert.deepEqual(full?.values.flair6, { value: '5', extra: '6', unit: 'ft' });
  // Two formats could both have produced this (start → current, or
  // current → goal), so nothing is prefilled rather than guessing.
  assert.equal(parseFlair(config, '120kg → 98.2kg'), undefined);
  // A measured reading wins over reading everything as personal text.
  assert.equal(parseFlair(config, 'SW:120kg | CW:98.2kg')?.formatId, '2');
  // Text the formats cannot produce is only ever personal text, never a guess.
  assert.deepEqual(parseFlair(config, 'SW 250lbs, CW 230'), {
    formatId: '5',
    values: { flair7: { value: 'SW 250lbs, CW 230' } },
  });
  assert.equal(parseFlair(config, ''), undefined);
  const noText: FlairConfig = {
    ...config,
    formats: config.formats.filter((f) => f.id !== '5'),
  };
  assert.equal(parseFlair(noText, 'SW 250lbs, CW 230'), undefined);
  assert.equal(parseFlair(noText, 'SW:250lbs | CW:230lb'), undefined);
});
void test('units are inferred from any flair text without conflicting signals', () => {
  assert.deepEqual(inferUnits('SW 250lbs CW 230'), { weight: 'lb' });
  assert.deepEqual(inferUnits('34F | 5\'6" | SW:210lb'), {
    weight: 'lb',
    height: 'ft',
  });
  assert.deepEqual(inferUnits('5’6” 11st 6lb'), { weight: 'st', height: 'ft' });
  assert.deepEqual(inferUnits('168cm | 72.5kg → 65kg'), {
    weight: 'kg',
    height: 'cm',
  });
  assert.deepEqual(inferUnits('100kg / 220lb'), {});
  assert.deepEqual(inferUnits('Slow and steady'), {});
  assert.deepEqual(inferUnits('5 ft 6, 90 kilos'), {
    weight: 'kg',
    height: 'ft',
  });
});
