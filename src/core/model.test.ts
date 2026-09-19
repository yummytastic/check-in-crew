import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaults,
  parseDate,
  slotsForSeries,
  isFutureSlot,
  slotsFor,
  dueSlots,
  localClock,
  canMaintain,
  hostNames,
  renderPost,
  validateSeries,
  publishOnce,
  type Publication,
  type PublisherStore,
} from './model.ts';
import { repeatSlots, validateRule, type RepeatRule } from './schedule.ts';

void test('signup and first check-in coexist; calendar month ends produce one roundup', () => {
  assert.deepEqual(
    slotsFor('2026-09-01').map((s) => s.kind),
    ['signup', 'daily']
  );
  for (const date of ['2026-02-28', '2028-02-29', '2026-04-30', '2026-08-31']) {
    assert.deepEqual(
      slotsFor(date).map((s) => s.kind),
      ['roundup']
    );
  }
  assert.equal(parseDate('2026-08-30').kind, 'daily');
  assert.throws(() => parseDate('2026-02-29'));
  assert.throws(() => parseDate('2026-09-31'));
});
void test('EU and US use separate dates and daylight-saving offsets', () => {
  const [eu, us] = defaults().series;
  eu!.enabled = us!.enabled = true;
  const now = new Date('2026-09-01T00:30:00Z');
  assert.equal(localClock(now, eu!.timezone).date, '2026-09-01');
  assert.equal(localClock(now, us!.timezone).date, '2026-08-31');
  assert.deepEqual(dueSlots(eu!, now), []);
  assert.equal(dueSlots(us!, now)[0]?.kind, 'roundup');
  assert.equal(
    localClock(new Date('2026-03-29T07:00:00Z'), 'Europe/London').time,
    '08:00'
  );
  assert.equal(
    localClock(new Date('2026-03-28T08:00:00Z'), 'Europe/London').time,
    '08:00'
  );
  eu!.enabled = false;
  assert.deepEqual(dueSlots(eu!, new Date('2026-09-01T23:00:00Z')), []);
  eu!.enabled = true;
  assert.deepEqual(dueSlots(eu!, now), []);
});
void test('simple series schedules daily or weekly posts', () => {
  const series = defaults().series[0]!;
  series.seriesType = 'simple';
  series.frequency = 'weekly';
  series.weekday = 1;
  assert.deepEqual(
    slotsForSeries(series, '2026-09-07').map((s) => s.kind),
    ['daily']
  );
  assert.deepEqual(slotsForSeries(series, '2026-09-08'), []);
  series.frequency = 'daily';
  assert.deepEqual(
    slotsForSeries(series, '2026-09-08').map((s) => s.kind),
    ['daily']
  );
});
void test('simple daily posting continues beyond the 15th and across month/year boundaries', () => {
  const series = {
    ...defaults().series[0]!,
    seriesType: 'simple' as const,
    enabled: true,
  };
  for (const date of [
    '2026-12-16',
    '2026-12-31',
    '2027-01-01',
    '2028-02-29',
    '2028-03-01',
  ]) {
    assert.equal(slotsForSeries(series, date)[0]?.kind, 'daily');
    assert.equal(dueSlots(series, new Date(date + 'T12:00:00Z')).length, 1);
  }
});
void test('custom schedule due window keeps nearby history and current occurrences', () => {
  const series = {
    ...defaults().series[0]!,
    seriesType: 'simple' as const,
    frequency: 'other' as const,
    enabled: true,
    schedule: {
      frequency: 'other' as const,
      unit: 'days' as const,
      interval: 1,
      start: '2026-09-01T08:05',
      weekdays: [],
      monthMode: 'day' as const,
      monthDay: 1,
      ordinal: 1,
      monthWeekday: 1,
      shortMonth: 'last' as const,
    },
    scheduleHistory: [
      {
        frequency: 'other' as const,
        weekday: 0,
        timezone: 'Europe/London',
        time: '08:00',
        schedule: {
          frequency: 'other' as const,
          unit: 'days' as const,
          interval: 1,
          start: '2026-09-01T08:00',
          weekdays: [],
          monthMode: 'day' as const,
          monthDay: 1,
          ordinal: 1,
          monthWeekday: 1,
          shortMonth: 'last' as const,
        },
        until: '2026-09-01T08:05:00.000Z',
      },
    ],
  };
  assert.equal(
    dueSlots(series, new Date('2026-09-01T07:09:00Z')).length,
    2
  );
});
void test('other schedules support custom intervals, month-end and monthly weekday rules', () => {
  const base = {
    ...defaults().series[0]!,
    seriesType: 'simple' as const,
    frequency: 'other' as const,
  };
  const everyThreeDays: RepeatRule = {
    frequency: 'other',
    unit: 'days',
    interval: 3,
    start: '2026-09-15T08:00',
    weekdays: [],
    monthMode: 'day',
    monthDay: 1,
    ordinal: 1,
    monthWeekday: 1,
    shortMonth: 'last',
  };
  validateRule(everyThreeDays, 'Europe/London');
  const daily = { ...base, schedule: everyThreeDays };
  assert.equal(repeatSlots(daily, '2026-09-15').length, 1);
  assert.equal(repeatSlots(daily, '2026-09-18').length, 1);
  assert.equal(repeatSlots(daily, '2026-09-17').length, 0);
  const monthEnd = {
    ...base,
    schedule: {
      ...everyThreeDays,
      unit: 'months' as const,
      interval: 1,
      start: '2026-01-31T08:00',
      monthMode: 'last' as const,
    },
  };
  assert.equal(repeatSlots(monthEnd, '2026-02-28').length, 1);
  const lastFriday = {
    ...base,
    schedule: {
      ...everyThreeDays,
      unit: 'months' as const,
      interval: 1,
      start: '2026-01-01T08:00',
      monthMode: 'weekday' as const,
      ordinal: -1,
      monthWeekday: 5,
    },
  };
  assert.equal(repeatSlots(lastFriday, '2026-09-25').length, 1);
  const fortnightly = {
    ...base,
    schedule: {
      ...everyThreeDays,
      unit: 'weeks' as const,
      interval: 2,
      start: '2026-09-14T08:00',
      weekdays: [1, 4],
    },
  };
  for (const date of ['2026-09-14', '2026-09-17', '2026-09-28', '2026-10-01'])
    assert.equal(repeatSlots(fortnightly, date).length, 1);
  for (const date of ['2026-09-15', '2026-09-21', '2026-09-24'])
    assert.equal(repeatSlots(fortnightly, date).length, 0);
  const fifteenth = {
    ...base,
    schedule: {
      ...everyThreeDays,
      unit: 'months' as const,
      interval: 1,
      monthDay: 15,
    },
  };
  assert.equal(repeatSlots(fifteenth, '2026-10-15').length, 1);
  assert.equal(repeatSlots(fifteenth, '2026-10-14').length, 0);
  assert.equal(repeatSlots(monthEnd, '2028-02-29').length, 1);
  assert.equal(repeatSlots(monthEnd, '2028-02-28').length, 0);
  for (const [ordinal, date] of [
    [1, '2026-09-07'],
    [2, '2026-09-14'],
    [3, '2026-09-21'],
    [4, '2026-09-28'],
    [-1, '2026-09-28'],
  ] as const) {
    const mondays = {
      ...lastFriday,
      schedule: { ...lastFriday.schedule, ordinal, monthWeekday: 1 },
    };
    assert.equal(repeatSlots(mondays, date).length, 1);
    assert.equal(repeatSlots(mondays, '2026-09-08').length, 0);
  }
  const hourly = {
    ...base,
    schedule: { ...everyThreeDays, unit: 'hours' as const, interval: 6 },
  };
  assert.deepEqual(
    repeatSlots(hourly, '2026-09-15').map((slot) => slot.time),
    ['08:00', '14:00', '20:00']
  );
  assert.deepEqual(
    repeatSlots(hourly, '2026-09-16').map((slot) => slot.time),
    ['02:00', '08:00', '14:00', '20:00']
  );
});
void test('editing stops at the scheduled local minute, including daylight saving and different dates', () => {
  const series = defaults().series[0]!;
  const slot = parseDate('2026-12-25');
  assert.equal(
    isFutureSlot(series, slot, new Date('2026-12-25T07:59:00Z')),
    true
  );
  assert.equal(
    isFutureSlot(series, slot, new Date('2026-12-25T08:00:00Z')),
    false
  );
  assert.equal(
    isFutureSlot(series, slot, new Date('2026-12-26T00:00:00Z')),
    false
  );
  assert.equal(
    isFutureSlot(series, slot, new Date('2026-12-24T23:59:00Z')),
    true
  );
  assert.equal(
    isFutureSlot(
      series,
      parseDate('2026-07-25'),
      new Date('2026-07-25T07:00:00Z')
    ),
    false
  );
});
void test('access is scoped by account ID, series and expiry; explicit host roles are independent', () => {
  const [eu, us] = defaults().series;
  eu!.maintainers = [
    { id: 't2_a', username: 'Volunteer', through: '2026-09' },
    { id: 't2_b', username: 'CoHost', through: '' },
  ];
  assert.equal(canMaintain(eu!, 't2_a', '2026-09', false), true);
  assert.equal(canMaintain(us!, 't2_a', '2026-09', false), false);
  assert.equal(canMaintain(eu!, 't2_a', '2026-10', false), false);
  assert.equal(canMaintain(eu!, 'other', '2026-10', true), true);
  eu!.hosts['2026-09'] = ['t2_a'];
  assert.deepEqual(hostNames(eu!, '2026-09'), ['Volunteer']);
  eu!.maintainers = eu!.maintainers.filter((m) => m.id !== 't2_a');
  assert.deepEqual(hostNames(eu!, '2026-09'), []);
  eu!.hosts['2026-10'] = ['CreditOnlyUser'];
  assert.deepEqual(hostNames(eu!, '2026-10'), ['CreditOnlyUser']);
  eu!.maintainers = [{ id: 't2_c', username: 'Volunteer', through: '2026-09' }];
  eu!.hostRoster = ['Volunteer', 'CreditOnlyUser'];
  assert.equal(canMaintain(eu!, 't2_c', '2026-11', false), false);
  assert.deepEqual(hostNames(eu!, '2026-11'), ['Volunteer', 'CreditOnlyUser']);
});
void test('post rendering preserves challenge name, real day number and host attribution', () => {
  const result = renderPost(
    defaults().series[0]!,
    parseDate('2026-08-31'),
    ['HostA', 'HostB'],
    { signup: 'https://reddit.com/a' }
  );
  assert.match(
    result.title,
    /30 Day Accountability Challenge — EU — Day 31 August 2026 Wrap Ups/
  );
  assert.match(result.text, /u\/HostA and u\/HostB/);
  assert.match(result.text, /Monthly signup/);
});
void test('series templates override defaults and expand supported placeholders', () => {
  const series = defaults().series[0]!;
  series.templates.daily =
    '{series} {month} day {day}\n{host_credit_monthly}\n{signup_link}\n{previous_link}';
  series.titles.daily = '{series} check-in {day} {month}';
  series.hostCredit = '{hosts} · {series} · {month}';
  const result = renderPost(series, parseDate('2026-09-02'), ['HostA'], {
    signup: 'https://reddit.com/signup',
    previous: 'https://reddit.com/previous',
  });
  assert.match(result.text, /EU September 2026 day 2/);
  assert.match(result.text, /u\/HostA · EU · September 2026/);
  assert.match(result.text, /https:\/\/reddit\.com\/signup/);
  assert.match(result.text, /https:\/\/reddit\.com\/previous/);
  assert.equal(result.title, 'EU check-in 2 September 2026');
  const withoutFooter = renderPost(
    series,
    parseDate('2026-09-02'),
    ['HostA'],
    {
      signup: 'https://reddit.com/signup',
      previous: 'https://reddit.com/previous',
    },
    undefined,
    undefined,
    undefined,
    false
  );
  assert.doesNotMatch(withoutFooter.text, /Scheduled with Check-In Crew/);
  assert.throws(() =>
    validateSeries({ ...series, templates: { daily: '   ' } })
  );
  assert.throws(() =>
    validateSeries({ ...series, templates: { daily: 'x'.repeat(12001) } })
  );
  assert.throws(() =>
    validateSeries({ ...series, titles: { daily: 'line 1\nline 2' } })
  );
  assert.throws(() =>
    validateSeries({ ...series, hostCredit: 'line 1\nline 2' })
  );
});
void test('simple titles include frequency, weekday and ISO date placeholders', () => {
  const series = { ...defaults().series[0]!, seriesType: 'simple' as const };
  const daily = renderPost(series, parseDate('2026-09-14'), [], {});
  assert.equal(daily.title, 'Daily EU — Monday 2026-09-14');
  const weekly = {
    ...series,
    frequency: 'weekly' as const,
    titles: {},
  };
  const weeklyPost = renderPost(weekly, parseDate('2026-09-14'), [], {});
  assert.equal(weeklyPost.title, 'Weekly EU — Monday 2026-09-14');
});
void test('unsafe labels and invalid schedules are rejected', () => {
  const series = defaults().series[0]!;
  assert.throws(() => validateSeries({ ...series, time: '24:00' }));
  assert.throws(() =>
    validateSeries({ ...series, timezone: 'Europe/NotAPlace' })
  );
  assert.throws(() =>
    validateSeries({ ...series, label: '[link](https://example.com)' })
  );
});
function memoryStore(): PublisherStore {
  const records = new Map<string, Publication>();
  return {
    async reserve(key, record) {
      if (records.has(key)) return false;
      records.set(key, record);
      return true;
    },
    async read(key) {
      return records.get(key);
    },
    async write(key, record) {
      records.set(key, record);
    },
  };
}
void test('concurrent scheduler / manual / trigger attempts send only one post', async () => {
  const store = memoryStore();
  let sends = 0;
  const send = async () => {
    sends++;
    await new Promise((r) => setTimeout(r, 10));
    return { id: 't3_one', url: 'https://reddit.com/one' };
  };
  await Promise.all(
    Array.from({ length: 20 }, () =>
      publishOnce(store, 'same-slot', 'tester', send)
    )
  );
  assert.equal(sends, 1);
  assert.equal((await store.read('same-slot'))?.status, 'posted');
  await publishOnce(store, 'same-slot', 'retry', send);
  assert.equal(sends, 1);
  await publishOnce(store, 'other-series-slot', 'scheduler', send);
  assert.equal(sends, 2);
});
void test('an ambiguous Reddit failure is not automatically retried', async () => {
  const store = memoryStore();
  let sends = 0;
  const send = async () => {
    sends++;
    throw new Error('Response lost after submission');
  };
  await assert.rejects(publishOnce(store, 'slot', 'scheduler', send));
  const retry = await publishOnce(store, 'slot', 'retry', send);
  assert.equal(retry.status, 'uncertain');
  assert.equal(sends, 1);
});
void test('failure to persist a successful post cannot cause a blind duplicate', async () => {
  const store = memoryStore();
  let sends = 0;
  const broken: PublisherStore = {
    ...store,
    async write() {
      throw new Error('Storage unavailable');
    },
  };
  await assert.rejects(
    publishOnce(broken, 'slot', 'scheduler', async () => {
      sends++;
      return { id: 't3_one', url: 'https://reddit.com/one' };
    })
  );
  const retry = await publishOnce(store, 'slot', 'retry', async () => {
    sends++;
    return { id: 't3_two', url: 'https://reddit.com/two' };
  });
  assert.equal(sends, 1);
  assert.equal(retry.status, 'pending');
});
