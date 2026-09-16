import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  flairDefaults,
  formatDefaults,
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
