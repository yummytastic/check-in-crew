import { randomUUID } from 'node:crypto';
import { context, reddit, redis, settings } from '@devvit/web/server';
import {
  active,
  canMaintain,
  defaults,
  defaultSticky,
  defaultTemplates,
  defaultTitleTemplates,
  defaultHostCreditTemplate,
  defaultCommunityNote,
  defaultSimpleTemplate,
  defaultSimpleTitleTemplate,
  postOverrideKey,
  validatePostOverride,
  isFutureSlot,
  slotsForSeries,
  parseDate,
  hostNames,
  localClock,
  publishOnce,
  renderPost,
  type Config,
  type Kind,
  type Publication,
  type Series,
  type Slot,
  type PostOverride,
} from './model.ts';
import { localInstant, validateRule, type RepeatRule } from './schedule.ts';
const CONFIG = 'crew:config:v1';
export function generatedSeriesId(): string {
  return 's' + randomUUID().replaceAll('-', '').slice(0, 11);
}
export async function config(): Promise<Config> {
  const saved = await redis.get(CONFIG);
  let parsed: Config;
  if (saved) parsed = JSON.parse(saved) as Config;
  else {
    const initial = defaults();
    for (const series of initial.series) series.id = generatedSeriesId();
    await redis.set(CONFIG, JSON.stringify(initial), { nx: true });
    parsed = JSON.parse(
      (await redis.get(CONFIG)) ?? JSON.stringify(initial)
    ) as Config;
  }
  // Older installations do not have the per-thread sticky settings yet.
  // Fill them in at read time so upgrades remain backwards compatible.
  for (const series of parsed.series) {
    series.seriesType = series.seriesType ?? 'accountability';
    series.frequency = series.frequency ?? 'daily';
    series.weekday = Number.isInteger(series.weekday) ? series.weekday : 1;
    // Retire the old monthly cap. Preview sizes now come from installation settings.
    delete (series as Series & { maxPosts?: number }).maxPosts;
    series.sticky = { ...defaultSticky(), ...(series.sticky ?? {}) };
    series.templates = { ...(series.templates ?? {}) };
    series.titles = { ...(series.titles ?? {}) };
    const creditPlaceholder =
      series.seriesType === 'simple'
        ? '{host_credit_simple}'
        : '{host_credit_monthly}';
    for (const kind of Object.keys(series.templates) as Kind[])
      if (series.templates[kind] !== undefined)
        series.templates[kind] = series.templates[kind]!.replaceAll(
          '{host_credit}',
          creditPlaceholder
        );
    for (const edit of Object.values(series.postOverrides ?? {}))
      if (edit.body !== undefined)
        edit.body = edit.body.replaceAll('{host_credit}', creditPlaceholder);
    if (series.seriesType === 'simple' && series.showHostCredit === undefined)
      series.showHostCredit = false;
    if (series.hostCredit === '') delete series.hostCredit;
  }
  return parsed;
}
export class AccessDenied extends Error {}
export async function identity() {
  if (!context.userId)
    throw new AccessDenied('Sign in to Reddit to manage Check-In Crew.');
  const user = await reddit.getCurrentUser();
  if (!user || user.id !== context.userId)
    throw new Error('Unable to verify your Reddit account.');
  const mods = await reddit
    .getModerators({
      subredditName: context.subredditName,
      username: user.username,
    })
    .all();
  const mod = mods.find((m) => m.id === user.id);
  const admin = Boolean(
    mod &&
    (await user.getModPermissionsForSubreddit(context.subredditName)).includes(
      'all'
    )
  );
  if (!admin) {
    const banned = await reddit
      .getBannedUsers({
        subredditName: context.subredditName,
        username: user.username,
      })
      .all();
    if (banned.some((b) => b.id === user.id))
      throw new AccessDenied('This account cannot manage this community.');
  }
  return { id: user.id as string, username: user.username, admin };
}
export type Identity = Awaited<ReturnType<typeof identity>>;
export async function manualPostingAllowed(): Promise<boolean> {
  const value = await settings.get<boolean | string>('allowManualPosting');
  return value === true || value === 'true';
}
export function previewCount(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 60
    ? count
    : undefined;
}
export async function configuredPreviewCounts() {
  const [daily, weekly, other] = await Promise.all([
    settings.get<number | string>('dailyPostsAhead'),
    settings.get<number | string>('weeklyPostsAhead'),
    settings.get<number | string>('otherPostsAhead'),
  ]);
  return {
    daily: previewCount(daily) ?? 15,
    weekly: previewCount(weekly) ?? 5,
    other: previewCount(other) ?? 5,
  };
}
export async function configuredSeriesLimit(): Promise<number> {
  return previewCount(await settings.get<number | string>('maxSeries')) ?? 10;
}
export function seriesCount(cfg: Config): number {
  return cfg.series.filter((series) => !series.archived).length;
}
export function checkSeriesCapacity(cfg: Config, limit: number): void {
  if (seriesCount(cfg) >= limit)
    throw new Error(
      `This community has reached its limit of ${limit} series. A moderator can change Maximum series in app settings (up to 60). Paused series also count.`
    );
}
export async function hourlyAllowed(): Promise<boolean> {
  const value = await settings.get<boolean | string>('allowHourlySchedules');
  return value === true || value === 'true';
}
export async function showCrewFooter(): Promise<boolean> {
  return (await settings.get<boolean>('showCrewFooter')) !== false;
}
const templateSettingKeys: Record<Kind, string> = {
  signup: 'defaultSignupTemplate',
  daily: 'defaultDailyTemplate',
  roundup: 'defaultRoundupTemplate',
};
const titleSettingKeys: Record<Kind, string> = {
  signup: 'defaultSignupTitle',
  daily: 'defaultDailyTitle',
  roundup: 'defaultRoundupTitle',
};
export async function configuredHostCredit(): Promise<string> {
  const value =
    (await settings.get<string>('defaultMonthlyHostCredit')) ??
    (await settings.get<string>('defaultHostCredit'));
  return typeof value === 'string' &&
    value.trim() &&
    value.length <= 300 &&
    !/[\r\n]/.test(value)
    ? value
    : defaultHostCreditTemplate();
}
export async function configuredSimpleHostCredit(): Promise<string> {
  const value = await settings.get<string>('defaultSimpleHostCredit');
  return typeof value === 'string' && value.trim() && value.length <= 300 && !/[\r\n]/.test(value)
    ? value
    : defaultHostCreditTemplate();
}
export async function configuredCommunityNote(): Promise<string> {
  const value = await settings.get<string>('defaultCommunityNote');
  return typeof value === 'string' && value.length <= 12000
    ? value
    : defaultCommunityNote();
}
export async function configuredTemplates(
  series?: Series
): Promise<Record<Kind, string>> {
  const builtIns = defaultTemplates();
  const values = await Promise.all(
    (Object.keys(templateSettingKeys) as Kind[]).map(
      async (kind) =>
        [kind, await settings.get<string>(templateSettingKeys[kind])] as const
    )
  );
  for (const [kind, value] of values) {
    if (typeof value === 'string' && value.trim() && value.length <= 12000)
      builtIns[kind] = value;
  }
  if (series?.seriesType === 'simple') {
    const value = await settings.get<string>('defaultSimpleTemplate');
    builtIns.daily =
      typeof value === 'string' && value.trim() && value.length <= 12000
        ? value.replaceAll('{host_credit}', '{host_credit_simple}')
        : defaultSimpleTemplate();
  } else {
    for (const kind of Object.keys(builtIns) as Kind[])
      builtIns[kind] = builtIns[kind].replaceAll(
        '{host_credit}',
        '{host_credit_monthly}'
      );
  }
  return builtIns;
}
export async function configuredTitleTemplates(
  series?: Series
): Promise<Record<Kind, string>> {
  const builtIns = defaultTitleTemplates();
  const values = await Promise.all(
    (Object.keys(titleSettingKeys) as Kind[]).map(
      async (kind) =>
        [kind, await settings.get<string>(titleSettingKeys[kind])] as const
    )
  );
  for (const [kind, value] of values) {
    if (
      typeof value === 'string' &&
      value.trim() &&
      value.length <= 300 &&
      !/[\r\n]/.test(value)
    )
      builtIns[kind] = value;
  }
  if (series?.seriesType === 'simple') {
    const key =
      series.frequency === 'other'
        ? 'defaultSimpleOtherTitle'
        : series.frequency === 'weekly'
          ? 'defaultSimpleWeeklyTitle'
          : 'defaultSimpleDailyTitle';
    const value = await settings.get<string>(key);
    builtIns.daily =
      typeof value === 'string' &&
      value.trim() &&
      value.length <= 300 &&
      !/[\r\n]/.test(value)
        ? value
        : series.frequency === 'other'
          ? '{series} — {weekday} {date}'
          : defaultSimpleTitleTemplate();
  }
  return builtIns;
}
export function allowed(series: Series, who: Identity): boolean {
  return canMaintain(
    series,
    who.id,
    localClock(new Date(), series.timezone).date.slice(0, 7),
    who.admin
  );
}
export function requireSeries(
  cfg: Config,
  id: string,
  who: Identity,
  includeArchived = false
): Series {
  const series = cfg.series.find((s) => s.id === id);
  if (!series || !allowed(series, who))
    throw new Error(
      'You do not have access to this series. Ask a moderator to assign you.'
    );
  if (series.archived && !includeArchived)
    throw new Error(
      'This series is archived. Restore it in the dashboard before making changes.'
    );
  return series;
}
export async function saveConfig(
  expected: number,
  who: Identity,
  change: (cfg: Config) => void | Promise<void>,
  watchKeys: string[] = []
): Promise<void> {
  const tx = await redis.watch(CONFIG, ...watchKeys);
  let executed = false;
  try {
    const cfg = await config();
    if (cfg.revision !== expected)
      throw new Error(
        'Someone changed the settings. Reopen Check-In Crew and try again.'
      );
    await change(cfg);
    cfg.revision++;
    await tx.multi();
    await tx.set(CONFIG, JSON.stringify(cfg));
    await tx.hSet('crew:audit', {
      [String(cfg.revision)]: JSON.stringify({
        at: new Date().toISOString(),
        by: who.username,
        action: 'Configuration updated',
      }),
    });
    const result = await tx.exec();
    executed = true;
    if (!result?.length)
      throw new Error(
        'Settings changed at the same time. Reopen and try again.'
      );
  } finally {
    if (!executed) await tx.unwatch();
  }
}
export const publicationKey = (id: string, slot: Slot) =>
  `crew:post:${id}:${postOverrideKey(slot)}`;
