import {
  getWebViewMode,
  navigateTo,
  requestExpandedMode,
} from '@devvit/web/client';
import { createPublicView } from './public-view.js';
import { createPeoplePanel } from './people-panel.js';

const managementView = document.querySelector('#management-view');
const publicRoot = document.querySelector('#public-view');
let authorised = false;
let publicOptionsRequest = 0;
const publicView = createPublicView(publicRoot, {
  openFlair: (event) => {
    if (getWebViewMode() === 'expanded') return false;
    requestExpandedMode(event, 'flair');
    return true;
  },
  checkAccess: async () => {
    await Promise.all([loadPublicOptions(), load()]);
  },
  openDashboard: (event) => {
    publicView.setDashboardOpening(true);
    if (!authorised) {
      void load();
      return;
    }
    if (viewMode === 'expanded') {
      void load({ preserveDrafts: true });
      return;
    }
    try {
      requestExpandedMode(event, 'dashboard');
      window.setTimeout(syncViewMode, 250);
    } catch {
      publicView.setAccess('failed');
    }
  },
  navigate: (url) => navigateTo(url),
});
function showManagement(show) {
  managementView.hidden = !show;
  managementView.inert = !show;
  publicRoot.hidden = show;
  if (!show)
    document
      .querySelectorAll('dialog[open]')
      .forEach((dialog) => dialog.close());
}
async function loadPublicOptions() {
  const request = ++publicOptionsRequest;
  try {
    const response = await fetch('/api/public');
    if (!response.ok) throw Error('Unable to load community tools.');
    const data = await response.json();
    if (request === publicOptionsRequest) publicView.setOptions(data);
  } catch {
    if (request === publicOptionsRequest)
      publicView.setOptions({ calculatorEnabled: false, failed: true });
  }
}

const app = document.querySelector('#app');
const message = document.querySelector('#message');
const adminTools = document.querySelector('#admin-tools');
const privacyTools = document.querySelector('#privacy-tools');
const createPanel = document.querySelector('#create-panel');
const month = { value: '' };
const monthSelect = document.querySelector('#view-month');
const yearSelect = document.querySelector('#view-year');
const dirtyGroups = new Set();
let saving = false;
let lastCreatedId;
let dashboardRequest = 0;
const selected = new Set();
const openSeries = new Map();
let state;
let seriesView = 'current';
let viewMode = getWebViewMode();
const timezoneHelp =
  '<button type="button" class="timezone-help" data-timezone-picker>Find and copy an IANA timezone ↗</button>';
