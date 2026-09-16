import {
  repeatSlots,
  validateRule,
  type RepeatRule,
  type ScheduleSource,
} from './schedule.ts';
export type Kind = 'signup' | 'daily' | 'roundup';
export type StickyPlacement = 'none' | 'slot1' | 'slot2';
export type StickyConfig = Record<Kind, StickyPlacement>;
export type TemplateOverrides = Partial<Record<Kind, string>>;
export type Member = { id: string; username: string; through: string };
export type SeriesType = 'accountability' | 'simple';
export type SimpleFrequency = 'daily' | 'weekly' | 'other';
export type PostOverride = { title?: string; body?: string };
export const postOverrideKey = (slot: Slot): string =>
  `${slot.legacyDate ?? slot.date}:${slot.kind}${slot.at && !slot.legacy ? '@' + slot.at : ''}`;
export function validatePostOverride(value: PostOverride): void {
  if (
    value.title !== undefined &&
    (!value.title.trim() ||
      value.title.length > 300 ||
      /[\r\n]/.test(value.title))
  )
    throw new Error('Use a single-line title of 1–300 characters.');
  if (
    value.body !== undefined &&
    (!value.body.trim() || value.body.length > 12000)
  )
    throw new Error('Use a post body of 1–12,000 characters.');
}
export type Series = {
  id: string;
  label: string;
  seriesType: SeriesType;
  frequency: SimpleFrequency;
  weekday: number;
  schedule?: RepeatRule;
  scheduleHistory?: ScheduleSource[];
  legacySchedule?: ScheduleSource;
  timezone: string;
  time: string;
  enabled: boolean;
  archived?: boolean;
  deletion?: {
    token: string;
    deletePosts: boolean;
    dueAt: string;
    state: 'waiting' | 'deleting' | 'failed';
    scanMonth: number;
    error?: string;
  };
  sticky: StickyConfig;
  templates: TemplateOverrides;
  titles: TemplateOverrides;
  postOverrides?: Record<string, PostOverride>;
  overrideSlots?: Record<string, Slot>;
  hostCredit?: string;
  showHostCredit?: boolean;
  hostRoster?: string[];
  maintainers: Member[];
  hosts: Record<string, string[]>;
};
export type Config = { revision: number; series: Series[] };
export type Slot = {
  date: string;
  month: string;
  day: number;
  kind: Kind;
  at?: string;
  time?: string;
  timezone?: string;
  legacy?: boolean;
  legacyDate?: string;
  hourly?: boolean;
};
export const defaultSticky = (): StickyConfig => ({
  signup: 'none',
  daily: 'none',
  roundup: 'none',
});
export const defaultTemplates = (): Record<Kind, string> => ({
  signup:
    '{host_credit_monthly}\n\nWelcome to the {month} accountability check-in. Share what you would like to work on this month, and join in at any point.\n\n{community_note}',
  daily:
    '{host_credit_monthly}\n\nHow is your accountability going today? Share a progress update, a challenge, or a small win.\n\n{community_note}\n\n{signup_link}\n{previous_link}',
  roundup:
    '{host_credit_monthly}\n\nAs the month closes, what went well, what did you learn, and what would you like to carry forward?\n\n{community_note}\n\n{signup_link}\n{previous_link}',
});
export const defaultTitleTemplates = (): Record<Kind, string> => ({
  signup: '30 Day Accountability Challenge — {series} — {month} Sign Ups',
  daily: '30 Day Accountability Challenge — {series} — Day {day} {month}',
  roundup:
    '30 Day Accountability Challenge — {series} — Day {day} {month} Wrap Ups',
});
export const defaultHostCreditTemplate = (): string => 'Hosted by {hosts}.';
export const defaultCommunityNote = (): string =>
  'Be kind to yourself and each other. Participation is voluntary; share only what you feel comfortable sharing.';
export const defaultSimpleTemplate = (): string =>
  'Share an update, a question, or something you are working on.\n\n{community_note}';
export const defaultSimpleTitleTemplate = (): string =>
  '{frequency} {series} — {weekday} {date}';