export function storedSlot(series: Series, key: string): Slot {
  if (series.overrideSlots?.[key]) return series.overrideSlots[key]!;
  const match = /^(20\d\d-\d\d-\d\d):(signup|daily|roundup)(?:@(.+))?$/.exec(
    key
  );
  if (!match) throw Error('Invalid saved post reference.');
  const base = series.legacySchedule ?? series;
  const slot: Slot = { ...parseDate(match[1]!), kind: match[2] as Kind };
  const at =
    match[3] ??
    (localInstant(`${slot.date}T${base.time}`, base.timezone) !== undefined
      ? new Date(
          localInstant(`${slot.date}T${base.time}`, base.timezone)!
        ).toISOString()
      : undefined);
  return {
    ...slot,
    ...(at ? { at } : {}),
    time: at
      ? localClock(new Date(at), match[3] ? series.timezone : base.timezone)
          .time
      : base.time,
    timezone: match[3] ? series.timezone : base.timezone,
    legacy: !match[3],
  };
}
export async function historySlots(
  series: Series,
  month: string
): Promise<Slot[]> {
  const index = await redis.hGetAll(`crew:history:${series.id}:${month}`);
  return Object.entries(index).map(([key, value]) => {
    if (value.startsWith('{')) return JSON.parse(value) as Slot;
    return storedSlot(series, key.slice(`crew:post:${series.id}:`.length));
  });
}
export async function resolveSlot(
  series: Series,
  date: string,
  kind: Kind,
  id?: unknown,
  allowHistory = false
): Promise<Slot> {
  const candidates = slotsForSeries(series, date).filter(
    (slot) => slot.kind === kind
  );
  const slot =
    typeof id === 'string'
      ? candidates.find((slot) => postOverrideKey(slot) === id)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
  if (slot) return slot;
  if (allowHistory && typeof id === 'string') {
    const historical = (await historySlots(series, date.slice(0, 7))).find(
      (slot) =>
        slot.date === date && slot.kind === kind && postOverrideKey(slot) === id
    );
    if (
      historical &&
      (await publicationStore.read(publicationKey(series.id, historical)))
    )
      return historical;
  }
  throw Error(
    'Choose a current scheduled occurrence. Refresh the dashboard if its schedule changed.'
  );
}
export function unscheduledDrafts(series: Series, now = new Date()) {
  return Object.entries(series.postOverrides ?? {}).flatMap(
    ([key, content]) => {
      const slot = storedSlot(series, key);
      if (!isFutureSlot(series, slot, now) && !series.schedule) return [];
      if (
        slotsForSeries(series, slot.date).some(
          (candidate) => postOverrideKey(candidate) === key
        )
      )
        return [];
      return [{ key, slot, ...content }];
    }
  );
}
export function withSchedule(
  series: Series,
  rule: RepeatRule,
  timezone: string,
  now = new Date()
): Series {
  validateRule(rule, timezone);
  const at = localInstant(rule.start, timezone)!;
  if (at <= now.getTime())
    throw Error('Choose a future date and time for the schedule change.');
  const until = new Date(at).toISOString();
  const old = {
    frequency: series.frequency,
    weekday: series.weekday,
    time: series.time,
    timezone: series.timezone,
    ...(series.schedule ? { schedule: series.schedule } : {}),
    until,
  };
  const history = [
    ...(series.scheduleHistory ?? []).map((source) => ({
      ...source,
      until: source.until && source.until < until ? source.until : until,
    })),
    old,
  ];
  return {
    ...series,
    ...(!series.legacySchedule && !series.schedule
      ? { legacySchedule: old }
      : {}),
    scheduleHistory: history,
    overrideSlots: Object.fromEntries(
      Object.keys(series.postOverrides ?? {}).map((key) => [
        key,
        storedSlot(series, key),
      ])
    ),
    frequency: rule.frequency,
    weekday: rule.weekdays[0] ?? 1,
    time: rule.start.slice(11),
    timezone,
    schedule: rule,
  };
}
export async function changeSchedule(
  id: string,
  rule: RepeatRule,
  timezone: string,
  revision: number,
  who: Identity
) {
  if (rule.unit === 'hours' && !(await hourlyAllowed()))
    throw Error('Hourly schedules are disabled in app settings.');
  await saveConfig(revision, who, (next) => {
    const series = requireSeries(next, id, who);
    if (series.seriesType !== 'simple')
      throw Error('Only simple recurring posts can change repeat patterns.');
    Object.assign(series, withSchedule(series, rule, timezone));
  });
}
export async function postEditor(series: Series, slot: Slot) {
  const bodies = await configuredTemplates(series);
  const titles = await configuredTitleTemplates(series);
  const inherited = {
    title: series.titles[slot.kind] ?? titles[slot.kind],
    body: series.templates[slot.kind] ?? bodies[slot.kind],
  };
  const override = series.postOverrides?.[postOverrideKey(slot)] ?? {};
  const publication = await publicationStore.read(
    publicationKey(series.id, slot)
  );
  return {
    inherited,
    override,
    editable: !series.archived && !publication && isFutureSlot(series, slot),
    publication,
  };
}
export async function savePostOverride(
  id: string,
  slot: Slot,
  value: PostOverride,
  revision: number,
  who: Identity
) {
  validatePostOverride(value);
  await saveConfig(
    revision,
    who,
    async (cfg) => {
      const series = requireSeries(cfg, id, who);
      if (
        !slotsForSeries(series, slot.date).some(
          (candidate) => postOverrideKey(candidate) === postOverrideKey(slot)
        )
      )
        throw new Error('Choose a scheduled date and post type.');
      if (!isFutureSlot(series, slot))
        throw new Error(
          'Only posts whose scheduled time is still in the future can be edited.'
        );
      if (await publicationStore.read(publicationKey(id, slot)))
        throw new Error(
          'Publication has already started. This scheduled post can no longer be edited.'
        );
      series.postOverrides ??= {};
      series.overrideSlots ??= {};
      series.overrideSlots[postOverrideKey(slot)] = slot;
      if (value.title === undefined && value.body === undefined)
        delete series.postOverrides[postOverrideKey(slot)];
      else series.postOverrides[postOverrideKey(slot)] = value;
    },
    [publicationKey(id, slot)]
  );
}
export const publicationStore = {
  async reserve(key: string, record: Publication) {
    return (
      (await redis.set(key, JSON.stringify(record), { nx: true })) === 'OK'
    );
  },
  async read(key: string): Promise<Publication | undefined> {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as Publication) : undefined;
  },
  async write(key: string, record: Publication) {
    await redis.set(key, JSON.stringify(record));
  },
};
export async function upcomingSimpleSlots(
  series: Series,
  now = new Date(),
  windowSize?: number
): Promise<Slot[]> {
  if (series.frequency === 'other' && !series.schedule) return [];
  const result: Slot[] = [];
  const date = new Date(localClock(now, series.timezone).date + 'T12:00:00Z');
  const count =
    previewCount(windowSize) ??
    (await configuredPreviewCounts())[series.frequency];
  // The limit controls the visible window only. Posting uses slotsForSeries
  // independently and continues after the last date currently displayed.
  for (
    let offset = 0;
    date.getUTCFullYear() <= 2099 && result.length < count;
    offset++
  ) {
    if (
      series.schedule?.endDate &&
      date.toISOString().slice(0, 10) > series.schedule.endDate
    )
      break;
    if (series.schedule?.maxPosts && series.schedule.unit !== 'months') {
      const rule = series.schedule;
      const unitDays =
        rule.unit === 'hours' ? 1 / 24 : rule.unit === 'weeks' ? 7 : 1;
      const latest =
        localInstant(rule.start, series.timezone)! +
        (rule.maxPosts! + 2) * rule.interval * unitDays * 86400000;
      if (date.getTime() > latest + 86400000) break;
    }
    for (const slot of slotsForSeries(
      series,
      date.toISOString().slice(0, 10)
    )) {
      if (!isFutureSlot(series, slot, now)) continue;
      const record = await publicationStore.read(
        publicationKey(series.id, slot)
      );
      if (record?.status !== 'posted') result.push(slot);
      if (result.length >= count) break;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}
export async function preview(series: Series, slot: Slot) {
  const signup = await publicationStore.read(
    publicationKey(series.id, {
      ...slot,
      date: slot.month + '-01',
      kind: 'signup',
    })
  );
  const prevDate = new Date(slot.date + 'T12:00:00Z');
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const previous =
    slot.day > 1
      ? await publicationStore.read(
          publicationKey(series.id, {
            ...slot,
            date: prevDate.toISOString().slice(0, 10),
            kind: 'daily',
          })
        )
      : undefined;
  return renderPost(
    series,
    slot,
    hostNames(series, slot.month),
    {
      ...(slot.kind !== 'signup' && signup?.url ? { signup: signup.url } : {}),
      ...(previous?.url ? { previous: previous.url } : {}),
    },
    await configuredTemplates(series),
    await configuredTitleTemplates(series),
    {
      monthly: await configuredHostCredit(),
      simple: await configuredSimpleHostCredit(),
    },
    await showCrewFooter(),
    await configuredCommunityNote()
  );
}
export async function publish(
  id: string,
  slot: Slot,
  actor: string,
  automated = false,
  expectedRevision?: number
) {
  const cfg = await config();
  if (expectedRevision !== undefined && cfg.revision !== expectedRevision)
    throw new Error('Settings changed. Preview the thread again.');
  const series = cfg.series.find((s) => s.id === id);
  if (!series || series.archived || (automated && !series.enabled))
    throw new Error('Series is paused or unavailable.');
  if (slot.hourly && !(await hourlyAllowed()))
    throw Error('Hourly schedules are disabled in app settings.');
  if (
    series.schedule &&
    !slotsForSeries(series, slot.date).some(
      (candidate) => postOverrideKey(candidate) === postOverrideKey(slot)
    )
  )
    throw Error('This occurrence no longer belongs to the schedule.');
  const key = publicationKey(id, slot);
  const existing = await publicationStore.read(key);
  if (existing) return existing;
  const content = await preview(series, slot);
  // The small month index lists reserved attempts too, so failures are visible.
  await redis.hSet(`crew:history:${id}:${slot.month}`, {
    [key]: JSON.stringify({
      ...slot,
      time: slot.time ?? series.time,
      timezone: slot.timezone ?? series.timezone,
    }),
  });
  // Reserve against the configuration revision too: an edit either wins before
  // reservation, or sees the reservation and is refused. Never publish a stale draft.
  const guardedStore = {
    ...publicationStore,
    async reserve(postKey: string, record: Publication) {
      const tx = await redis.watch(CONFIG, postKey);
      let executed = false;
      try {
        if (await publicationStore.read(postKey)) return false;
        if ((await config()).revision !== cfg.revision)
          throw new Error(
            'Post settings changed before publication. Try again with a fresh preview.'
          );
        await tx.multi();
        await tx.set(postKey, JSON.stringify(record));
        const result = await tx.exec();
        executed = true;
        if (!result?.length)
          throw new Error(
            'Post settings or publication status changed. Refresh before trying again.'
          );
        return true;
      } finally {
        if (!executed) await tx.unwatch();
      }
    },
  };
  return publishOnce(guardedStore, key, actor, async () => {
    const post = await reddit.submitPost({
      subredditName: context.subredditName,
      title: content.title,
      text: content.text,
    });
    const sticky = series.sticky[slot.kind];
    if (sticky !== 'none') await post.sticky(sticky === 'slot1' ? 1 : 2);
    return { id: post.id, url: post.url };
  });
}
export async function resolveMembers(names: string, through: string) {
  const values = [
    ...new Set(
      names
        .split(/[,\s]+/)
        .map((n) => n.replace(/^u\//i, '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (values.length > 10)
    throw new Error('Use at most 10 maintainers per series.');
  return Promise.all(
    values.map(async (name) => {
      if (!/^[a-z0-9_-]{3,20}$/i.test(name))
        throw new Error('Enter valid Reddit usernames, separated by commas.');
      const user = await reddit.getUserByUsername(name);
      if (!user) throw new Error('Reddit account not found: ' + name);
      return { id: user.id as string, username: user.username, through };
    })
  );
}
export function eligibleHosts(series: Series, month: string) {
  return series.maintainers.filter((m) => active(m, month));
}

export async function resolvePublication(
  key: string,
  expected: Publication,
  replacement: Publication | undefined,
  who: Identity
): Promise<void> {
  if (!['pending', 'uncertain'].includes(expected.status))
    throw Error('Only pending or uncertain publications can be recovered.');
  const tx = await redis.watch(key);
  let executed = false;
  try {
    if (
      JSON.stringify(await publicationStore.read(key)) !==
      JSON.stringify(expected)
    )
      throw new Error(
        'Publication status changed. Reopen recovery and check again.'
      );
    await tx.multi();
    if (replacement) await tx.set(key, JSON.stringify(replacement));
    else await tx.del(key);
    await tx.hSet('crew:recoveries', {
      [key + ':' + Date.now()]: JSON.stringify({
        by: who.username,
        at: new Date().toISOString(),
        postId: replacement?.postId ?? '',
      }),
    });
    const result = await tx.exec();
    executed = true;
    if (!result?.length)
      throw new Error(
        'Publication status changed. Reopen recovery and check again.'
      );
  } finally {
    if (!executed) await tx.unwatch();
  }
}