function openTimezonePicker(event) {
  event.preventDefault();
  navigateTo('https://yummytastic.github.io/check-in-crew/timezones/');
}
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
const labels = { signup: 'Start', daily: 'Daily check-in', roundup: 'Finish' };
const typeDescriptions = {
  accountability:
    'A month-long event with a start post, daily check-ins, and a finish post. Repeats each calendar month.',
  simple:
    'One post template repeated daily, weekly, or on a custom schedule. Other patterns are configured after creation.',
};
function syncCreateFields() {
  const simple =
    document.querySelector('#create-series-type').value === 'simple';
  const weekly = document.querySelector('#create-frequency').value === 'weekly';
  document.querySelector('#create-type-help').textContent =
    typeDescriptions[simple ? 'simple' : 'accountability'];
  for (const [id, show] of Object.entries({
    'create-frequency': simple,
    'create-weekday': simple && weekly,
    'create-signup': !simple,
    'create-roundup': !simple,
  })) {
    const control = document.getElementById(id);
    control.closest('label').hidden = !show;
    control.disabled = !show;
  }
  document.querySelector('#create-post-label').textContent = simple
    ? 'Post highlighting'
    : 'Daily check-in';
}
const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const stickyLabels = {
  none: 'Not stickied',
  slot1: 'Sticky slot 1',
  slot2: 'Sticky slot 2',
};
function titleShortcodes(series) {
  return series.seriesType === 'simple'
    ? [
        '{frequency}',
        '{series}',
        '{weekday}',
        '{date}',
        '{time}',
        '{day}',
        '{month}',
      ]
    : ['{series}', '{month}', '{day}', '{weekday}', '{date}'];
}
const shortcodeLabels = {
  '{frequency}': 'Daily / Weekly',
  '{series}': 'Display name',
  '{weekday}': 'Weekday',
  '{date}': 'Date',
  '{time}': 'Posting time',
  '{day}': 'Day number',
  '{month}': 'Month and year',
};
function todayMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
month.value = todayMonth();
monthSelect.innerHTML = Array.from(
  { length: 12 },
  (_, i) =>
    `<option value="${String(i + 1).padStart(2, '0')}">${new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 1)))}</option>`
).join('');
yearSelect.innerHTML = Array.from(
  { length: 3 },
  (_, i) => `<option>${new Date().getFullYear() - 1 + i}</option>`
).join('');
function syncMonthControls() {
  yearSelect.value = month.value.slice(0, 4);
  monthSelect.value = month.value.slice(5, 7);
}
syncMonthControls();
function editGroup(key) {
  return [...document.querySelectorAll('[data-edit-group]')].find(
    (group) => group.dataset.editGroup === key
  );
}
function feedback(key, text, error = false) {
  const group = editGroup(key);
  if (!group) return;
  let status = group.querySelector('[data-save-status]');
  if (!status) {
    status = document.createElement('p');
    status.dataset.saveStatus = '';
    status.setAttribute('role', 'status');
    (group.querySelector('.actions') ?? group).append(status);
  }
  status.className = error ? 'save-status error' : 'save-status muted';
  status.textContent = text;
}
function markDirty(target) {
  const group = target.closest('[data-edit-group]');
  if (!group) return;
  dirtyGroups.add(group.dataset.editGroup);
  feedback(group.dataset.editGroup, 'Unsaved changes');
}
function syncEditors(root = document) {
  root.querySelectorAll('[data-title-default]').forEach((input) => {
    const group = input.closest('.title-format');
    group.querySelector('[data-title]').hidden = input.checked;
    group.querySelector('.shortcodes').hidden = input.checked;
    group.querySelector('[data-title-summary]').hidden = !input.checked;
  });
  root.querySelectorAll('[data-body-default]').forEach((input) => {
    const group = input.closest('.body-format');
    group.querySelector('[data-body-editor]').hidden = input.checked;
    group.querySelector('[data-body-summary]').hidden = !input.checked;
  });
  root.querySelectorAll('[data-host-default]').forEach((input) => {
    const group = input.closest('.title-format');
    group.querySelector('[data-host-credit]').hidden = input.checked;
    group.querySelector('[data-host-summary]').hidden = !input.checked;
  });
  document.querySelectorAll('[data-title-example]').forEach((example) => {
    const card = example.closest('[data-series-id]');
    const series = state?.series.find(
      (item) => item.id === card.dataset.seriesId
    );
    if (!series) return;
    const kind = example.dataset.titleExample;
    const group = example.closest('.title-format');
    const format = group.querySelector('[data-title-default]').checked
      ? series.defaultTitles[kind]
      : group.querySelector('[data-title]').value;
    const date =
      series.days.find((day) => day.kind === kind)?.date ?? series.exampleDate;
    const day = new Date(date + 'T12:00:00Z');
    const values = {
      series: card.querySelector('[data-label]')?.value ?? series.label,
      frequency:
        series.frequency === 'weekly'
          ? 'Weekly'
          : series.frequency === 'other'
            ? 'Recurring'
            : 'Daily',
      time: series.days.find((day) => day.kind === kind)?.time ?? series.time,
      day: String(day.getUTCDate()),
      date,
      month: new Intl.DateTimeFormat('en', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(day),
      weekday: new Intl.DateTimeFormat('en', {
        weekday: 'long',
        timeZone: 'UTC',
      }).format(day),
    };
    example.textContent =
      'Example: ' +
      format.replace(
        /\{(series|frequency|day|date|time|month|weekday)\}/g,
        (_, key) => values[key]
      );
  });
}
for (const event of ['input', 'change'])
  document.addEventListener(event, (e) => {
    if (e.target.closest('[data-edit-group]')) {
      markDirty(e.target);
      syncEditors();
    }
  });
function mayDiscard() {
  return (
    !saving &&
    (!dirtyGroups.size || window.confirm('Discard unsaved dashboard changes?'))
  );
}
window.addEventListener('beforeunload', (event) => {
  if (dirtyGroups.size || saving) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function syncViewMode() {
  const next = getWebViewMode();
  if (next !== viewMode) {
    viewMode = next;
    load({ preserveDrafts: true });
  }
}
window.addEventListener('focus', syncViewMode);
document.addEventListener('visibilitychange', syncViewMode);
async function load({ preserveDrafts = false, savedGroup } = {}) {
  const request = ++dashboardRequest;
  authorised = false;
  showManagement(false);
  publicView.setAccess('checking');
  message.textContent = 'Loading schedule…';
  message.className = 'notice';
  try {
    const accessResponse = await fetch('/api/access');
    const accessData = await accessResponse.json();
    if (request !== dashboardRequest) return false;
    if (
      !accessResponse.ok ||
      !['authorised', 'signed-out', 'unassigned'].includes(accessData.access)
    )
      throw Error('Could not check access. Please retry.');
    publicView.setAccess(accessData.access);
    if (accessData.access !== 'authorised') {
      state = undefined;
      app.innerHTML = '';
      adminTools.innerHTML = '';
      dirtyGroups.clear();
      publicView.setDashboardOpening(false);
      return false;
    }
    if (viewMode !== 'expanded') {
      authorised = true;
      publicView.setDashboardOpening(false);
      return true;
    }
    const response = await fetch(
      '/api/dashboard?month=' +
        encodeURIComponent(month.value) +
        '&view=' +
        seriesView
    );
    const data = await response.json();
    if (request !== dashboardRequest) return false;
    if (!response.ok)
      throw new Error(data.error || 'Unable to load dashboard.');
    const drafts = new Map();
    if (preserveDrafts)
      for (const key of dirtyGroups) {
        if (key === savedGroup) continue;
        const group = editGroup(key);
        if (group)
          drafts.set(
            key,
            [...group.querySelectorAll('input, textarea, select')].map(
              (input) => ({ value: input.value, checked: input.checked })
            )
          );
      }
    state = data;
    authorised = true;
    showManagement(viewMode === 'expanded');
    publicView.setDashboardOpening(false);
    if (viewMode === 'expanded') render();
    dirtyGroups.clear();
    for (const [key, values] of drafts) {
      const group = editGroup(key);
      if (!group) continue;
      group.querySelectorAll('input, textarea, select').forEach((input, i) => {
        if (!values[i]) return;
        input.value = values[i].value;
        if (input.type === 'checkbox') input.checked = values[i].checked;
      });
      dirtyGroups.add(key);
      feedback(key, 'Unsaved changes');
    }
    syncEditors();
    if (savedGroup) feedback(savedGroup, 'Saved');
    message.textContent =
      seriesView === 'archived'
        ? 'Archived series do not publish or count toward the series limit. Restore a series to bring it back paused. Use View month to review its publication history.'
        : 'Signed in as u/' +
          data.username +
          '. Changes are checked again on the server. ' +
          (data.manualPostingAllowed
            ? 'Manual posting is enabled; “Post now” publishes any unposted topic immediately, even if its series is paused.'
            : 'Manual posting is disabled in app settings; scheduled posting is unaffected.');
    return true;
  } catch (error) {
    if (request !== dashboardRequest) return false;
    authorised = false;
    showManagement(false);
    publicView.setAccess('failed');
    publicView.setDashboardOpening(false);
    message.textContent = error.message;
    message.className = 'notice error';
    return false;
  }
}
function statusText(item) {
  if (item.status === 'scheduled') return 'Scheduled';
  if (item.status === 'not-posted') return 'Not posted';
  return item.status[0].toUpperCase() + item.status.slice(1);
}
function publicationDetails(item) {
  if (!item.publicationActor) return '';
  const source =
    item.publicationActor === 'scheduler'
      ? 'Automatic scheduler'
      : item.publicationActor.startsWith('automoderator:')
        ? 'Legacy AutoModerator trigger'
        : 'Manually by u/' + item.publicationActor;
  const at = item.publicationAt
    ? new Date(item.publicationAt).toLocaleString()
    : '';
  return `<div class="meta">${esc(source)}${at ? `<br><time datetime="${esc(item.publicationAt)}">${esc(at)}</time>` : ''}</div>`;
}
function draftMarkup(series) {
  if (!series.unscheduledDrafts?.length) return '';
  return `<details class="unscheduled"><summary>Unscheduled drafts (${series.unscheduledDrafts.length})</summary><p class="muted">These edited posts no longer match the current schedule. Published history remains intact.</p>${series.unscheduledDrafts.map((draft) => `<div class="draft-row"><span>${esc(draft.slot.date)} ${esc(draft.slot.time ?? '')} — ${esc(draft.title ?? 'Custom post')}</span><button class="secondary" data-reassign-draft="${esc(series.id)}" data-draft-key="${esc(draft.key)}">Move to upcoming post</button><button class="secondary" data-discard-draft="${esc(series.id)}" data-draft-key="${esc(draft.key)}">Discard draft</button></div>`).join('')}</details>`;
}
function schedulePayload(seriesId) {
  const frequency = document.querySelector('#schedule-frequency').value;
  const pattern = document.querySelector('#schedule-unit').value;
  const unit = pattern.startsWith('months') ? 'months' : pattern;
  const interval = Number(document.querySelector('#schedule-interval').value);
  const weekdays = [
    ...document.querySelectorAll('[data-schedule-weekday]:checked'),
  ].map((input) => Number(input.value));
  const endMode = document.querySelector('#schedule-end').value;
  return {
    action: 'schedulePreview',
    revision: state.revision,
    seriesId: seriesId,
    timezone: document.querySelector('#schedule-timezone').value,
    schedule: {
      frequency,
      unit,
      interval,
      start: document.querySelector('#schedule-start').value,
      weekdays:
        frequency === 'weekly'
          ? [Number(document.querySelector('#schedule-weekday').value)]
          : weekdays,
      monthMode: document.querySelector('#schedule-month-mode').value,
      monthDay: Number(document.querySelector('#schedule-month-day').value),
      ordinal: Number(document.querySelector('#schedule-ordinal').value),
      monthWeekday: Number(
        document.querySelector('#schedule-month-weekday').value
      ),
      shortMonth: document.querySelector('#schedule-short-month').value,
      ...(endMode === 'date'
        ? { endDate: document.querySelector('#schedule-end-date').value }
        : {}),
      ...(endMode === 'count'
        ? {
            maxPosts: Number(
              document.querySelector('#schedule-max-posts').value
            ),
          }
        : {}),
    },
  };
}
function syncScheduleFields() {
  const frequency = document.querySelector('#schedule-frequency').value;
  const pattern = document.querySelector('#schedule-unit').value;
  const unit = pattern.startsWith('months') ? 'months' : pattern;
  const monthMode =
    pattern === 'months-last'
      ? 'last'
      : pattern === 'months-weekday'
        ? 'weekday'
        : 'day';
  document.querySelector('#schedule-month-mode').value = monthMode;
  const weekly = unit === 'weeks';
  const monthly = unit === 'months';
  document.querySelector('#schedule-interval-field').hidden =
    frequency !== 'other';
  document.querySelector('#schedule-unit-field').hidden = frequency !== 'other';
  document.querySelector('#schedule-weekdays-field').hidden =
    !weekly || frequency !== 'other';
  document.querySelector('#schedule-weekday-field').hidden =
    frequency !== 'weekly';
  document.querySelector('#schedule-month-options').hidden = !monthly;
  document.querySelector('#schedule-month-day-field').hidden =
    !monthly || monthMode !== 'day';
  document.querySelector('#schedule-month-weekday-field').hidden =
    !monthly || monthMode !== 'weekday';
  document.querySelector('#schedule-month-weekday-select-field').hidden =
    !monthly || monthMode !== 'weekday';
  document.querySelector('#schedule-short-month-field').hidden =
    !monthly || monthMode !== 'day';
  document.querySelector('#schedule-interval-label').textContent =
    `Repeat every (${unit})`;
  document.querySelector('#schedule-pattern-help').textContent =
    frequency === 'daily'
      ? 'One post each day at the selected local time.'
      : frequency === 'weekly'
        ? 'One post each week on the selected day.'
        : {
            days: 'For example, every 3 days from the chosen start date.',
            weeks:
              'For example, every 2 weeks on Monday and Thursday. Weeks start on Monday.',
            months:
              'For example, every month on the 15th. Choose how to handle shorter months below.',
            'months-last':
              'Use the actual final day: February 28 or 29, April 30, and so on. Set the interval to 1 for every month.',
            'months-weekday':
              'Choose a position and weekday below, such as first Monday or last Friday. Set the interval to 1 for every month.',
            hours:
              'For example, every 6 hours from the chosen start date and time.',
          }[pattern];
  document.querySelector('#schedule-hours-note').hidden =
    frequency !== 'other' || unit !== 'hours';
  document.querySelector('#schedule-end-date-field').hidden =
    document.querySelector('#schedule-end').value !== 'date';
  document.querySelector('#schedule-max-posts-field').hidden =
    document.querySelector('#schedule-end').value !== 'count';
}
function syncScheduleFrequency() {
  const frequency = document.querySelector('#schedule-frequency').value;
  const unit = document.querySelector('#schedule-unit');
  const interval = document.querySelector('#schedule-interval');
  if (frequency === 'daily') {
    unit.value = 'days';
    interval.value = '1';
  } else if (frequency === 'weekly') {
    unit.value = 'weeks';
    interval.value = '1';
  }
  syncScheduleFields();
}
let scheduleSeriesId;
function openSchedule(seriesId) {
  scheduleSeriesId = seriesId;
  const series = state.series.find((item) => item.id === seriesId);
  if (!series) return;
  const now = new Date();
  const date = new Date(now.getTime() + 86400000);
  const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${series.time}`;
  document.querySelector('#schedule-title').textContent =
    `Change schedule — ${series.label}`;
  document.querySelector('#schedule-timezone').value = series.timezone;
  document.querySelector('#schedule-start').value =
    series.schedule?.start ?? start;
  document.querySelector('#schedule-frequency').value =
    series.frequency === 'other' ? 'other' : series.frequency;
  document.querySelector('#schedule-interval').value =
    series.schedule?.interval ?? 1;
  document.querySelector('#schedule-unit').value =
    series.schedule?.unit === 'months' && series.schedule.monthMode !== 'day'
      ? `months-${series.schedule.monthMode}`
      : (series.schedule?.unit ??
        (series.frequency === 'weekly' ? 'weeks' : 'days'));
  document.querySelector('#schedule-weekday').value =
    series.schedule?.weekdays?.[0] ?? series.weekday;
  document
    .querySelectorAll('[data-schedule-weekday]')
    .forEach(
      (input) =>
        (input.checked =
          series.schedule?.weekdays?.includes(Number(input.value)) ??
          Number(input.value) === series.weekday)
    );
  document.querySelector('#schedule-month-mode').value =
    series.schedule?.monthMode ?? 'day';
  document.querySelector('#schedule-month-day').value =
    series.schedule?.monthDay ?? 1;
  document.querySelector('#schedule-ordinal').value =
    series.schedule?.ordinal ?? 1;
  document.querySelector('#schedule-month-weekday').value =
    series.schedule?.monthWeekday ?? series.weekday;
  document.querySelector('#schedule-short-month').value =
    series.schedule?.shortMonth ?? 'last';
  document.querySelector('#schedule-end').value = series.schedule?.endDate
    ? 'date'
    : series.schedule?.maxPosts
      ? 'count'
      : 'pause';
  document.querySelector('#schedule-end-date').value =
    series.schedule?.endDate ?? '';
  document.querySelector('#schedule-max-posts').value =
    series.schedule?.maxPosts ?? 5;
  document.querySelector('#schedule-error').hidden = true;
  document.querySelector('#schedule-result').hidden = true;
  syncScheduleFields();
  const hourlyOption = document.querySelector(
    '#schedule-unit option[value="hours"]'
  );
  hourlyOption.disabled = !state.hourlyAllowed;
  hourlyOption.hidden = !state.hourlyAllowed;
  hourlyOption.textContent = state.hourlyAllowed
    ? 'Every X hours'
    : 'Every X hours — enable in app settings';
  document.querySelector('#schedule-hours-note').textContent =
    state.hourlyAllowed
      ? 'Hourly schedules are enabled in app settings. Use them only for clear event-based needs.'
      : 'To use hourly schedules, ask a moderator to open app settings → General → Allow hourly schedules, enable it, then refresh this dashboard.';
  const dialog = document.querySelector('#schedule-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
async function previewSchedule() {
  const error = document.querySelector('#schedule-error');
  error.hidden = true;
  document.querySelector('#schedule-result').hidden = true;
  try {
    const response = await fetch('/api/dashboard/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedulePayload(scheduleSeriesId)),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Unable to preview schedule.');
    document.querySelector('#schedule-result').textContent =
      `${data.summary}\n\nNext posts:\n${data.slots.map((slot) => `${slot.date} ${slot.time ?? ''}`).join('\n') || 'No posts in the preview window.'}${data.displaced ? `\n\n${data.displaced} edited post(s) would become unscheduled drafts.` : ''}`;
    document.querySelector('#schedule-result').hidden = false;
    return data;
  } catch (caught) {
    error.textContent = caught.message;
    error.hidden = false;
  }
}
async function saveSchedule() {
  const data = await previewSchedule();
  if (
    !data ||
    !window.confirm(
      'Apply this schedule from the selected start time? Published history will remain available.'
    )
  )
    return;
  const saved = await send({
    ...schedulePayload(scheduleSeriesId),
    action: 'scheduleSave',
    confirmed: true,
  });
  if (!saved) {
    document.querySelector('#schedule-error').textContent = message.textContent;
    document.querySelector('#schedule-error').hidden = false;
    return;
  }
  const dialog = document.querySelector('#schedule-dialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}
function deletePostButton(seriesId, entry, pending = false) {
  return state.canDeletePosts &&
    !pending &&
    ['posted', 'deleting'].includes(entry.status)
    ? `<button class="danger" data-delete-post="${esc(seriesId)}" data-publication-key="${esc(entry.publicationKey)}">${entry.status === 'deleting' ? 'Retry deletion' : 'Delete post'}</button>`
    : '';
}
function seriesDeletionMarkup(series) {
  const job = series.deletion;
  if (!job)
    return state.admin
      ? `<button data-unarchive="${esc(series.id)}">Restore series</button> <button class="danger" data-delete-series="${esc(series.id)}">Permanently delete series</button>`
      : '';
  const waiting = job.state === 'waiting';
  const canCancel = waiting && Date.parse(job.dueAt) > Date.now();
  return `<div class="notice"><strong>${waiting ? 'Deletion scheduled' : job.state === 'failed' ? 'Deletion needs attention' : 'Deletion in progress'}</strong><p>${job.deletePosts ? 'Series data and published posts will be permanently deleted.' : 'Series data will be permanently deleted. Published Reddit posts will remain.'}</p>${waiting ? `<p>Starts after ${esc(new Date(job.dueAt).toLocaleString())}. You can cancel before this deadline.</p>` : '<p>Runs in batches and may take several hours. Refresh to check progress. Posts already deleted cannot be restored.</p>'}${job.error ? `<p class="error">${esc(job.error)}</p>` : ''}${state.admin && canCancel ? `<button class="secondary" data-cancel-deletion="${esc(series.id)}">Cancel deletion</button>` : ''}${state.admin && job.state === 'failed' ? `<button class="danger" data-retry-deletion="${esc(series.id)}">Retry remaining deletion</button>` : ''}</div>`;
}
function privacyDeletionMarkup() {
  if (!state.admin) return '';
  const job = state.privacyDeletion;
  if (!job)
    return '<button class="quiet-link" id="personal-data-deletion">Personal-data deletion</button>';
  const progress = job.state === 'scanning'
    ? `Checking stored history (${job.scannedMonths} of 1200 months).`
    : `Removing saved identifiers and host credits from ${job.pendingPosts} recorded posts.`;
  return `<div class="notice ${job.state === 'failed' ? 'error' : ''}"><strong>Personal-data deletion ${job.state === 'failed' ? 'needs attention' : 'in progress'}</strong><p>${progress}</p>${job.error ? `<p>${esc(job.error)}</p><button class="quiet-link" id="retry-personal-data-deletion">Retry cleanup</button>` : ''}</div>`;
}
function openPersonalDataDeletionDialog() {
  const existing = document.querySelector('#personal-data-deletion-dialog');
  if (existing) existing.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'personal-data-deletion-dialog';
  dialog.innerHTML = `<h2>Personal-data deletion</h2><p>Use this only for a verified legal privacy request, such as a GDPR erasure request. It is irreversible. It removes this username from host and maintainer records, saved edits, audit and recovery data, then redacts matching credits in recorded Check-In Crew posts. A long-running account can require many historic Reddit post edits.</p><label>Reddit username<input id="personal-data-username" autocomplete="off" spellcheck="false" placeholder="username"></label><p id="personal-data-impact" class="notice" hidden></p><label id="personal-data-confirmation-label" hidden>Type DELETE to confirm<input id="personal-data-confirmation" autocomplete="off" spellcheck="false"></label><p id="personal-data-error" class="notice error" hidden></p><div class="actions"><button id="personal-data-check" class="secondary">Check impact</button><button id="personal-data-submit" class="danger" disabled hidden>Start irreversible deletion</button><button id="personal-data-cancel" class="secondary">Cancel</button></div>`;
  document.body.append(dialog);
  const username = dialog.querySelector('#personal-data-username');
  const confirmation = dialog.querySelector('#personal-data-confirmation');
  const submit = dialog.querySelector('#personal-data-submit');
  const check = dialog.querySelector('#personal-data-check');
  const impact = dialog.querySelector('#personal-data-impact');
  const confirmationLabel = dialog.querySelector('#personal-data-confirmation-label');
  let checkedUsername = '';
  const update = () => { submit.disabled = checkedUsername !== username.value.trim().replace(/^u\//i, '').toLowerCase() || confirmation.value !== 'DELETE'; };
  username.addEventListener('input', () => { checkedUsername = ''; impact.hidden = true; confirmationLabel.hidden = true; submit.hidden = true; check.hidden = false; update(); });
  confirmation.addEventListener('input', update);
  dialog.querySelector('#personal-data-cancel').addEventListener('click', () => dialog.close());
  check.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/dashboard/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'personalDataDeletionPreview', revision: state.revision, username: username.value }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Unable to check the deletion impact.');
      checkedUsername = username.value.trim().replace(/^u\//i, '').toLowerCase();
      impact.hidden = false;
      impact.textContent = `This will remove stored references and check up to ${data.postCount} recorded Check-In Crew posts for this username. Any matching credit will be edited to [deleted]. This is an upper bound: posts without a matching credit are left unchanged.`;
      confirmationLabel.hidden = false;
      submit.hidden = false;
      check.hidden = true;
      update();
    } catch (error) {
      impact.hidden = false;
      impact.textContent = error.message;
      impact.className = 'notice error';
    }
  });
  submit.addEventListener('click', async () => {
    const ok = await send({ action: 'personalDataDeletion', revision: state.revision, username: username.value, confirmation: confirmation.value });
    if (ok) dialog.close();
    else {
      const error = dialog.querySelector('#personal-data-error');
      error.hidden = false;
      error.textContent = message.textContent;
    }
  });
  dialog.showModal();
}
async function openDeleteDialog(seriesId, publicationKey) {
  if (!mayDiscard()) return;
  const series = [...state.series, ...(state.archivedSeries ?? [])].find(
    (s) => s.id === seriesId
  );
  if (!series) return;
  const revision = state.revision;
  let post;
  if (publicationKey) {
    try {
      const response = await fetch('/api/dashboard/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deletePostPreview',
          seriesId,
          publicationKey,
          revision,
        }),
      });
      post = await response.json();
      if (!response.ok) throw Error(post.error);
    } catch (error) {
      message.textContent = error.message;
      message.className = 'notice error';
      return;
    }
  }
  document.querySelector('#delete-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'delete-dialog';
  dialog.innerHTML = `<h2>${post ? 'Permanently delete post' : 'Permanently delete series'}</h2><p><strong>${esc(post ? post.title : series.label)}</strong>${post ? `<br>${esc(post.date)}` : ''}</p><p>${post ? 'This deletes the Reddit post permanently. Comments underneath it remain. The scheduler will not recreate this occurrence.' : 'Archiving is normally enough. Permanent deletion removes settings, templates, saved edits and stored history. Keep the archive unless you need to erase it.'}</p>${post ? '' : '<label class="checkbox-label"><input type="checkbox" id="delete-series-posts"> Also delete its published posts</label><p id="delete-series-warning"></p>'}<label>Type ${post ? 'DELETE' : 'the series display name'} to confirm<input id="delete-confirmation" autocomplete="off" spellcheck="false"></label><p id="delete-error" class="notice error" hidden></p><div class="actions"><button id="delete-submit" class="danger" disabled>${post ? 'Delete post permanently' : 'Delete series data'}</button><button id="delete-cancel" class="secondary">Cancel</button></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector('#delete-confirmation');
  const submit = dialog.querySelector('#delete-submit');
  input.addEventListener('input', () => {
    submit.disabled = input.value !== (post ? 'DELETE' : series.label);
  });
  const posts = dialog.querySelector('#delete-series-posts');
  const update = () => {
    dialog.querySelector('#delete-series-warning').textContent = posts.checked
      ? `Waits ${state.bulkDeleteCooldownDays} days before deleting posts and series data. Cancel from Archived series before the deadline. Comments remain. Deletion runs in batches; failures remain visible.`
      : 'Published Reddit posts will remain. Data cleanup starts in the background and cannot be cancelled.';
    submit.textContent = posts.checked
      ? 'Schedule permanent deletion'
      : 'Delete series data';
  };
  if (posts) {
    posts.addEventListener('change', update);
    update();
  }
  dialog
    .querySelector('#delete-cancel')
    .addEventListener('click', () => dialog.close());
  submit.addEventListener('click', async () => {
    const ok = await send({
      action: post ? 'deletePost' : 'deleteSeries',
      seriesId,
      revision,
      confirmation: input.value,
      ...(post
        ? { publicationKey, postId: post.postId }
        : { deletePosts: posts.checked }),
    });
    if (ok) dialog.close();
    else {
      const error = dialog.querySelector('#delete-error');
      error.hidden = false;
      error.textContent = message.textContent;
    }
  });
  dialog.showModal();
}
function scheduleMarkup(series, historyMonth) {
  const rowLabels = series.seriesType === 'simple' ? { daily: 'Post' } : labels;
  const renderRows = (days) =>
    days
      .map(
        (item) =>
          `<tr><td>${series.seriesType === 'simple' ? esc(item.date) + '<br>' + esc(item.time) + '<br><span class=muted>' + esc(item.timezone) + '</span>' : item.day}</td><td>${esc(rowLabels[item.kind])}${item.customised ? ' <span class="badge">Custom</span>' : ''}</td><td class="status-${esc(item.status)}">${statusText(item)}${publicationDetails(item)}</td><td>${item.url ? `<button class="link-button" data-open-post="${esc(item.url)}">Open post</button>` : '—'}</td><td>${deletePostButton(series.id, item)}${item.status === 'deleted' || item.status === 'deleting' ? '' : `<button class="secondary" data-preview="${esc(series.id)}" data-date="${esc(item.date)}" data-kind="${esc(item.kind)}" data-slot-id="${esc(item.slotId)}">${item.canEdit ? 'Preview/edit' : 'Preview'}</button>`}${item.canPublish ? ` <button class="secondary" data-publish="${esc(series.id)}" data-date="${esc(item.date)}" data-kind="${esc(item.kind)}" data-slot-id="${esc(item.slotId)}">Post now</button>` : ''}</td></tr>`
      )
      .join('');
  const rows = renderRows(series.days);
  const history =
    series.seriesType === 'simple'
      ? `<details><summary>History for ${esc(historyMonth)}</summary><div class="schedule"><table><thead><tr><th>Date</th><th>Post</th><th>Status</th><th>Link</th><th>Action</th></tr></thead><tbody>${renderRows(series.historyDays ?? []) || '<tr><td colspan="5">No past posts or publication attempts in this month.</td></tr>'}</tbody></table></div></details>`
      : '';

  return `<div class="schedule">${series.seriesType === 'simple' ? '<h3>Upcoming posts</h3><p class="muted">This window rolls forward as posts are published or their scheduled times pass, across month boundaries.</p>' : ''}<table><thead><tr><th>${series.seriesType === 'simple' ? 'Date' : 'Day'}</th><th>Thread</th><th>Status</th><th>Link</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No upcoming posts. Check the schedule start/end conditions.</td></tr>'}</tbody></table></div>${history}${draftMarkup(series)}`;
}
function render() {
  app.querySelectorAll('[data-series-details]').forEach((details) => {
    openSeries.set(details.dataset.seriesDetails, details.open);
  });
  const expanded = viewMode === 'expanded';
  document.querySelector('.toolbar').hidden = !expanded;
  document.querySelector('#series-views').hidden = !expanded;
  document.querySelector('#bulk-actions').hidden =
    !expanded || seriesView === 'archived';
  const capacity = document.querySelector('#series-capacity');
  capacity.hidden = !expanded || !state.admin || seriesView === 'archived';
  if (!expanded) {
    createPanel.hidden = true;
    adminTools.innerHTML =
      '<button id="open-full-dashboard">Open full dashboard</button>';
    privacyTools.hidden = true;
    app.innerHTML = state.series
      .map(
        (series) =>
          `<article class="series summary-series"><h2>${esc(series.label)} <span class="badge ${series.enabled ? 'active' : 'paused'}">${series.enabled ? 'Active' : 'Paused'}</span></h2><p class="meta">${esc(series.time)} ${esc(series.timezone)} · ${series.seriesType === 'simple' ? `Simple recurring posts · ${esc(series.scheduleSummary)}` : 'Monthly series'}</p><p class="meta">Hosts: ${series.hosts.length ? series.hosts.map((id) => 'u/' + esc(id)).join(', ') : 'Volunteer team'}</p></article>`
      )
      .join('');
    document
      .querySelector('#open-full-dashboard')
      ?.addEventListener('click', (event) => {
        try {
          requestExpandedMode(event, 'dashboard');
          window.setTimeout(syncViewMode, 250);
        } catch (error) {
          message.textContent = error.message;
          message.className = 'notice error';
        }
      });
    return;
  }
  const views = document.querySelector('#series-views');
  views.innerHTML = `<button class="secondary" data-series-view="current" aria-pressed="${seriesView === 'current'}">Current series</button><button class="secondary" data-series-view="archived" aria-pressed="${seriesView === 'archived'}">Archived series (${state.archivedCount ?? 0})</button>`;
  views.querySelectorAll('[data-series-view]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!mayDiscard()) return;
      selected.clear();
      createPanel.hidden = true;
      dirtyGroups.clear();
      seriesView = button.dataset.seriesView;
      await load();
    })
  );
  if (seriesView === 'archived') {
    adminTools.innerHTML = '';
    privacyTools.innerHTML = privacyDeletionMarkup();
    privacyTools.hidden = !state.admin;
    createPanel.hidden = true;
    app.innerHTML =
      (state.archivedSeries ?? [])
        .map(
          (series) =>
            `<article class="series"><details data-series-details="archived:${esc(series.id)}" ${openSeries.get(`archived:${series.id}`) ? 'open' : ''}><summary><h2>${esc(series.label)} <span class="badge">Archived</span></h2></summary><div class="series-body"><p class="muted">Schedule, templates, hosts, access assignments and saved edits are retained. Restoring leaves automatic posting paused.</p>${seriesDeletionMarkup(series)}<h3>Publication history — ${esc(state.month)}</h3>${series.history.map((entry) => `<p>${esc(entry.date)} ${esc(entry.time)} · ${esc(entry.kind)} · ${esc(entry.status ?? 'Attempt cleared')}${deletePostButton(series.id, entry, Boolean(series.deletion))}${entry.url ? ` <button class="link-button" data-open-post="${esc(entry.url)}">Open post</button>` : ''}</p>`).join('') || '<p>No publication attempts this month.</p>'}</div></details></article>`
        )
        .join('') || '<p class="notice">No archived series.</p>';
    app.querySelectorAll('[data-unarchive]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (
          !window.confirm(
            'Restore this series? It will return to Current series, paused, and count toward the series limit.'
          )
        )
          return;
        await send({
          action: 'unarchive',
          revision: state.revision,
          seriesId: button.dataset.unarchive,
          confirmed: true,
        });
      })
    );
    privacyTools
      .querySelector('#personal-data-deletion')
      ?.addEventListener('click', openPersonalDataDeletionDialog);
    privacyTools
      .querySelector('#retry-personal-data-deletion')
      ?.addEventListener('click', () =>
        send({ action: 'retryPersonalDataDeletion', revision: state.revision })
      );
    bindScheduleActions(app, state.revision);
    return;
  }
  app.innerHTML = state.series
    .map((series) => {
      const checked = selected.has(series.id) ? 'checked' : '';
      const maintainers = series.maintainers.length
        ? series.maintainers.map((m) => 'u/' + esc(m.username)).join(', ')
        : 'No maintainers assigned';
      const hosts = series.hosts.length
        ? series.hosts.map((id) => 'u/' + esc(id)).join(', ')
        : 'Volunteer team';
      const rowLabels =
        series.seriesType === 'simple' ? { daily: 'Post' } : labels;
      const stickyKinds =
        series.seriesType === 'simple'
          ? ['daily']
          : ['signup', 'daily', 'roundup'];
      const sticky = state.admin
        ? stickyKinds
            .map(
              (kind) =>
                `<label>${rowLabels[kind]} highlighting<select data-sticky="${kind}"><option value="none">Not stickied</option><option value="slot1">Sticky slot 1</option><option value="slot2">Sticky slot 2</option></select></label>`
            )
            .join('')
        : '';
      const templateKinds =
        series.seriesType === 'simple'
          ? ['daily']
          : ['signup', 'daily', 'roundup'];
      const templates = templateKinds
        .map((kind) => {
          const custom = series.templateOverrides?.includes(kind);
          return `<div class="body-format"><label class="checkbox-label"><input type="checkbox" data-body-default="${kind}" ${custom ? '' : 'checked'}> Use default for ${rowLabels[kind]} post body</label><details data-body-summary ${custom ? 'hidden' : ''}><summary>View default post body</summary><pre class="default-body">${esc(series.defaultTemplates[kind])}</pre></details><label data-body-editor ${custom ? '' : 'hidden'}>${rowLabels[kind]} post body<textarea data-template="${kind}">${esc(series.templates[kind])}</textarea></label></div>`;
        })
        .join('');
      const titles = templateKinds
        .map((kind) => {
          const custom = series.titleOverrides?.includes(kind);
          const shortcodeButtons = titleShortcodes(series)
            .map(
              (token) =>
                `<button type="button" class="secondary shortcode" title="Insert ${esc(token)}" data-title-shortcode="${esc(token)}">${esc(shortcodeLabels[token])}</button>`
            )
            .join('');
          return `<div class="title-format"><label class="checkbox-label"><input type="checkbox" data-title-default="${kind}" ${custom ? '' : 'checked'}> Use default for ${rowLabels[kind]} title</label><p class="muted" data-title-summary ${custom ? 'hidden' : ''}>Default: ${esc(series.defaultTitles[kind])}</p><input aria-label="${rowLabels[kind]} title format" data-title="${kind}" maxlength="300" value="${esc(series.titles[kind])}" ${custom ? '' : 'hidden'}><div class="shortcodes" ${custom ? '' : 'hidden'}><span class="muted">Insert:</span>${shortcodeButtons}</div><p class="muted" data-title-example="${kind}" aria-live="polite"></p></div>`;
        })
        .join('');
      const customHostCredit = series.hostCreditOverride;
      const defaultHostCredit = `<label class="checkbox-label"><input type="checkbox" data-host-default ${customHostCredit ? '' : 'checked'}> Use default host credit</label><p class="muted" data-host-summary ${customHostCredit ? 'hidden' : ''}>Default: ${esc(series.defaultHostCredit)}</p><input aria-label="Host credit format" data-host-credit value="${esc(series.hostCredit)}" ${customHostCredit ? '' : 'hidden'}>`;
      const hostCredit = series.seriesType === 'simple'
        ? `<div class="title-format"><label class="checkbox-label"><input type="checkbox" data-show-host-credit ${series.showHostCredit ? 'checked' : ''}> Include host credit in generated posts</label><p class="muted">Off by default for simple recurring posts. Maintainer access is separate from host credit.</p><div data-simple-host-credit ${series.showHostCredit ? '' : 'hidden'}>${defaultHostCredit}</div></div>`
        : `<div class="title-format">${defaultHostCredit}</div>`;
      const hostButton = 'People &amp; access';
      const seriesSettings = `<div class="type-choice"><strong>${series.seriesType === 'simple' ? 'Simple recurring posts' : 'Monthly series'}</strong><p class="muted">${series.seriesType === 'simple' ? esc(series.scheduleSummary) : typeDescriptions.accountability}</p>${series.seriesType === 'simple' ? `<p class="muted">Next ${series.previewCount} posts shown</p><button type="button" class="secondary" data-change-schedule="${esc(series.id)}">${series.frequency === 'other' && !series.schedule ? 'Choose schedule' : 'Change schedule'}</button>` : ''}</div>`;
      const displayName = state.admin
        ? `<label>Display name<p class="muted">Shown in generated post titles and host credits.</p><input data-label value="${esc(series.label)}" maxlength="40"></label>`
        : '';
      const titleHelp =
        'Defaults come from this community’s app settings. Uncheck Use default to customise this series. Changes to defaults apply to upcoming posts that inherit them; custom series and dated overrides are kept. ';
      const creditPlaceholder = series.seriesType === 'simple' ? '{host_credit_simple}' : '{host_credit_monthly}';
      return `<article class="series" data-series-id="${esc(series.id)}" data-series-type="${esc(series.seriesType)}"><details data-series-details="current:${esc(series.id)}" ${openSeries.get(`current:${series.id}`) ? 'open' : ''}><summary><span class="series-title"><label class="checkbox-label"><input type="checkbox" data-series="${esc(series.id)}" aria-label="Select ${esc(series.label)}" ${checked}></label><h2>${esc(series.label)} <span class="badge ${series.enabled ? 'active' : 'paused'}">${series.enabled ? 'Active' : 'Paused'}</span></h2></span><p class="meta">${esc(series.time)} ${esc(series.timezone)} · Hosts: ${hosts}</p><p class="meta">Maintainers: ${maintainers}</p>${state.admin ? `<p class="meta">ID: ${esc(series.id)}</p>` : ''}</summary><div class="series-body"><div class="actions"><button data-toggle="${esc(series.id)}" class="${series.enabled ? 'danger' : ''}">${series.enabled ? 'Pause' : 'Resume'}</button><button type="button" class="secondary" data-show-hosts="${esc(series.id)}">${hostButton}</button>${state.admin ? `<button class="secondary" data-archive="${esc(series.id)}">Archive series</button>` : ''} </div><div class="settings" data-edit-group="${esc(series.id)}:settings">${seriesSettings}${displayName}<label>Posting time<input data-time ${series.seriesType === 'simple' ? 'readonly' : ''} value="${esc(series.time)}" pattern="[0-9]{2}:[0-9]{2}"></label><label>Timezone<input data-timezone ${series.seriesType === 'simple' ? 'readonly' : ''} value="${esc(series.timezone)}">${timezoneHelp}</label>${sticky}<button data-save="${esc(series.id)}">Save settings</button></div><div class="templates"><section class="edit-section" data-edit-group="${esc(series.id)}:bodies"><h3>Post bodies</h3><p class="muted">Defaults come from app settings. Uncheck Use default to customise a body for this series. Shortcodes: {month}, {day}, {weekday}, {date}, {series}, {frequency}, ${creditPlaceholder}, {community_note}, {signup_link}, and {previous_link}. The community note is filled in from app settings when publishing.</p>${templates}<div class="actions"><button data-save-templates="${esc(series.id)}">Save post bodies</button><button class="secondary" data-reset-templates="${esc(series.id)}">Restore default post bodies</button></div></section><section class="edit-section" data-edit-group="${esc(series.id)}:titles"><h3>Title formats</h3><p class="muted">${titleHelp}Use the buttons to insert shortcodes into a custom title. The example uses a scheduled date.</p>${titles}<div class="actions"><button data-save-titles="${esc(series.id)}">Save title formats</button><button class="secondary" data-reset-titles="${esc(series.id)}">Restore default titles</button></div></section><section class="edit-section" data-edit-group="${esc(series.id)}:credit"><h3>Host credit</h3><p class="muted">Hosts shown here are credited in generated post bodies. Use {hosts}, {series}, or {month} in a custom format.</p><p class="meta">${esc(state.month)} hosts: ${hosts}</p>${hostCredit}<div class="actions"><button data-save-host-credit="${esc(series.id)}">Save host credit</button><button class="secondary" data-reset-host-credit="${esc(series.id)}">Restore default host credit</button></div></section></div><div data-schedule-series="${esc(series.id)}">${scheduleMarkup(series, state.month)}</div></div></details></article>`;
    })
    .join('');
  adminTools.innerHTML = state.admin
    ? `<button id="new-series" ${state.seriesCount >= state.seriesLimit ? 'disabled' : ''}>Create a new series</button>`
    : '';
  privacyTools.innerHTML = privacyDeletionMarkup();
  privacyTools.hidden = !state.admin;
  capacity.textContent = `${state.seriesCount} of ${state.seriesLimit} series used. Paused series count; archived series do not. Change the limit in app settings.`;
  if (!state.series.length)
    app.innerHTML =
      '<p class="notice">No current series. Create a series or restore one from Archived series.</p>';
  app
    .querySelectorAll('[data-timezone-picker]')
    .forEach((button) => button.addEventListener('click', openTimezonePicker));
  document.querySelectorAll('[data-archive]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (
        !mayDiscard() ||
        !window.confirm(
          'Archive this series? Automatic posting stops. Its settings, saved edits and history are kept in Archived series. An already-started post may still finish.'
        )
      )
        return;
      const saved = await send({
        action: 'archive',
        revision: state.revision,
        seriesId: button.dataset.archive,
        confirmed: true,
      });
      if (saved) selected.delete(button.dataset.archive);
    })
  );
  document
    .querySelector('#new-series')
    ?.addEventListener('click', () => (createPanel.hidden = false));
  document
    .querySelector('#personal-data-deletion')
    ?.addEventListener('click', openPersonalDataDeletionDialog);
  document
    .querySelector('#retry-personal-data-deletion')
    ?.addEventListener('click', () =>
      send({ action: 'retryPersonalDataDeletion', revision: state.revision })
    );
  document.querySelectorAll('[data-sticky]').forEach((select) => {
    const series = select.closest('.series');
    const id = series.querySelector('[data-save]').dataset.save;
    const item = state.series.find((s) => s.id === id);
    select.value = item.sticky[select.dataset.sticky];
  });
  app.querySelectorAll('.series-title .checkbox-label').forEach((label) => {
    label.addEventListener('click', (event) => event.stopPropagation());
    label.addEventListener('keydown', (event) => event.stopPropagation());
  });
  document
    .querySelectorAll('[data-series]')
    .forEach((input) =>
      input.addEventListener('change', () =>
        input.checked
          ? selected.add(input.dataset.series)
          : selected.delete(input.dataset.series)
      )
    );
  document
    .querySelectorAll('[data-toggle]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        action(
          button.dataset.toggle,
          button.textContent === 'Resume' ? 'resume' : 'pause'
        )
      )
    );
  document
    .querySelectorAll('[data-save]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        save(button.closest('.series'), button.dataset.save)
      )
    );
  document
    .querySelectorAll('[data-save-templates]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        saveTemplates(button.closest('.series'), button.dataset.saveTemplates)
      )
    );
  document.querySelectorAll('[data-title-default]').forEach((input) =>
    input.addEventListener('change', () => {
      input.closest('.title-format').querySelector('[data-title]').hidden =
        input.checked;
    })
  );
  document.querySelectorAll('[data-title-shortcode]').forEach((button) =>
    button.addEventListener('click', () => {
      const format = button.closest('.title-format');
      const field = format?.querySelector('[data-title]');
      if (!field) return;
      const useDefault = format.querySelector('[data-title-default]');
      if (useDefault) {
        useDefault.checked = false;
        field.hidden = false;
      }
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      field.value =
        field.value.slice(0, start) +
        button.dataset.titleShortcode +
        field.value.slice(end);
      markDirty(field);
      syncEditors();
      field.focus();
      field.setSelectionRange(
        start + button.dataset.titleShortcode.length,
        start + button.dataset.titleShortcode.length
      );
    })
  );
  document.querySelectorAll('[data-host-default]').forEach((input) =>
    input.addEventListener('change', () => {
      input
        .closest('.title-format')
        .querySelector('[data-host-credit]').hidden = input.checked;
    })
  );
  document.querySelectorAll('[data-show-host-credit]').forEach((input) =>
    input.addEventListener('change', () => {
      input.closest('.title-format').querySelector('[data-simple-host-credit]').hidden = !input.checked;
    })
  );
  document
    .querySelectorAll('[data-save-host-credit]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        saveHostCredit(button.closest('.series'), button.dataset.saveHostCredit)
      )
    );
  document
    .querySelectorAll('[data-save-titles]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        saveTitles(button.closest('.series'), button.dataset.saveTitles)
      )
    );
  document.querySelectorAll('[data-reset-templates]').forEach((button) =>
    button.addEventListener('click', () => {
      if (window.confirm('Reset this series’ post bodies to the defaults?'))
        send({
          action: 'templates',
          revision: state.revision,
          seriesId: button.dataset.resetTemplates,
          resetKinds: ['signup', 'daily', 'roundup'],
        });
    })
  );
  document.querySelectorAll('[data-reset-titles]').forEach((button) =>
    button.addEventListener('click', () => {
      if (window.confirm('Reset this series’ title formats to the defaults?'))
        send({
          action: 'templates',
          revision: state.revision,
          seriesId: button.dataset.resetTitles,
          resetTitleKinds: ['signup', 'daily', 'roundup'],
        });
    })
  );
  document.querySelectorAll('[data-reset-host-credit]').forEach((button) =>
    button.addEventListener('click', () => {
      if (window.confirm('Reset this series host credit to the default?'))
        send({
          action: 'templates',
          revision: state.revision,
          seriesId: button.dataset.resetHostCredit,
          resetHostCredit: true,
        });
    })
  );
  document
    .querySelectorAll('[data-show-hosts]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        showHosts(button.dataset.showHosts)
      )
    );
  document.querySelectorAll('[data-reassign-draft]').forEach((button) =>
    button.addEventListener('click', async () => {
      const date = window.prompt(
        'Enter the future date to move this draft to (YYYY-MM-DD).'
      );
      if (!date) return;
      await send({
        action: 'reassignDraft',
        revision: state.revision,
        seriesId: button.dataset.reassignDraft,
        draftKey: button.dataset.draftKey,
        date,
        confirmed: true,
      });
    })
  );
  document.querySelectorAll('[data-discard-draft]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (window.confirm('Discard this unscheduled draft?'))
        await send({
          action: 'discardDraft',
          revision: state.revision,
          seriesId: button.dataset.discardDraft,
          draftKey: button.dataset.draftKey,
          confirmed: true,
        });
    })
  );
  document
    .querySelectorAll('[data-change-schedule]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        openSchedule(button.dataset.changeSchedule)
      )
    );
  bindScheduleActions(document, state.revision);
}
function bindScheduleActions(root, revision) {
  root
    .querySelectorAll('[data-delete-post]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        openDeleteDialog(
          button.dataset.deletePost,
          button.dataset.publicationKey
        )
      )
    );
  root
    .querySelectorAll('[data-delete-series]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        openDeleteDialog(button.dataset.deleteSeries)
      )
    );
  root.querySelectorAll('[data-cancel-deletion]').forEach((button) =>
    button.addEventListener('click', () =>
      send({
        action: 'cancelDeletion',
        seriesId: button.dataset.cancelDeletion,
        revision,
      })
    )
  );
  root.querySelectorAll('[data-retry-deletion]').forEach((button) =>
    button.addEventListener('click', () => {
      if (
        window.confirm(
          'Resume permanently deleting the remaining posts and series data? Already deleted posts cannot be restored.'
        )
      )
        send({
          action: 'retryDeletion',
          seriesId: button.dataset.retryDeletion,
          revision,
        });
    })
  );
  root.querySelectorAll('[data-publish]').forEach((button) =>
    button.addEventListener('click', () => {
      if (
        window.confirm(
          'Post the topic dated ' +
            button.dataset.date +
            ' now from the Check-In Crew app account? This creates a real post and marks this topic as posted, so the scheduler will not post it again.'
        )
      )
        send({
          action: 'publish',
          revision,
          seriesId: button.dataset.publish,
          date: button.dataset.date,
          kind: button.dataset.kind,
          slotId: button.dataset.slotId,
          confirmed: true,
        });
    })
  );
  root
    .querySelectorAll('[data-open-post]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        navigateTo(button.dataset.openPost)
      )
    );
  root
    .querySelectorAll('[data-preview]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        showPreview(
          button.dataset.preview,
          button.dataset.date,
          button.dataset.kind,
          button.dataset.slotId
        )
      )
    );
}
async function action(id, verb) {
  await send({ action: verb, revision: state.revision, seriesIds: [id] });
}
async function save(card, id) {
  await send({
    action: 'update',
    revision: state.revision,
    seriesId: id,
    ...(card.querySelector('[data-label]')
      ? { label: card.querySelector('[data-label]').value }
      : {}),
    time: card.querySelector('[data-time]').value,
    timezone: card.querySelector('[data-timezone]').value,
    signupSticky: card.querySelector('[data-sticky="signup"]')?.value,
    dailySticky: card.querySelector('[data-sticky="daily"]')?.value,
    roundupSticky: card.querySelector('[data-sticky="roundup"]')?.value,
  });
}
async function createSeries() {
  const simple =
    document.querySelector('#create-series-type').value === 'simple';
  const weekly =
    simple && document.querySelector('#create-frequency').value === 'weekly';
  const saved = await send({
    action: 'create',
    revision: state.revision,
    label: document.querySelector('#create-label').value,
    seriesType: document.querySelector('#create-series-type').value,
    frequency: simple
      ? document.querySelector('#create-frequency').value
      : 'daily',
    weekday: weekly
      ? Number(document.querySelector('#create-weekday').value)
      : 1,
    timezone: document.querySelector('#create-timezone').value,
    time: document.querySelector('#create-time').value,
    signupSticky: simple
      ? 'none'
      : document.querySelector('#create-signup').value,
    dailySticky: document.querySelector('#create-daily').value,
    roundupSticky: simple
      ? 'none'
      : document.querySelector('#create-roundup').value,
  });
  if (saved) {
    createPanel.hidden = true;
    if (
      simple &&
      document.querySelector('#create-frequency').value === 'other' &&
      lastCreatedId
    )
      openSchedule(lastCreatedId);
  }
}
async function saveTemplates(card, id) {
  const kinds =
    card.dataset.seriesType === 'simple'
      ? ['daily']
      : ['signup', 'daily', 'roundup'];
  const body = {
    action: 'templates',
    revision: state.revision,
    seriesId: id,
    resetKinds: [],
  };
  for (const kind of kinds) {
    if (card.querySelector(`[data-body-default="${kind}"]`).checked)
      body.resetKinds.push(kind);
    else
      body[`${kind}Template`] = card.querySelector(
        `[data-template="${kind}"]`
      ).value;
  }
  await send(body);
}
async function saveTitles(card, id) {
  const kinds =
    card.dataset.seriesType === 'simple'
      ? ['daily']
      : ['signup', 'daily', 'roundup'];
  const body = {
    action: 'templates',
    revision: state.revision,
    seriesId: id,
  };
  for (const kind of kinds) {
    const useDefault = card.querySelector(
      `[data-title-default="${kind}"]`
    ).checked;
    if (!useDefault)
      body[`${kind}Title`] = card.querySelector(`[data-title="${kind}"]`).value;
    else {
      body.resetTitleKinds ??= [];
      body.resetTitleKinds.push(kind);
    }
  }
  await send(body);
}
async function saveHostCredit(card, id) {
  const useDefault = card.querySelector('[data-host-default]').checked;
  const include = card.querySelector('[data-show-host-credit]');
  await send({
    action: 'templates',
    revision: state.revision,
    seriesId: id,
    ...(include ? { showHostCredit: include.checked } : {}),
    ...(useDefault
      ? { resetHostCredit: true }
      : { hostCredit: card.querySelector('[data-host-credit]').value }),
  });
}
const peoplePanel = createPeoplePanel({
  getState: () => state,
  save: send,
  getError: () => message.textContent,
});
function showHosts(id) {
  peoplePanel.open(id);
}
let postDraft;
let postDraftBaseline;
let previewRequest = 0;
let editorBusy = false;
const previewDialog = document.querySelector('#preview-dialog');
function editorPayload() {
  return {
    postTitle: document.querySelector('#post-title-default').checked
      ? null
      : document.querySelector('#post-title').value,
    postBody: document.querySelector('#post-body-default').checked
      ? null
      : document.querySelector('#post-body').value,
  };
}
function syncPostEditor() {
  document.querySelector('#post-title-field').hidden = document.querySelector(
    '#post-title-default'
  ).checked;
  document.querySelector('#post-body-field').hidden =
    document.querySelector('#post-body-default').checked;
}
function setPostBusy(busy) {
  editorBusy = busy;
  document
    .querySelectorAll(
      '#post-editor input, #post-editor textarea, #post-editor button'
    )
    .forEach((control) => (control.disabled = busy));
}
async function showPreview(seriesId, date, kind, slotId) {
  const request = ++previewRequest;
  try {
    const response = await fetch(
      '/api/dashboard/preview?' +
        new URLSearchParams({
          seriesId,
          date,
          kind,
          ...(slotId ? { slotId } : {}),
        })
    );
    const data = await response.json();
    if (request !== previewRequest) return;
    if (!response.ok) throw new Error(data.error || 'Unable to load preview.');
    postDraft = {
      slotId,
      seriesId,
      date,
      kind,
      revision: data.revision,
      editable: data.editable,
    };
    document.querySelector('#preview-heading').textContent =
      (data.editable ? 'Preview/edit — ' : 'Preview — ') + date;
    document.querySelector('#preview-help').textContent = data.editable
      ? 'Changes apply only to this dated post. Saving does not publish it. Uncheck a series default to customise that field.'
      : data.publication
        ? 'Read-only: publication has already started. This generated preview may differ from the published post.'
        : 'Read-only: the scheduled posting time has passed.';
    document.querySelector('#post-editor').hidden = !data.editable;
    document.querySelector('#post-title-default').checked =
      data.override.title === undefined;
    document.querySelector('#post-body-default').checked =
      data.override.body === undefined;
    document.querySelector('#post-title').value =
      data.override.title ?? data.inherited.title;
    document.querySelector('#post-body').value =
      data.override.body ?? data.inherited.body;
    document.querySelector('#preview-title').textContent = data.title;
    document.querySelector('#preview-body').textContent = data.text;
    document.querySelector('#preview-error').hidden = true;
    postDraftBaseline = JSON.stringify(editorPayload());
    syncPostEditor();
    if (!previewDialog.open) previewDialog.showModal();
  } catch (error) {
    const target = previewDialog.open
      ? document.querySelector('#preview-error')
      : message;
    target.textContent = error.message;
    target.hidden = false;
    target.className = 'notice error';
  }
}
async function editPost(action, reset = false) {
  if (!postDraft?.editable || editorBusy) return;
  if (
    reset &&
    !window.confirm(
      'Remove the custom title and body for this post and use the series defaults?'
    )
  )
    return;
  setPostBusy(true);
  const feedback = document.querySelector('#preview-error');
  feedback.hidden = true;
  try {
    const response = await fetch('/api/dashboard/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...postDraft,
        action,
        ...(reset ? { postTitle: null, postBody: null } : editorPayload()),
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || 'Unable to save this post.');
    if (action === 'postPreview') {
      document.querySelector('#preview-title').textContent = data.title;
      document.querySelector('#preview-body').textContent = data.text;
      feedback.textContent = 'Preview updated. Changes have not been saved.';
    } else {
      await showPreview(
        postDraft.seriesId,
        postDraft.date,
        postDraft.kind,
        postDraft.slotId
      );
      await load({ preserveDrafts: true });
      feedback.textContent = reset
        ? 'Series defaults restored for this post.'
        : 'Saved for this post. It will publish at its scheduled time when the series is active.';
    }
    feedback.className = 'notice';
    feedback.hidden = false;
  } catch (error) {
    feedback.textContent = error.message;
    feedback.className = 'notice error';
    feedback.hidden = false;
  } finally {
    setPostBusy(false);
  }
}
function canClosePreview() {
  return (
    !editorBusy &&
    (!postDraft?.editable ||
      JSON.stringify(editorPayload()) === postDraftBaseline ||
      window.confirm('Discard unsaved changes to this post?'))
  );
}
document.querySelector('#preview-close').addEventListener('click', () => {
  if (canClosePreview()) previewDialog.close();
});
previewDialog.addEventListener('cancel', (event) => {
  if (!canClosePreview()) event.preventDefault();
});
for (const id of ['post-title-default', 'post-body-default'])
  document.getElementById(id).addEventListener('change', syncPostEditor);
