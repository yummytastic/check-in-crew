import { Hono } from 'hono';
import { flair, flairAvailable } from './flair.ts';
import { context, reddit, settings } from '@devvit/web/server';
import {
  hostNames,
  slotsForSeries,
  validMonth,
  validateSeries,
  postOverrideKey,
  validatePostOverride,
  isFutureSlot,
  localClock,
  type StickyPlacement,
} from '../core/model.ts';
import {
  allowed,
  config,
  configuredHostCredit,
  configuredSimpleHostCredit,
  configuredTemplates,
  configuredTitleTemplates,
  eligibleHosts,
  identity,
  AccessDenied,
  manualPostingAllowed,
  publicationKey,
  publicationStore,
  preview,
  publish,
  requireSeries,
  saveConfig,
  postEditor,
  savePostOverride,
  generatedSeriesId,
  upcomingSimpleSlots,
  configuredPreviewCounts,
  configuredSeriesLimit,
  checkSeriesCapacity,
  seriesCount,
  historySlots,
  resolveSlot,
  unscheduledDrafts,
  withSchedule,
  changeSchedule,
  hourlyAllowed,
  resolveMembers,
} from '../core/service.ts';
import { scheduleSummary, type RepeatRule } from '../core/schedule.ts';
import type { Series, Slot } from '../core/model.ts';
import {
  deletionSettings,
  deletionPreview,
  deleteIndividualPost,
  requestSeriesDeletion,
  controlSeriesDeletion,
} from '../core/deletion.ts';
import {
  privacyStatus,
  personalDataDeletionPreview,
  requestPersonalDataDeletion,
  retryPersonalDataDeletion,
} from '../core/privacy.ts';

export const api = new Hono();
api.route('/flair', flair);
// Public responses deliberately contain no configuration, account names or history.
api.get('/public', async (c) => {
  c.header('Cache-Control', 'no-store');
  const enabled = await settings.get('enableCommunityCalculator');
  return c.json({
    calculatorEnabled: enabled === true || enabled === 'true',
    flairEnabled: await flairAvailable(),
    community: context.subredditName,
  });
});
api.get('/access', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!context.userId) return c.json({ access: 'signed-out' });
  try {
    const who = await identity();
    const authorised =
      who.admin || (await config()).series.some((s) => allowed(s, who));
    return c.json({ access: authorised ? 'authorised' : 'unassigned' });
  } catch (error) {
    if (error instanceof AccessDenied) return c.json({ access: 'unassigned' });
    return c.json(
      { access: 'failed', error: 'Could not check access. Please retry.' },
      503
    );
  }
});

const monthForToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());

function monthDays(month: string): string[] {
  const lastDay = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
  ).getUTCDate();
  return Array.from(
    { length: lastDay },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
  );
}

function validSticky(value: unknown): value is StickyPlacement {
  return value === 'none' || value === 'slot1' || value === 'slot2';
}

api.onError((error, c) =>
  c.json(
    { error: error instanceof Error ? error.message : 'Request failed' },
    400
  )
);

