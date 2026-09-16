import { localClock, parseDate, type Series, type Slot } from './model.ts';

export type RepeatRule = {
  frequency: 'daily' | 'weekly' | 'other';
  unit: 'hours' | 'days' | 'weeks' | 'months';
  interval: number;
  start: string;
  weekdays: number[];
  monthMode: 'day' | 'last' | 'weekday';
  monthDay: number;
  ordinal: number;
  monthWeekday: number;
  shortMonth: 'skip' | 'last';
  endDate?: string;
  maxPosts?: number;
};
export type ScheduleSource = Pick<
  Series,
  'frequency' | 'weekday' | 'timezone' | 'time'
> & { schedule?: RepeatRule; until?: string };
const DAY = 86400000;
const utcDay = (date: string) => Date.parse(date + 'T00:00:00Z');
const conversions = new Map<string, number | null>();

// Resolve a civil time using offsets on both sides of a DST transition.
// Missing civil times are skipped; repeated civil times use the first occurrence.
export function localInstant(
  local: string,
  timezone: string
): number | undefined {
  const key = timezone + ':' + local;
  if (conversions.has(key)) return conversions.get(key) ?? undefined;
  const naive = Date.parse(local + ':00Z');
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const instant = naive + delta * 3600000;
    const clock = localClock(new Date(instant), timezone);
    offsets.add(Date.parse(`${clock.date}T${clock.time}:00Z`) - instant);
  }
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((instant) => {
      const clock = localClock(new Date(instant), timezone);
      return `${clock.date}T${clock.time}` === local;
    });
  const result = matches.length ? Math.min(...matches) : undefined;
  if (conversions.size > 4096) conversions.clear();
  conversions.set(key, result ?? null);
  return result;
}
export function validateRule(rule: RepeatRule, timezone: string): void {
  if (
    !rule ||
    !['daily', 'weekly', 'other'].includes(rule.frequency) ||
    !['hours', 'days', 'weeks', 'months'].includes(rule.unit)
  )
    throw Error('Choose a supported repeat pattern.');
  if (
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 120
  )
    throw Error('Repeat every 1–120 units.');
  if (
    typeof rule.start !== 'string' ||
    !/^20\d\d-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/.test(rule.start)
  )
    throw Error('Choose a start date and time.');
  parseDate(rule.start.slice(0, 10));
  if (localInstant(rule.start, timezone) === undefined)
    throw Error(
      'That local time does not exist because the clocks change. Choose another time.'
    );
  if (
    !Array.isArray(rule.weekdays) ||
    rule.weekdays.length > 7 ||
    rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    (rule.unit === 'weeks' && !rule.weekdays.length)
  )
    throw Error('Choose the weekdays to post on.');
  if (
    !['day', 'last', 'weekday'].includes(rule.monthMode) ||
    !['skip', 'last'].includes(rule.shortMonth) ||
    !Number.isInteger(rule.monthDay) ||
    rule.monthDay < 1 ||
    rule.monthDay > 31 ||
    ![-1, 1, 2, 3, 4].includes(rule.ordinal) ||
    !Number.isInteger(rule.monthWeekday) ||
    rule.monthWeekday < 0 ||
    rule.monthWeekday > 6
  )
    throw Error('Choose valid monthly repeat options.');
  if (
    (rule.frequency === 'daily' &&
      (rule.unit !== 'days' || rule.interval !== 1)) ||
    (rule.frequency === 'weekly' &&
      (rule.unit !== 'weeks' ||
        rule.interval !== 1 ||
        rule.weekdays.length !== 1))
  )
    throw Error('Use Other for a custom repeat pattern.');
  if (rule.endDate) {
    parseDate(rule.endDate);
    if (rule.endDate < rule.start.slice(0, 10))
      throw Error('The end date must follow the start date.');
  }
  if (
    rule.maxPosts !== undefined &&
    (!Number.isInteger(rule.maxPosts) ||
      rule.maxPosts < 1 ||
      rule.maxPosts > 10000)
  )
    throw Error('Choose between 1 and 10,000 scheduled posts.');
  if (rule.endDate && rule.maxPosts !== undefined)
    throw Error('Choose one way to end the schedule.');
}
function monthDate(
  year: number,
  month: number,
  rule: RepeatRule
): number | undefined {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (rule.monthMode === 'last') return last;
  if (rule.monthMode === 'day')
    return rule.monthDay <= last
      ? rule.monthDay
      : rule.shortMonth === 'last'
        ? last
        : undefined;
  if (rule.ordinal === -1)
    return (
      last -
      ((new Date(Date.UTC(year, month, last)).getUTCDay() -
        rule.monthWeekday +
        7) %
        7)
    );
  return (
    1 +
    ((rule.monthWeekday - new Date(Date.UTC(year, month, 1)).getUTCDay() + 7) %
      7) +
    (rule.ordinal - 1) * 7
  );
}
function ordinalForDate(rule: RepeatRule, date: string): number | undefined {
  const startDate = rule.start.slice(0, 10);
  const delta = (utcDay(date) - utcDay(startDate)) / DAY;
  if (delta < 0) return undefined;
  if (rule.unit === 'days')
    return delta % rule.interval === 0 ? delta / rule.interval + 1 : undefined;
  if (rule.unit === 'weeks') {
    const startWeekday = (new Date(utcDay(startDate)).getUTCDay() + 6) % 7;
    const cycle = Math.floor((delta + startWeekday) / 7);
    const weekday = (new Date(utcDay(date)).getUTCDay() + 6) % 7;
    const days = [...new Set(rule.weekdays.map((d) => (d + 6) % 7))].sort();
    if (cycle % rule.interval || !days.includes(weekday)) return undefined;
    return (
      (cycle / rule.interval) * days.length +
      days.filter((d) => d <= weekday).length -
      days.filter((d) => d < startWeekday).length
    );
  }
  const first = new Date(utcDay(startDate));
  const target = new Date(utcDay(date));
  const months =
    (target.getUTCFullYear() - first.getUTCFullYear()) * 12 +
    target.getUTCMonth() -
    first.getUTCMonth();
  if (
    months % rule.interval ||
    monthDate(target.getUTCFullYear(), target.getUTCMonth(), rule) !==
      target.getUTCDate()
  )
    return undefined;
  let count = 0;
  for (let offset = 0; offset <= months; offset += rule.interval) {
    const month = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1)
    );
    const day = monthDate(month.getUTCFullYear(), month.getUTCMonth(), rule);
    if (day && (offset > 0 || day >= first.getUTCDate())) count++;
  }
  return count || undefined;
}
function sourceSlots(source: ScheduleSource, date: string): Slot[] {
  const rule = source.schedule;
  const parsed = parseDate(date);
  if (!rule) {
    if (source.frequency === 'other') return [];
    if (
      source.frequency === 'weekly' &&
      new Date(utcDay(date)).getUTCDay() !== source.weekday
    )
      return [];
    const at = localInstant(`${date}T${source.time}`, source.timezone);
    return at === undefined
      ? []
      : [
          {
            ...parsed,
            kind: 'daily',
            at: new Date(at).toISOString(),
            time: source.time,
            timezone: source.timezone,
            legacy: true,
          },
        ];
  }
  if (date < rule.start.slice(0, 10) || (rule.endDate && date > rule.endDate))
    return [];
  const anchor = localInstant(rule.start, source.timezone)!;
  const result: Slot[] = [];
  if (rule.unit === 'hours') {
    const step = rule.interval * 3600000;
    const begin = Math.max(0, Math.ceil((utcDay(date) - DAY - anchor) / step));
    for (
      let index = begin;
      anchor + index * step < utcDay(date) + 2 * DAY;
      index++
    ) {
      if (rule.maxPosts && index >= rule.maxPosts) break;
      const at = anchor + index * step;
      const clock = localClock(new Date(at), source.timezone);
      if (clock.date === date)
        result.push({
          ...parsed,
          kind: 'daily',
          at: new Date(at).toISOString(),
          time: clock.time,
          timezone: source.timezone,
          hourly: true,
        });
    }
  } else {
    const ordinal = ordinalForDate(rule, date);
    if (!ordinal || (rule.maxPosts && ordinal > rule.maxPosts)) return [];
    const at = localInstant(`${date}T${rule.start.slice(11)}`, source.timezone);
    if (at !== undefined && at >= anchor)
      result.push({
        ...parsed,
        kind: 'daily',
        at: new Date(at).toISOString(),
        time: rule.start.slice(11),
        timezone: source.timezone,
      });
  }
  return result;
}
export function repeatSlots(series: Series, date: string): Slot[] {
  const sources: ScheduleSource[] = [...(series.scheduleHistory ?? []), series];
  const unique = new Map<string, Slot>();
  for (const source of sources)
    for (const slot of sourceSlots(source, date)) {
      if (source.until && slot.at! >= source.until) continue;
      const baseline = series.legacySchedule;
      if (baseline) {
        const oldDate = localClock(new Date(slot.at!), baseline.timezone).date;
        if (sourceSlots(baseline, oldDate).some((old) => old.at === slot.at)) {
          slot.legacy = true;
          slot.legacyDate = oldDate;
        }
      }
      unique.set(slot.at!, slot);
    }
  return [...unique.values()].sort((a, b) => a.at!.localeCompare(b.at!));
}
export function scheduleSummary(source: ScheduleSource): string {
  const rule = source.schedule;
  const names = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  if (!rule)
    return source.frequency === 'weekly'
      ? `Weekly on ${names[source.weekday]}`
      : source.frequency === 'other'
        ? 'Other schedule not configured'
        : 'Daily';
  let summary =
    rule.frequency === 'daily'
      ? 'Daily'
      : `Every ${rule.interval} ${rule.unit}`;
  if (rule.unit === 'weeks')
    summary += ` on ${rule.weekdays.map((d) => names[d]).join(', ')}`;
  if (rule.unit === 'months')
    summary +=
      rule.monthMode === 'last'
        ? ', last day of the month'
        : rule.monthMode === 'weekday'
          ? `, ${rule.ordinal === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth'][rule.ordinal]} ${names[rule.monthWeekday]}`
          : `, day ${rule.monthDay} (${rule.shortMonth === 'skip' ? 'skip short months' : 'use last day in short months'})`;
  if (rule.unit === 'hours')
    summary += ` · ${Number((24 / rule.interval).toFixed(2))} posts per day on average`;
  summary += ` · from ${rule.start.replace('T', ' ')} ${source.timezone}`;
  if (rule.endDate) summary += ` · ends ${rule.endDate}`;
  if (rule.maxPosts) summary += ` · ${rule.maxPosts} scheduled posts`;
  return summary;
}