document
  .querySelector('#post-render')
  .addEventListener('click', () => editPost('postPreview'));
document
  .querySelector('#post-save')
  .addEventListener('click', () => editPost('postOverride'));
document
  .querySelector('#post-reset')
  .addEventListener('click', () => editPost('postOverride', true));
async function send(body) {
  if (saving) return false;
  const section =
    body.action === 'update'
      ? 'settings'
      : body.action === 'templates'
        ? 'hostCredit' in body || 'resetHostCredit' in body
          ? 'credit'
          : 'resetTitleKinds' in body ||
              Object.keys(body).some((key) => key.endsWith('Title'))
            ? 'titles'
            : 'bodies'
        : undefined;
  const savedGroup =
    body.action === 'create'
      ? 'create'
      : section
        ? `${body.seriesId}:${section}`
        : undefined;
  saving = true;
  const controls = [
    ...document.querySelectorAll('input, textarea, select, button'),
  ].map((control) => [control, control.disabled]);
  controls.forEach(([control]) => {
    control.disabled = true;
  });
  if (savedGroup) feedback(savedGroup, 'Saving…');
  try {
    const response = await fetch('/api/dashboard/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to save changes.');
    if (data.createdId) lastCreatedId = data.createdId;
    const refreshed = await load({ preserveDrafts: true, savedGroup });
    if (!refreshed) {
      // Saving succeeded; retain the visible draft and stop stale revisions being reused.
      if (savedGroup) {
        state.revision++;
        dirtyGroups.delete(savedGroup);
        feedback(savedGroup, 'Saved. Refresh to reload the latest settings.');
      }
    }
    return true;
  } catch (error) {
    message.textContent = error.message;
    message.className = 'notice error';
    if (savedGroup) feedback(savedGroup, error.message, true);
    return false;
  } finally {
    controls.forEach(([control, disabled]) => {
      control.disabled = disabled;
    });
    saving = false;
  }
}
document.querySelector('#refresh').addEventListener('click', () => {
  if (mayDiscard()) load();
});
document.querySelector('#public-home').addEventListener('click', () => {
  if (!mayDiscard()) return;
  publicView.showHome();
  showManagement(false);
});
async function changeMonth(next) {
  if (next === month.value) return;
  if (!mayDiscard()) {
    syncMonthControls();
    return;
  }
  const previous = month.value;
  month.value = next;
  syncMonthControls();
  if (!(await load()) && month.value === next) {
    month.value = previous;
    syncMonthControls();
  }
}
for (const control of [monthSelect, yearSelect])
  control.addEventListener('change', () =>
    changeMonth(`${yearSelect.value}-${monthSelect.value}`)
  );