api.get('/dashboard', async (c) => {
  const who = await identity();
  const cfg = await config();
  const accessible = cfg.series.filter((series) => allowed(series, who));
  if (!accessible.length && !who.admin)
    return c.json({ error: 'Ask a moderator to assign you to a series.' }, 403);
  const requested = c.req.query('month') ?? monthForToday();
  if (!validMonth(requested)) return c.json({ error: 'Use YYYY-MM.' }, 400);
  const dates = monthDays(requested);
  const now = new Date();
  const archivedView = c.req.query('view') === 'archived';
  const visible = accessible.filter((series) => !series.archived);
  const deletionOptions = await deletionSettings();
  const common = {
    revision: cfg.revision,
    month: requested,
    username: who.username,
    admin: who.admin,
    subreddit: context.subredditName,
    archivedCount: accessible.filter((s) => s.archived).length,
    canDeletePosts: who.admin || deletionOptions.allowMaintainers,
    bulkDeleteCooldownDays: deletionOptions.cooldownDays,
    ...(who.admin
      ? {
          seriesLimit: await configuredSeriesLimit(),
          seriesCount: seriesCount(cfg),
          privacyDeletion: await privacyStatus(),
        }
      : {}),
  };
  if (archivedView) {
    const archivedSeries = await Promise.all(
      accessible
        .filter((s) => s.archived)
        .map(async (s) => ({
          id: s.id,
          label: s.label,
          time: s.time,
          timezone: s.timezone,
          deletion: s.deletion,
          history: await Promise.all(
            (await historySlots(s, requested)).map(async (slot) => ({
              date: slot.date,
              time: slot.time ?? s.time,
              kind: slot.kind,
              publicationKey: publicationKey(s.id, slot),
              ...(await publicationStore.read(publicationKey(s.id, slot))),
            }))
          ),
        }))
    );
    return c.json({
      ...common,
      series: [],
      archivedSeries,
      manualPostingAllowed: false,
    });
  }
  const builtInHostCredit = await configuredHostCredit();
  const manualPosting = await manualPostingAllowed();
  const previewCounts = await configuredPreviewCounts();
  const hourly = await hourlyAllowed();
  const series = await Promise.all(
    visible.map(async (item) => {
      const builtInTemplates = await configuredTemplates(item);
      const builtInTitles = await configuredTitleTemplates(item);
      const eligible = eligibleHosts(item, requested);
      const hosts = hostNames(item, requested);
      const eligibleNames = new Set(
        eligible.map((member) => member.username.toLowerCase())
      );
      const makeRow = async (slot: Slot) => {
        const publication = await publicationStore.read(
          publicationKey(item.id, slot)
        );
        const future = isFutureSlot(item, slot, now);
        return {
          slotId: postOverrideKey(slot),
          publicationKey: publicationKey(item.id, slot),
          time: slot.time ?? item.time,
          at: slot.at,
          timezone: slot.timezone ?? item.timezone,
          date: slot.date,
          day: slot.day,
          kind: slot.kind,
          customised: Boolean(item.postOverrides?.[postOverrideKey(slot)]),
          canEdit: !publication && future,
          status: publication?.status ?? (future ? 'scheduled' : 'not-posted'),
          url: publication?.url,
          publicationActor: publication?.actor,
          publicationAt: publication?.at,
          canPublish:
            manualPosting &&
            !publication &&
            slotsForSeries(item, slot.date).some(
              (current) => postOverrideKey(current) === postOverrideKey(slot)
            ) &&
            (!slot.hourly || hourly),
        };
      };
      const monthSlots = new Map(
        dates
          .flatMap((date) => slotsForSeries(item, date))
          .map((slot) => [postOverrideKey(slot), slot])
      );
      for (const slot of await historySlots(item, requested))
        monthSlots.set(postOverrideKey(slot), slot);
      const calendarRows = (
        await Promise.all([...monthSlots.values()].map(makeRow))
      ).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const drafts = [];
      for (const draft of unscheduledDrafts(item))
        if (!(await publicationStore.read(publicationKey(item.id, draft.slot))))
          drafts.push(draft);
      return {
        id: item.id,
        label: item.label,
        exampleDate: localClock(now, item.timezone).date,
        defaultTemplates: builtInTemplates,
        defaultTitles: builtInTitles,
        defaultHostCredit:
          item.seriesType === 'simple'
            ? await configuredSimpleHostCredit()
            : builtInHostCredit,
        seriesType: item.seriesType,
        frequency: item.frequency,
        schedule: item.schedule,
        scheduleSummary: scheduleSummary(item),
        unscheduledDrafts: drafts,
        weekday: item.weekday,
        previewCount: previewCounts[item.frequency],
        enabled: item.enabled,
        timezone: item.timezone,
        time: item.time,
        sticky: item.sticky,
        templates: {
          signup: item.templates.signup ?? builtInTemplates.signup,
          daily: item.templates.daily ?? builtInTemplates.daily,
          roundup: item.templates.roundup ?? builtInTemplates.roundup,
        },
        templateOverrides: Object.keys(item.templates),
        titles: {
          signup: item.titles.signup ?? builtInTitles.signup,
          daily: item.titles.daily ?? builtInTitles.daily,
          roundup: item.titles.roundup ?? builtInTitles.roundup,
        },
        titleOverrides: Object.keys(item.titles),
        hostCredit:
          item.hostCredit ??
          (item.seriesType === 'simple'
            ? await configuredSimpleHostCredit()
            : builtInHostCredit),
        hostCreditOverride: item.hostCredit !== undefined,
        showHostCredit:
          item.seriesType === 'simple' ? item.showHostCredit === true : true,
        maintainers: item.maintainers.map((member) => ({
          username: member.username,
          through: member.through,
        })),
        hosts,
        additionalHosts: hosts.filter(
          (name) => !eligibleNames.has(name.toLowerCase())
        ),
        hostAssignment:
          Object.hasOwn(item.hosts, requested) || item.hostRoster !== undefined,
        eligibleHosts: eligible.map((member) => member.username),
        days:
          item.seriesType === 'simple'
            ? await Promise.all(
                (
                  await upcomingSimpleSlots(
                    item,
                    now,
                    previewCounts[item.frequency]
                  )
                ).map(makeRow)
              )
            : calendarRows,
        historyDays:
          item.seriesType === 'simple'
            ? calendarRows.filter((row) => row.status !== 'scheduled')
            : [],
      };
    })
  );
  return c.json({
    ...common,
    month: requested,
    username: who.username,
    admin: who.admin,
    manualPostingAllowed: manualPosting,
    hourlyAllowed: hourly,
    subreddit: context.subredditName,
    series,
  });
});

