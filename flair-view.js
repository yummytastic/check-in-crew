import { formatFields, renderFlair } from './src/tools/flair.ts';

// Deliberately independent of calculator state. Only Apply sends the selected fields.
export function createFlairView(root, { back }) {
  let config,
    formatId = '',
    stage = 'loading',
    notice = '',
    busy = false,
    generation = 0;
  const values = {};
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  const selectedValues = () =>
    Object.fromEntries(
      formatFields(
        config.formats.find((f) => f.id === formatId)?.format ?? ''
      ).map((id) => [id, values[id] ?? {}])
    );
  function preview() {
    try {
      return { text: renderFlair(config, formatId, selectedValues()) };
    } catch (error) {
      return { error: error.message };
    }
  }
  function field(field) {
    const v = (values[field.id] ??= {
      value: '',
      extra: '',
      unit: field.type === 'weight' ? 'kg' : 'cm',
    });
    const options =
      field.type === 'weight'
        ? [
            ['kg', 'kg'],
            ['lb', 'lb'],
            ['st', 'stone & lb'],
          ]
        : field.type === 'height'
          ? [
              ['cm', 'cm'],
              ['ft', 'feet & inches'],
            ]
          : [];
    const split = options.length && ['st', 'ft'].includes(v.unit);
    const label =
      field.label + (field.required ? ' (required)' : ' (optional)');
    return `<fieldset class="flair-field"><legend>${esc(label)}</legend>${options.length ? `<label class="flair-units">Units<select data-flair="${field.id}" data-part="unit">${options.map(([id, label]) => `<option value="${id}"${v.unit === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}<div class="${split ? 'split-measurement' : ''}"><label>${split ? (v.unit === 'st' ? 'Stone' : 'Feet') : 'Value'}<input data-flair="${field.id}" data-part="value" type="text" inputmode="${field.type === 'text' ? 'text' : field.type === 'number' || split ? 'numeric' : 'decimal'}" maxlength="64" autocomplete="off" value="${esc(v.value)}"></label>${split ? `<label>${v.unit === 'st' ? 'Pounds' : 'Inches'}<input data-flair="${field.id}" data-part="extra" type="text" inputmode="decimal" maxlength="16" autocomplete="off" value="${esc(v.extra)}"></label>` : ''}</div>${field.help ? `<p class="public-muted">${esc(field.help)}</p>` : ''}</fieldset>`;
  }
  function render() {
    let content = '',
      footer =
        '<button type="button" class="secondary" id="flair-back">Back</button>';
    if (stage === 'loading')
      content = '<p role="status">Loading your flair…</p>';
    if (stage === 'error') {
      content = `<p role="status">${esc(notice)}</p>`;
      footer += '<button type="button" id="flair-retry">Try again</button>';
    }
    if (stage === 'edit') {
      content = `<p>Current flair: <strong>${esc(config.current.text || 'None')}</strong></p><p class="public-muted">This is separate from the calculator. Choose which details to make public beside your username in r/${esc(config.community)}.</p>${
        config.protectedFlair
          ? '<p>Your current flair is protected. Ask a moderator to help change it.</p>'
          : `<label>Flair format<select id="flair-format">${config.formats.map((f) => `<option value="${f.id}"${formatId === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label><form id="flair-form" autocomplete="off" novalidate><div class="calculator-grid">${formatFields(
              config.formats.find((f) => f.id === formatId)?.format ?? ''
            )
              .map((id) => config.fields.find((f) => f.id === id))
              .filter(Boolean)
              .map(field)
              .join(
                ''
              )}</div></form><p class="public-muted">Unit selection labels your entry; it does not convert it. Enter the value in the selected units.</p><section aria-label="Flair preview"><h2>Preview</h2><p id="flair-preview" class="flair-preview"></p><p id="flair-validation" class="public-muted" aria-live="polite"></p></section>`
      }`;
      if (!config.protectedFlair)
        footer +=
          '<button type="submit" form="flair-form" id="flair-review">Review flair</button>';
    }
    if (stage === 'confirm') {
      content = `<p>This will replace your current public flair in r/${esc(config.community)}.</p><p>Current: ${esc(config.current.text || 'None')}</p><h2>New flair</h2><p class="flair-preview">${esc(preview().text)}</p><p>The selected details will be sent to Reddit and appear beside your username. They are not saved in this app’s database.</p><p role="status">${esc(notice)}</p>`;
      footer =
        '<button type="button" class="secondary" id="flair-edit">Edit</button><button type="button" id="flair-apply">Apply flair</button>';
    }
    if (stage === 'done')
      content = `<p role="status">Your flair has been updated in r/${esc(config.community)}.</p><p class="flair-preview">${esc(notice)}</p>`;
    root.innerHTML = `<div class="public-screen" data-public-screen="flair"><h1 tabindex="-1">Set my flair</h1><div class="public-content">${content}</div><div class="public-footer">${footer}</div></div>`;
    root.querySelector('#flair-back')?.addEventListener('click', (event) => {
      generation++;
      back(event);
    });
    root.querySelector('#flair-retry')?.addEventListener('click', open);
    root.querySelector('#flair-edit')?.addEventListener('click', () => {
      stage = 'edit';
      render();
    });
    root.querySelector('#flair-format')?.addEventListener('change', (e) => {
      formatId = e.target.value;
      render();
    });
    root.querySelectorAll('[data-flair]').forEach((input) =>
      input.addEventListener('input', () => {
        values[input.dataset.flair][input.dataset.part] = input.value;
        if (input.dataset.part === 'unit') render();
        else updatePreview();
      })
    );
    root.querySelector('#flair-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!preview().error && !config.protectedFlair) {
        stage = 'confirm';
        notice = '';
        render();
      }
    });
    root.querySelector('#flair-apply')?.addEventListener('click', apply);
    // A protected existing flair intentionally has no editable form or preview.
    if (stage === 'edit' && !config.protectedFlair) updatePreview();
  }
  function updatePreview() {
    const result = preview();
    root.querySelector('#flair-preview').textContent = result.text ?? '—';
    root.querySelector('#flair-validation').textContent =
      result.error ?? `${result.text.length}/64 characters`;
    root.querySelector('#flair-review').disabled = Boolean(
      result.error || config.protectedFlair
    );
  }
  async function open() {
    const request = ++generation;
    stage = 'loading';
    render();
    try {
      const response = await fetch('/api/flair');
      const data = await response.json();
      if (request !== generation) return;
      if (!response.ok)
        throw Error(data.error || 'Could not load flair. Please retry.');
      config = data;
      if (!config.formats.length)
        throw Error(
          'No flair formats are enabled. Ask a moderator to configure one.'
        );
      if (!config.formats.some((f) => f.id === formatId))
        formatId = config.formats[0].id;
      stage = 'edit';
      render();
    } catch (error) {
      if (request === generation) {
        stage = 'error';
        notice = error.message;
        render();
      }
    }
  }
  async function apply() {
    if (busy) return;
    busy = true;
    root.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const response = await fetch('/api/flair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formatId,
          values: selectedValues(),
          preview: preview().text,
          previous: config.current,
          confirm: true,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(
          data.error ||
            'Could not apply flair. Reopen the tool to check your current flair.'
        );
      notice = data.text;
      stage = 'done';
    } catch (error) {
      notice =
        error.message +
        ' You can go back and reopen Set flair to check the current value before retrying.';
    } finally {
      busy = false;
      render();
    }
  }
  return {
    open,
    cancel() {
      generation++;
    },
  };
}