document
  .querySelector('#this-month')
  .addEventListener('click', () => changeMonth(todayMonth()));
document.querySelector('#pause-selected').addEventListener('click', () =>
  send({
    action: 'pause',
    revision: state?.revision,
    seriesIds: [...selected],
  })
);
document.querySelector('#resume-selected').addEventListener('click', () =>
  send({
    action: 'resume',
    revision: state?.revision,
    seriesIds: [...selected],
  })
);
document
  .querySelector('#create-submit')
  .addEventListener('click', createSeries);
document.querySelector('#create-cancel').addEventListener('click', () => {
  if (
    !dirtyGroups.has('create') ||
    window.confirm('Discard this unsaved new series?')
  ) {
    dirtyGroups.delete('create');
    feedback('create', '');
    createPanel.hidden = true;
  }
});
document
  .querySelector('#create-series-type')
  .addEventListener('change', syncCreateFields);
document
  .querySelector('#create-frequency')
  .addEventListener('change', syncCreateFields);
document
  .querySelectorAll(
    '#schedule-frequency, #schedule-unit, #schedule-end, #schedule-month-mode'
  )
  .forEach((control) => control.addEventListener('change', syncScheduleFields));
document
  .querySelector('#schedule-frequency')
  .addEventListener('change', syncScheduleFrequency);
