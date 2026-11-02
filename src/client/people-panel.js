export function createPeoplePanel({ getState, save, getError }) {
  const dialog = document.querySelector('#hosts-dialog');
  const list = document.querySelector('#hosts-list');
  const status = document.querySelector('#people-status');
  const input = document.querySelector('#people-username');
  let series,
    month,
    revision,
    people = [],
    baseline = '',
    busy = false;
  const changed = () => JSON.stringify(people) !== baseline;
  function currentMonth() {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: series.timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
  }
  function monthEnd(value) {
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, month, 0)));
  }
  const expiryLabel = (value) =>
    `Remove access at end of month (${monthEnd(value)})`;
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
  function render(focusAction, focusIndex) {
    const admin = getState().admin;
    const hosts = people.filter((p) => p.host);
    list.innerHTML =
      people
        .map((person, index) => {
          const position = hosts.indexOf(person);
          const button = (action, text, extra = '') =>
            `<button type="button" class="secondary" data-person-action="${action}" data-person-index="${index}" ${extra}>${text}</button>`;
          return `<section class="person-row"><strong>u/${esc(person.username)}</strong><p class="muted">${person.host ? 'Host' : 'No host credit'} · ${person.maintainer ? 'Maintainer' : 'No management access'}</p>${admin ? `<div class="actions">${button('host', person.host ? 'Remove host' : 'Add host')}${button('maintainer', person.maintainer ? 'Remove maintainer' : 'Add maintainer')}${person.host ? button('up', '↑', `aria-label="Move ${esc(person.username)} up in host credit order" ${position === 0 ? 'disabled' : ''}`) + button('down', '↓', `aria-label="Move ${esc(person.username)} down in host credit order" ${position === hosts.length - 1 ? 'disabled' : ''}`) : ''}</div>${person.maintainer ? `<label class="checkbox-label"><input type="checkbox" data-person-expiry="${index}" ${person.through ? 'checked' : ''}><span data-expiry-label>${esc(expiryLabel(person.through || currentMonth()))}</span></label><p class="muted">Unchecked: access continues until removed. Uses the series timezone. Host credit is separate.</p>` : ''}` : person.maintainer ? `<p class="muted">Access: ${person.through ? 'ends ' + esc(monthEnd(person.through)) : 'no expiry'}</p>` : ''}</section>`;
        })
        .join('') ||
      '<p class="muted">No people assigned. Posts use the volunteer-team credit when the template includes host credit.</p>';
    status.textContent = changed() ? 'Unsaved people & access changes.' : '';
    list.querySelectorAll('[data-person-action]').forEach((button) =>
      button.addEventListener('click', () => {
        if (busy) return;
        const index = Number(button.dataset.personIndex),
          action = button.dataset.personAction;
        const person = people[index];
        if (action === 'host' || action === 'maintainer')
          person[action] = !person[action];
        else {
          const other =
            hosts[hosts.indexOf(person) + (action === 'up' ? -1 : 1)];
          if (!other) return;
          const target = people.indexOf(other);
          [people[index], people[target]] = [people[target], people[index]];
          render(action, target);
          return;
        }
        render(action, index);
      })
    );
    list.querySelectorAll('[data-person-expiry]').forEach((field) =>
      field.addEventListener('change', () => {
        const person = people[Number(field.dataset.personExpiry)];
        person.through = field.checked ? currentMonth() : '';
        field
          .closest('label')
          .querySelector('[data-expiry-label]').textContent = expiryLabel(
          person.through || currentMonth()
        );
        status.textContent = 'Unsaved people & access changes.';
      })
    );
    if (focusAction !== undefined) {
      const target = list.querySelector(
        `[data-person-action="${focusAction}"][data-person-index="${focusIndex}"]`
      );
      (target?.disabled
        ? target.closest('.person-row').querySelector('button')
        : target
      )?.focus();
    }
  }
  function add(role) {
    if (!getState().admin || busy) return;
    const username = input.value.trim().replace(/^u\//i, '');
    if (!/^[a-z0-9_-]{3,20}$/i.test(username)) {
      status.textContent = 'Enter one valid Reddit username.';
      input.focus();
      return;
    }
    let person = people.find(
      (p) => p.username.toLowerCase() === username.toLowerCase()
    );
    if (!person) {
      if (people.length >= 20) {
        status.textContent = 'Use at most 20 people per series.';
        return;
      }
      person = { username, host: false, maintainer: false, through: '' };
      people.push(person);
    }
    person[role] = true;
    input.value = '';
    render();
    input.focus();
  }
  function close() {
    if (
      !busy &&
      (!changed() || window.confirm('Discard unsaved people & access changes?'))
    )
      dialog.close();
  }
  document
    .querySelector('#people-add-host')
    .addEventListener('click', () => add('host'));
  document
    .querySelector('#people-add-maintainer')
    .addEventListener('click', () => add('maintainer'));
  document.querySelector('#people-close').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  window.addEventListener('beforeunload', (event) => {
    if (dialog.open && (changed() || busy)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.querySelector('#save-hosts').addEventListener('click', async () => {
    if (!series || !getState().admin || busy) return;
    busy = true;
    try {
      const saved = await save({
        action: 'people',
        revision,
        seriesId: series.id,
        hostMonth: month,
        people: people.filter((p) => p.host || p.maintainer),
      });
      if (saved) {
        baseline = JSON.stringify(people);
        dialog.close();
      } else status.textContent = getError();
    } finally {
      busy = false;
    }
  });
  return {
    open(id) {
      const state = getState();
      series = state.series.find((s) => s.id === id);
      if (!series) return;
      month = state.month;
      revision = state.revision;
      const names = new Map();
      for (const username of series.hosts)
        names.set(username.toLowerCase(), {
          username,
          host: true,
          maintainer: false,
          through: '',
        });
      for (const member of series.maintainers) {
        const key = member.username.toLowerCase();
        names.set(key, {
          ...(names.get(key) ?? { username: member.username, host: false }),
          maintainer: true,
          through: member.through ?? '',
        });
      }
      people = [...names.values()];
      baseline = JSON.stringify(people);
      document.querySelector('#hosts-title').textContent =
        `People & access — ${series.label}`;
      document.querySelector('#hosts-help').textContent =
        `Host selection for ${month}, also used in later months without their own saved selection. Access changes apply when saved. Removing a host here does not edit published posts. Only moderators can change roles.`;
      input.value = '';
      document.querySelector('#people-add').hidden = !state.admin;
      document.querySelector('#save-hosts').hidden = !state.admin;
      render();
      dialog.showModal();
    },
  };
}