api.get('/dashboard/preview', async (c) => {
  const who = await identity();
  const seriesId = c.req.query('seriesId');
  const date = c.req.query('date');
  const kind = c.req.query('kind');
  if (
    !seriesId ||
    !date ||
    (kind !== 'signup' && kind !== 'daily' && kind !== 'roundup')
  )
    return c.json({ error: 'Choose a valid thread to preview.' }, 400);
  const cfg = await config();
  const series = requireSeries(cfg, seriesId, who);
  const slot = await resolveSlot(
    series,
    date,
    kind,
    c.req.query('slotId'),
    true
  );
  return c.json({
    ...(await preview(series, slot)),
    ...(await postEditor(series, slot)),
    revision: cfg.revision,
  });
});

api.post('/dashboard/action', async (c) => {
  const who = await identity();
  const body = (await c.req.json()) as {
    action?: string;
    revision?: number;
    seriesIds?: unknown;
    seriesId?: unknown;
    timezone?: unknown;
    time?: unknown;
    enabled?: unknown;
    signupSticky?: unknown;
    dailySticky?: unknown;
    roundupSticky?: unknown;
    date?: unknown;
    kind?: unknown;
    confirmed?: unknown;
    label?: unknown;
    seriesType?: unknown;
    frequency?: unknown;
    weekday?: unknown;
    signupTemplate?: unknown;
    dailyTemplate?: unknown;
    roundupTemplate?: unknown;
    signupTitle?: unknown;
    dailyTitle?: unknown;
    roundupTitle?: unknown;
    resetKinds?: unknown;
    resetTitleKinds?: unknown;
    hostCredit?: unknown;
    showHostCredit?: unknown;
    resetHostCredit?: unknown;
    hostMonth?: unknown;
    hostUsernames?: unknown;
    people?: unknown;
    postTitle?: unknown;
    postBody?: unknown;
    slotId?: unknown;
    schedule?: RepeatRule;
    draftKey?: string;
    confirmation?: string;
    deletePosts?: boolean;
    publicationKey?: string;
    postId?: string;
    username?: string;
  };
  if (typeof body.revision !== 'number' || !Number.isInteger(body.revision))
    return c.json(
      { error: 'Refresh the dashboard before changing settings.' },
      400
    );
  const revision = body.revision;
  const action = body.action;
  if (
    action === 'personalDataDeletionPreview' ||
    action === 'personalDataDeletion' ||
    action === 'retryPersonalDataDeletion'
  ) {
    if (action === 'personalDataDeletionPreview') {
      if (typeof body.username !== 'string') throw Error('Enter a Reddit username.');
      return c.json(await personalDataDeletionPreview(who, body.username));
    }
    if (action === 'personalDataDeletion') {
      if (typeof body.username !== 'string') throw Error('Enter a Reddit username.');
      await requestPersonalDataDeletion(who, body.username, body.confirmation ?? '');
    } else await retryPersonalDataDeletion(who);
    return c.json({ ok: true });
  }
  if (
    [
      'deletePostPreview',
      'deletePost',
      'deleteSeries',
      'cancelDeletion',
      'retryDeletion',
    ].includes(action ?? '')
  ) {
    if (typeof body.seriesId !== 'string') throw Error('Choose a series.');
    if (action === 'deleteSeries') {
      if (typeof body.deletePosts !== 'boolean')
        throw Error('Choose whether to delete published posts.');
      await requestSeriesDeletion(
        body.seriesId,
        revision,
        who,
        body.confirmation ?? '',
        body.deletePosts
      );
    } else if (action === 'cancelDeletion' || action === 'retryDeletion') {
      await controlSeriesDeletion(
        body.seriesId,
        revision,
        who,
        action === 'cancelDeletion' ? 'cancel' : 'retry'
      );
    } else {
      if (typeof body.publicationKey !== 'string')
        throw Error('Choose a publication.');
      if (action === 'deletePostPreview')
        return c.json(
          await deletionPreview(body.seriesId, body.publicationKey, who)
        );
      await deleteIndividualPost(
        body.seriesId,
        body.publicationKey,
        who,
        revision,
        body.confirmation ?? '',
        body.postId ?? ''
      );
    }
    return c.json({ ok: true });
  }
  if (action === 'archive' || action === 'unarchive') {
    if (!who.admin)
      return c.json({ error: 'Moderator access is required.' }, 403);
    if (typeof body.seriesId !== 'string' || body.confirmed !== true)
      throw Error('Choose a series and confirm the change.');
    const id = body.seriesId;
    const limit = await configuredSeriesLimit();
    await saveConfig(revision, who, (next) => {
      const series = requireSeries(next, id, who, true);
      if (series.deletion)
        throw Error(
          'Cancel the pending deletion before restoring this series.'
        );
      if (action === 'unarchive' && series.archived)
        checkSeriesCapacity(next, limit);
      if (Boolean(series.archived) === (action === 'archive')) return;
      series.archived = action === 'archive';
      series.enabled = false;
    });
    return c.json({ ok: true });
  }
  if (action === 'schedulePreview' || action === 'scheduleSave') {
    const cfg = await config();
    if (cfg.revision !== revision)
      throw Error('Settings changed. Reopen the schedule editor.');
    if (
      typeof body.seriesId !== 'string' ||
      typeof body.timezone !== 'string' ||
      !body.schedule
    )
      throw Error('Complete the schedule fields.');
    const series = requireSeries(cfg, body.seriesId, who);
    if (series.seriesType !== 'simple')
      throw Error('Choose a simple recurring series.');
    if (body.schedule.unit === 'hours' && !(await hourlyAllowed()))
      throw Error('Hourly schedules are disabled in app settings.');
    const changed = withSchedule(series, body.schedule, body.timezone);
    if (action === 'scheduleSave') {
      if (body.confirmed !== true)
        throw Error('Preview and confirm the new schedule first.');
      await changeSchedule(
        series.id,
        body.schedule,
        body.timezone,
        revision,
        who
      );
      return c.json({ ok: true });
    }
    return c.json({
      summary: scheduleSummary(changed),
      slots: await upcomingSimpleSlots(changed, new Date(), 5),
      displaced: unscheduledDrafts(changed).length,
    });
  }
  if (action === 'discardDraft' || action === 'reassignDraft') {
    if (typeof body.seriesId !== 'string' || typeof body.draftKey !== 'string')
      throw Error('Choose an unscheduled draft.');
    const seriesId = body.seriesId;
    const draftKey = body.draftKey;
    const existing = requireSeries(await config(), seriesId, who);
    const draft = unscheduledDrafts(existing).find(
      (draft) => draft.key === draftKey
    );
    if (
      !draft ||
      (await publicationStore.read(publicationKey(seriesId, draft.slot)))
    )
      throw Error('That draft is no longer available. Refresh the dashboard.');
    let target: Slot | undefined;
    if (action === 'reassignDraft') {
      if (typeof body.date !== 'string')
        throw Error('Choose an upcoming post.');
      target = await resolveSlot(existing, body.date, 'daily', body.slotId);
      if (!isFutureSlot(existing, target)) throw Error('Choose a future post.');
    } else if (body.confirmed !== true)
      throw Error('Confirm discarding this draft.');
    await saveConfig(
      revision,
      who,
      async (next) => {
        const series = requireSeries(next, seriesId, who);
        if (target) {
          const key = postOverrideKey(target);
          if (series.postOverrides?.[key])
            throw Error(
              'The target already has a custom edit. Choose another post.'
            );
          if (await publicationStore.read(publicationKey(seriesId, target)))
            throw Error('The target has already started publishing.');
          series.postOverrides ??= {};
          series.postOverrides[key] = series.postOverrides[draftKey]!;
          series.overrideSlots ??= {};
          series.overrideSlots[key] = target;
        }
        delete series.postOverrides?.[draftKey];
        delete series.overrideSlots?.[draftKey];
      },
      [
        publicationKey(seriesId, draft.slot),
        ...(target ? [publicationKey(seriesId, target)] : []),
      ]
    );
    return c.json({ ok: true });
  }
  if (action === 'postOverride' || action === 'postPreview') {
    const { seriesId, date, kind } = body;
    if (
      typeof seriesId !== 'string' ||
      typeof date !== 'string' ||
      (kind !== 'signup' && kind !== 'daily' && kind !== 'roundup')
    )
      throw new Error('Choose a scheduled date and post type.');
    const cfg = await config();
    const series = requireSeries(cfg, seriesId, who);
    if (cfg.revision !== revision)
      throw new Error('Settings changed. Reopen the preview before editing.');
    const slot = await resolveSlot(series, date, kind, body.slotId);
    if (!(await postEditor(series, slot)).editable)
      throw new Error(
        'Only future posts which have not started publication can be edited.'
      );
    if (
      (body.postTitle != null && typeof body.postTitle !== 'string') ||
      (body.postBody != null && typeof body.postBody !== 'string')
    )
      throw new Error('Enter text for the title and body.');
    const override = {
      ...(typeof body.postTitle === 'string' ? { title: body.postTitle } : {}),
      ...(typeof body.postBody === 'string' ? { body: body.postBody } : {}),
    };
    validatePostOverride(override);
    const content = await preview(
      {
        ...series,
        postOverrides: {
          ...series.postOverrides,
          [postOverrideKey(slot)]: override,
        },
      },
      slot
    );
    if (!content.title.trim() || content.title.length > 300)
      throw new Error('The generated title must contain 1–300 characters.');
    if (action === 'postPreview') return c.json(content);
    await savePostOverride(seriesId, slot, override, revision, who);
    return c.json({ ok: true });
  }
  if (action === 'create') {
    if (!who.admin)
      return c.json({ error: 'Moderator access is required.' }, 403);
    if (
      typeof body.label !== 'string' ||
      typeof body.timezone !== 'string' ||
      typeof body.time !== 'string'
    )
      return c.json({ error: 'Complete the series fields first.' }, 400);
    const series: Series = {
      id: generatedSeriesId(),
      label: body.label.trim(),
      seriesType: body.seriesType === 'simple' ? 'simple' : 'accountability',
      frequency:
        body.seriesType === 'simple' && body.frequency === 'other'
          ? 'other'
          : body.seriesType === 'simple' && body.frequency === 'weekly'
            ? 'weekly'
            : 'daily',
      weekday:
        body.seriesType === 'simple' &&
        body.frequency === 'weekly' &&
        typeof body.weekday === 'number' &&
        Number.isInteger(body.weekday)
          ? body.weekday
          : 1,
      timezone: body.timezone.trim(),
      time: body.time.trim(),
      enabled: false,
      showHostCredit: body.seriesType === 'simple' ? false : true,
      sticky: {
        signup:
          body.seriesType !== 'simple' && validSticky(body.signupSticky)
            ? body.signupSticky
            : 'none',
        daily: validSticky(body.dailySticky) ? body.dailySticky : 'none',
        roundup:
          body.seriesType !== 'simple' && validSticky(body.roundupSticky)
            ? body.roundupSticky
            : 'none',
      },
      templates: {},
      titles: {},
      maintainers: [],
      hosts: {},
    };
    validateSeries(series);
    const seriesLimit = await configuredSeriesLimit();
    await saveConfig(revision, who, (next) => {
      checkSeriesCapacity(next, seriesLimit);
      if (next.series.some((item) => item.id === series.id))
        throw new Error(
          'The generated series ID collided. Try creating it again.'
        );
      next.series.push(series);
    });
    return c.json({ ok: true, createdId: series.id });
  }
  if (action === 'publish') {
    if (!(await manualPostingAllowed()))
      return c.json(
        {
          error: 'Manual posting is disabled in the app installation settings.',
        },
        403
      );
    if (
      typeof body.seriesId !== 'string' ||
      typeof body.date !== 'string' ||
      (body.kind !== 'signup' &&
        body.kind !== 'daily' &&
        body.kind !== 'roundup')
    )
      return c.json({ error: 'Choose a valid thread to publish.' }, 400);
    if (body.confirmed !== true)
      return c.json(
        { error: 'Confirm publication before creating the thread.' },
        400
      );
    const series = requireSeries(await config(), body.seriesId, who);
    const slot = await resolveSlot(series, body.date, body.kind, body.slotId);
    const result = await publish(
      body.seriesId,
      slot,
      who.username,
      false,
      revision
    );
    return c.json({ ok: true, status: result.status, url: result.url });
  }
  if (action === 'templates') {
    const seriesId = body.seriesId;
    if (typeof seriesId !== 'string')
      return c.json({ error: 'Choose a series first.' }, 400);
    const resetKinds = Array.isArray(body.resetKinds)
      ? body.resetKinds.filter(
          (kind): kind is 'signup' | 'daily' | 'roundup' =>
            kind === 'signup' || kind === 'daily' || kind === 'roundup'
        )
      : [];
    const resetTitleKinds = Array.isArray(body.resetTitleKinds)
      ? body.resetTitleKinds.filter(
          (kind): kind is 'signup' | 'daily' | 'roundup' =>
            kind === 'signup' || kind === 'daily' || kind === 'roundup'
        )
      : [];
    await saveConfig(revision, who, (next) => {
      const series = requireSeries(next, seriesId, who);
      for (const kind of resetKinds) delete series.templates[kind];
      for (const kind of resetTitleKinds) delete series.titles[kind];
      if (body.resetHostCredit === true) delete series.hostCredit;
      if (series.seriesType === 'simple' && body.showHostCredit !== undefined) {
        if (typeof body.showHostCredit !== 'boolean')
          throw Error('Choose whether to include a host credit.');
        series.showHostCredit = body.showHostCredit;
      }
      const values = {
        signup: body.signupTemplate,
        daily: body.dailyTemplate,
        roundup: body.roundupTemplate,
      } as const;
      for (const kind of ['signup', 'daily', 'roundup'] as const) {
        const value = values[kind];
        if (typeof value === 'string') {
          series.templates[kind] = value;
        }
      }
      if (typeof body.hostCredit === 'string') {
        series.hostCredit = body.hostCredit;
      }
      const titles = {
        signup: body.signupTitle,
        daily: body.dailyTitle,
        roundup: body.roundupTitle,
      } as const;
      for (const kind of ['signup', 'daily', 'roundup'] as const) {
        const value = titles[kind];
        if (typeof value === 'string') {
          series.titles[kind] = value;
        }
      }
      validateSeries(series);
    });
    return c.json({ ok: true });
  }
  if (action === 'people') {
    if (!who.admin)
      return c.json({ error: 'Moderator access is required.' }, 403);
    if (
      typeof body.seriesId !== 'string' ||
      typeof body.hostMonth !== 'string' ||
      !validMonth(body.hostMonth)
    )
      throw Error('Choose a valid month and series.');
    if (!Array.isArray(body.people) || body.people.length > 20)
      throw Error('Use at most 20 people per series.');
    requireSeries(await config(), body.seriesId, who);
    const seen = new Set<string>();
    const requested = body.people.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw Error('Invalid person.');
      const person = value as Record<string, unknown>;
      if (
        typeof person.username !== 'string' ||
        typeof person.host !== 'boolean' ||
        typeof person.maintainer !== 'boolean' ||
        typeof person.through !== 'string'
      )
        throw Error('Choose a username and roles for each person.');
      const username = person.username
        .trim()
        .replace(/^u\//i, '')
        .toLowerCase();
      if (!/^[a-z0-9_-]{3,20}$/.test(username) || seen.has(username))
        throw Error('Use valid, unique Reddit usernames.');
      seen.add(username);
      if (person.through && !validMonth(person.through))
        throw Error('Choose a valid access expiry month.');
      return {
        username,
        host: person.host,
        maintainer: person.maintainer,
        through: person.through,
      };
    });
    if (requested.filter((person) => person.maintainer).length > 10)
      throw Error('Use at most 10 maintainers per series.');
    const resolved = await Promise.all(
      requested.map(async (person) => ({
        ...person,
        member: (await resolveMembers(person.username, person.through))[0]!,
      }))
    );
    const seriesId = body.seriesId;
    const hostMonth = body.hostMonth;
    await saveConfig(revision, who, (next) => {
      const series = requireSeries(next, seriesId, who);
      // Preserve old month selections that used account IDs before changing access.
      for (const month of Object.keys(series.hosts))
        series.hosts[month] = hostNames(series, month);
      series.maintainers = resolved
        .filter((person) => person.maintainer)
        .map((person) => person.member);
      series.hosts[hostMonth] = resolved
        .filter((person) => person.host)
        .map((person) => person.member.username);
      series.hostRoster = [...series.hosts[hostMonth]];
    });
    return c.json({ ok: true });
  }
  if (action === 'hosts') {
    if (!who.admin)
      return c.json({ error: 'Moderator access is required.' }, 403);
    const seriesId = body.seriesId;
    const hostMonth = body.hostMonth;
    if (
      typeof seriesId !== 'string' ||
      typeof hostMonth !== 'string' ||
      !validMonth(hostMonth)
    )
      return c.json({ error: 'Choose a valid month and series.' }, 400);
    const names = Array.isArray(body.hostUsernames)
      ? body.hostUsernames.filter(
          (name): name is string => typeof name === 'string'
        )
      : [];
    const currentSeries = requireSeries(await config(), seriesId, who);
    const eligible = eligibleHosts(currentSeries, hostMonth);
    const eligibleByName = new Map(
      eligible.map((member) => [member.username.toLowerCase(), member])
    );
    const requestedNames = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    const extraNames = requestedNames.filter(
      (name) => !eligibleByName.has(name.toLowerCase())
    );
    const resolvedExtras = await Promise.all(
      extraNames.map(async (name) => {
        const user = await reddit.getUserByUsername(name);
        if (!user) throw new Error(`Reddit account not found: ${name}`);
        return user.username;
      })
    );
    await saveConfig(revision, who, (next) => {
      const series = requireSeries(next, seriesId, who);
      const selected = new Set(
        requestedNames.map((name) => name.toLowerCase())
      );
      const maintainerNames = eligible
        .filter((member) => selected.has(member.username.toLowerCase()))
        .map((member) => member.username);
      const seen = new Set<string>();
      series.hosts[hostMonth] = [...maintainerNames, ...resolvedExtras].filter(
        (name) => {
          const key = name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }
      );
      series.hostRoster = [...series.hosts[hostMonth]];
    });
    return c.json({ ok: true });
  }
  if (action === 'pause' || action === 'resume') {
    const ids = Array.isArray(body.seriesIds)
      ? body.seriesIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (!ids.length)
      return c.json({ error: 'Select at least one series.' }, 400);
    await saveConfig(revision, who, (next) => {
      for (const id of [...new Set(ids)]) {
        const series = requireSeries(next, id, who);
        if (
          action === 'resume' &&
          series.frequency === 'other' &&
          !series.schedule
        )
          throw Error('Choose a schedule before resuming this series.');
        series.enabled = action === 'resume';
      }
    });
    return c.json({ ok: true });
  }
  if (action !== 'update' || typeof body.seriesId !== 'string')
    return c.json({ error: 'Choose a supported dashboard action.' }, 400);
  const seriesId = body.seriesId;
  await saveConfig(revision, who, (next) => {
    const series = requireSeries(next, seriesId, who);
    if (
      series.seriesType === 'simple' &&
      ((typeof body.timezone === 'string' &&
        body.timezone.trim() !== series.timezone) ||
        (typeof body.time === 'string' && body.time.trim() !== series.time))
    )
      throw Error('Use Change schedule to change posting times.');
    if (typeof body.timezone === 'string')
      series.timezone = body.timezone.trim();
    if (typeof body.time === 'string') series.time = body.time.trim();
    if (typeof body.enabled === 'boolean') series.enabled = body.enabled;
    if (body.label !== undefined) {
      if (!who.admin)
        throw new Error(
          'Moderator access is required to change the display name.'
        );
      if (typeof body.label !== 'string' || !body.label.trim())
        throw new Error('Enter a display name.');
      series.label = body.label.trim();
    }
    if (who.admin) {
      const signupSticky = body.signupSticky ?? series.sticky.signup;
      const dailySticky = body.dailySticky ?? series.sticky.daily;
      const roundupSticky = body.roundupSticky ?? series.sticky.roundup;
      if (
        !validSticky(signupSticky) ||
        !validSticky(dailySticky) ||
        !validSticky(roundupSticky)
      )
        throw new Error('Choose a supported sticky option.');
      series.sticky = {
        signup: signupSticky,
        daily: dailySticky,
        roundup: roundupSticky,
      };
    }
    validateSeries(series);
  });
  return c.json({ ok: true });
});