document
  .querySelector('#schedule-preview')
  .addEventListener('click', previewSchedule);
document
  .querySelector('#schedule-save')
  .addEventListener('click', saveSchedule);
document.querySelectorAll('[data-timezone-picker]').forEach((button) =>
  button.addEventListener('click', openTimezonePicker)
);
syncCreateFields();
syncScheduleFields();
loadPublicOptions();
load();

// Refresh schedules without replacing any unsaved template or host edits.
let refreshingSchedule = false;
async function refreshSchedules() {
  if (
    refreshingSchedule ||
    document.hidden ||
    viewMode !== 'expanded' ||
    seriesView === 'archived' ||
    !state ||
    !authorised ||
    managementView.hidden
  )
    return;
  const snapshot = state;
  const selectedMonth = month.value;
  refreshingSchedule = true;
  try {
    const response = await fetch(
      '/api/dashboard?month=' + encodeURIComponent(selectedMonth)
    );
    if (!response.ok) {
      await load({ preserveDrafts: true });
      return;
    }
    const data = await response.json();
    if (
      state !== snapshot ||
      month.value !== selectedMonth ||
      viewMode !== 'expanded'
    )
      return;
    document.querySelectorAll('[data-schedule-series]').forEach((container) => {
      const series = data.series.find(
        (item) => item.id === container.dataset.scheduleSeries
      );
      if (!series) {
        container.innerHTML = '';
        return;
      }
      const historyOpen = container.querySelector('details')?.open;
      container.innerHTML = scheduleMarkup(series, data.month);
      if (historyOpen) container.querySelector('details').open = true;
      bindScheduleActions(container, data.revision);
    });
  } catch {
    /* A temporary network failure will be retried on the next refresh. */
  } finally {
    refreshingSchedule = false;
  }
}
window.setInterval(refreshSchedules, 60_000);