export const defaults = (): Config => ({
  revision: 0,
  series: [
    {
      id: 'eu',
      label: 'EU',
      seriesType: 'accountability',
      frequency: 'daily',
      weekday: 1,
      timezone: 'Europe/London',
      time: '08:00',
      enabled: false,
      sticky: defaultSticky(),
      templates: {},
      titles: {},
      maintainers: [],
      hosts: {},
    },
    {
      id: 'us',
      label: 'US',
      seriesType: 'accountability',
      frequency: 'daily',
      weekday: 1,
      timezone: 'America/New_York',
      time: '20:00',
      enabled: false,
      sticky: defaultSticky(),
      templates: {},
      titles: {},
      maintainers: [],
      hosts: {},
    },
  ],
});
export function validMonth(value: string): boolean {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}
export function parseDate(date: string): Slot {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(date))
    throw new Error('Use a date in YYYY-MM-DD format.');
  const value = new Date(date + 'T12:00:00Z');
  if (
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  )
    throw new Error('That date does not exist.');
  const day = value.getUTCDate();
  const last = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return {
    date,
    month: date.slice(0, 7),
    day,
    kind: day === last ? 'roundup' : 'daily',
  };
}
export function localClock(
  now: Date,
  timezone: string
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
export function slotsFor(date: string): Slot[] {
  const regular = parseDate(date);
  return regular.day === 1
    ? [{ ...regular, kind: 'signup' }, regular]
    : [regular];
}
export function dueSlots(series: Series, now: Date): Slot[] {
  if (!series.enabled || series.archived) return [];
  if (series.seriesType === 'simple' && series.schedule) {
    const dates = new Set([
      localClock(now, series.timezone).date,
      localClock(new Date(now.getTime() - 600000), series.timezone).date,
    ]);
    return [...dates]
      .flatMap((date) => repeatSlots(series, date))
      .filter((slot) => {
        const age = now.getTime() - Date.parse(slot.at!);
        return age >= 0 && age < 600000;
      })
      .slice(-1);
  }
  const clock = localClock(now, series.timezone);
  return clock.time >= series.time ? slotsForSeries(series, clock.date) : [];
}
export function isFutureSlot(
  series: Series,
  slot: Slot,
  now = new Date()
): boolean {
  if (slot.at) return Date.parse(slot.at) > now.getTime();
  const clock = localClock(now, series.timezone);
  return (
    slot.date > clock.date ||
    (slot.date === clock.date && series.time > clock.time)
  );
}
export function slotsForSeries(series: Series, date: string): Slot[] {
  if (series.seriesType !== 'simple') return slotsFor(date);
  if (series.schedule) return repeatSlots(series, date);
  if (series.frequency === 'other') return [];
  const parsed = parseDate(date);
  if (series.frequency === 'weekly') {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if (weekday !== series.weekday) return [];
  }
  return [{ ...parsed, kind: 'daily', legacy: true }];
}
export function active(member: Member, month: string): boolean {
  return member.through === '' || member.through >= month;
}
export function canMaintain(
  series: Series,
  userId: string,
  month: string,
  admin: boolean
): boolean {
  return (
    admin || series.maintainers.some((m) => m.id === userId && active(m, month))
  );
}
export function hostNames(series: Series, month: string): string[] {
  const assigned = series.hosts[month];
  const byName = new Map(
    series.maintainers.map((member) => [member.username.toLowerCase(), member])
  );
  if (!assigned)
    return (
      series.hostRoster?.map((name) => {
        const member = byName.get(name.toLowerCase());
        // Explicit public credit is independent of management access expiry.
        return member?.username ?? name;
      }) ??
      series.maintainers.filter((m) => active(m, month)).map((m) => m.username)
    );
  const byId = new Map(series.maintainers.map((member) => [member.id, member]));
  return assigned.flatMap((value) => {
    const member = byId.get(value);
    if (member) return [member.username];
    const namedMember = byName.get(value.toLowerCase());
    if (namedMember) return [namedMember.username];
    // Older assignments stored Reddit account IDs. Do not show a stale ID
    // after that maintainer has been removed; newer credit-only assignments
    // store usernames and should remain visible.
    return /^t2_[a-z0-9]+$/i.test(value) ? [] : [value];
  });
}
export function validateSeries(series: Series): void {
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(series.id))
    throw new Error(
      'Series ID: use 1–24 lowercase letters, numbers or hyphens, starting with a letter.'
    );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ()-]{0,39}$/.test(series.label))
    throw new Error(
      'Series label: use 1–40 letters, numbers, spaces, parentheses or hyphens.'
    );
  try {
    localClock(new Date(), series.timezone);
  } catch {
    throw new Error(
      'Enter a valid timezone, such as Europe/London or America/New_York.'
    );
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(series.time))
    throw new Error('Posting time must be HH:MM in 24-hour format.');
  if (!['accountability', 'simple'].includes(series.seriesType))
    throw new Error('Choose a supported series type.');
  if (!['daily', 'weekly', 'other'].includes(series.frequency))
    throw new Error('Choose a supported simple-series frequency.');
  if (series.schedule) validateRule(series.schedule, series.timezone);
  if (
    !Number.isInteger(series.weekday) ||
    series.weekday < 0 ||
    series.weekday > 6
  )
    throw new Error('Choose a weekday from Sunday through Saturday.');
  for (const kind of ['signup', 'daily', 'roundup'] as const) {
    if (!['none', 'slot1', 'slot2'].includes(series.sticky?.[kind]))
      throw new Error('Choose a supported sticky option.');
    const template = series.templates?.[kind];
    if (
      template !== undefined &&
      (template.trim() === '' || template.length > 12000)
    )
      throw new Error(
        'Post templates must contain text and be no longer than 12,000 characters.'
      );
    const title = series.titles?.[kind];
    if (
      title !== undefined &&
      (title.trim() === '' || title.length > 300 || /[\r\n]/.test(title))
    )
      throw new Error(
        'Title formats must contain one line of text and be no longer than 300 characters.'
      );
  }
  if (
    series.hostCredit !== undefined &&
    (series.hostCredit.trim() === '' ||
      series.hostCredit.length > 300 ||
      /[\r\n]/.test(series.hostCredit))
  )
    throw new Error(
      'Host credit formats must contain one line of text and be no longer than 300 characters.'
    );
}
export function renderPost(
  series: Series,
  slot: Slot,
  hosts: string[],
  links: { signup?: string; previous?: string },
  configuredDefaults?: Record<Kind, string>,
  configuredTitleDefaults?: Record<Kind, string>,
  configuredHostCredit?: { monthly: string; simple: string },
  showFooter = true,
  communityNote = defaultCommunityNote()
): { title: string; text: string } {
  const month = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(slot.date + 'T12:00:00Z'));
  const frequency =
    series.frequency === 'weekly'
      ? 'Weekly'
      : series.frequency === 'other'
        ? 'Recurring'
        : 'Daily';
  const weekday = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(slot.date + 'T12:00:00Z'));
  const hostNames = hosts.length
    ? hosts.map((n) => 'u/' + n).join(' and ')
    : 'the volunteer team';
  const formatCredit = (format: string) =>
    format
      .replace(/\{hosts\}/g, hostNames)
      .replace(/\{series\}/g, series.label)
      .replace(/\{month\}/g, month);
  const monthlyCredit = formatCredit(
    series.seriesType === 'accountability' && series.hostCredit
      ? series.hostCredit
      : configuredHostCredit?.monthly ?? defaultHostCreditTemplate()
  );
  const simpleCredit =
    series.seriesType === 'simple' && series.showHostCredit
      ? formatCredit(
          series.hostCredit ??
            configuredHostCredit?.simple ??
            defaultHostCreditTemplate()
        )
      : '';
  const templates = configuredDefaults ?? defaultTemplates();
  const titleTemplates = configuredTitleDefaults ?? defaultTitleTemplates();
  const template =
    series.postOverrides?.[postOverrideKey(slot)]?.body ??
    series.templates?.[slot.kind] ??
    (!configuredDefaults &&
    series.seriesType === 'simple' &&
    slot.kind === 'daily'
      ? defaultSimpleTemplate()
      : templates[slot.kind]);
  const values: Record<string, string> = {
    host_credit_monthly: monthlyCredit,
    host_credit_simple: simpleCredit,
    community_note: communityNote,
    signup_link: links.signup ? `[Monthly signup](${links.signup})` : '',
    previous_link: links.previous
      ? `[Previous check-in](${links.previous})`
      : '',
    month,
    day: String(slot.day),
    date: slot.date,
    time: slot.time ?? series.time,
    frequency,
    weekday,
    series: series.label,
  };
  const text = template
    .replace(
      /\{(host_credit_monthly|host_credit_simple|community_note|signup_link|previous_link|month|day|date|time|frequency|weekday|series)\}/g,
      (_, key: string) => values[key] ?? ''
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const titleTemplate =
    series.postOverrides?.[postOverrideKey(slot)]?.title ??
    series.titles?.[slot.kind] ??
    (!configuredTitleDefaults &&
    series.seriesType === 'simple' &&
    slot.kind === 'daily'
      ? defaultSimpleTitleTemplate()
      : titleTemplates[slot.kind]);
  const title = titleTemplate.replace(
    /\{(month|day|date|time|frequency|weekday|series)\}/g,
    (_, key: string) => values[key] ?? ''
  );
  return {
    title,
    text: showFooter
      ? [text, 'Scheduled with Check-In Crew.'].filter(Boolean).join('\n\n')
      : text,
  };
}
export type Publication = {
  status: 'pending' | 'posted' | 'uncertain' | 'deleting' | 'deleted';
  at: string;
  actor: string;
  url?: string;
  postId?: string;
};
export interface PublisherStore {
  reserve(key: string, record: Publication): Promise<boolean>;
  read(key: string): Promise<Publication | undefined>;
  write(key: string, record: Publication): Promise<void>;
}
export async function publishOnce(
  store: PublisherStore,
  key: string,
  actor: string,
  send: () => Promise<{ id: string; url: string }>
): Promise<Publication> {
  const record: Publication = {
    status: 'pending',
    at: new Date().toISOString(),
    actor,
  };
  if (!(await store.reserve(key, record))) {
    const existing = await store.read(key);
    if (!existing)
      throw new Error(
        'Publication is already being processed. Check history before trying again.'
      );
    return existing;
  }
  try {
    const post = await send();
    const saved: Publication = {
      ...record,
      status: 'posted',
      postId: post.id,
      url: post.url,
    };
    await store.write(key, saved);
    return saved;
  } catch (error) {
    // A timeout may occur after Reddit accepted the post. Never blindly retry.
    await store.write(key, { ...record, status: 'uncertain' });
    throw error;
  }
}
