import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { validateFlairFormat } from '../tools/flair.ts';
import { redis, context, reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import type { FormField } from '@devvit/shared-types/shared/form.js';
import {
  hostNames,
  localClock,
  parseDate,
  slotsForSeries,
  validMonth,
  validateSeries,
  type Series,
  type Slot,
} from '../core/model.ts';
import {
  allowed,
  config,
  eligibleHosts,
  identity,
  manualPostingAllowed,
  previewCount,
  configuredSeriesLimit,
  checkSeriesCapacity,
  historySlots,
  generatedSeriesId,
  preview,
  publicationKey,
  publicationStore,
  publish,
  requireSeries,
  resolveMembers,
  resolvePublication,
  saveConfig,
  type Identity,
} from '../core/service.ts';

type Values = Record<string, unknown>;
type Session = {
  owner: string;
  stage: string;
  revision: number;
  series: string;
  slot?: Slot;
};
const value = (v: Values, key: string): string =>
  typeof v[key] === 'string' ? v[key] : '';
const choice = (v: Values, key: string): string =>
  Array.isArray(v[key]) && typeof v[key][0] === 'string' ? v[key][0] : '';
const text = (
  name: string,
  label: string,
  defaultValue = '',
  helpText = ''
): FormField => ({ type: 'string', name, label, defaultValue, helpText });
const select = (
  name: string,
  label: string,
  options: { label: string; value: string }[],
  initial?: string
): FormField => ({
  type: 'select',
  name,
  label,
  options,
  required: true,
  defaultValue: initial ? [initial] : [],
});
const stickyOptions = [
  { label: 'Not stickied', value: 'none' },
  { label: 'Sticky slot 1', value: 'slot1' },
  { label: 'Sticky slot 2', value: 'slot2' },
];
const adminOnly = (who: Identity) => {
  if (!who.admin)
    throw new Error(
      'A moderator with Everything permissions must perform this action.'
    );
};
const DASHBOARD_KEY = 'crew:dashboard:v1';

async function form(
  who: Identity,
  stage: string,
  revision: number,
  series: string,
  title: string,
  fields: FormField[],
  description = '',
  slot?: Slot,
  acceptLabel = 'Save'
): Promise<UiResponse> {
  const token = randomUUID();
  const session: Session = {
    owner: who.id,
    stage,
    revision,
    series,
    ...(slot ? { slot } : {}),
  };
  await redis.set('crew:form:' + token, JSON.stringify(session), {
    expiration: new Date(Date.now() + 15 * 60_000),
  });
  return {
    showForm: {
      name: stage,
      form: {
        title,
        description,
        acceptLabel,
        cancelLabel: 'Cancel',
        fields: [
          select(
            'session',
            'Working on',
            [{ label: title, value: token }],
            token
          ),
          ...fields,
        ],
      },
    },
  };
}
async function session(
  v: Values,
  who: Identity,
  stage: string
): Promise<Session> {
  const raw = await redis.get('crew:form:' + choice(v, 'session'));
  if (!raw) throw new Error('This form expired. Open Check-In Crew again.');
  const s = JSON.parse(raw) as Session;
  if (s.owner !== who.id || s.stage !== stage)
    throw new Error('This form does not belong to this account.');
  return s;
}
export const crew = new Hono();
crew.post('/settings/flair-format', async (c) => {
  const { value } = await c.req.json<{ value: unknown }>();
  const error =
    typeof value === 'string'
      ? validateFlairFormat(value)
      : 'Enter a text format.';
  return c.json(error ? { success: false, error } : { success: true });
});
crew.post('/settings/deletion-cooldown', async (c) => {
  const { value } = await c.req.json<{ value: unknown }>();
  const days =
    typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : NaN;
  return c.json({
    success: Number.isInteger(days) && days >= 1 && days <= 30,
    error: 'Choose a whole number from 1 to 30 days.',
  });
});
crew.on(
  'POST',
  ['/settings/preview-count', '/settings/series-limit'],
  async (c) => {
    const { value } = await c.req.json<{ value?: unknown }>();
    return c.json(
      previewCount(value) === undefined
        ? { success: false, error: 'Enter a whole number from 1 to 60.' }
        : { success: true }
    );
  }
);
crew.onError((err, c) => {
  console.error('Check-In Crew:', err.message);
  return c.json<UiResponse>({ showToast: err.message.slice(0, 250) });
});
crew.post('/menu/dashboard', async (c) => {
  const who = await identity();
  const cfg = await config();
  if (!who.admin && !cfg.series.some((series) => allowed(series, who)))
    return c.json<UiResponse>({
      showToast:
        'Ask a moderator to add your Reddit account as a series maintainer.',
    });
  const existing = await redis.get(DASHBOARD_KEY);
  if (existing) {
    try {
      const post = await reddit.getPostById(existing as `t3_${string}`);
      if (
        post.subredditName.toLowerCase() ===
          context.subredditName.toLowerCase() &&
        !post.removed
      ) {
        if (!post.locked) await post.lock();
        return c.json<UiResponse>({ navigateTo: post.url });
      }
    } catch {
      // Recreate the dashboard if the saved post was removed or unavailable.
    }
  }
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: 'Check-In Crew — Community tools & dashboard',
    entry: 'default',
    textFallback: {
      text: 'Check-In Crew publishes community check-ins and recurring posts. Join in by commenting on those threads. Open this post in a current Reddit client for community tools and authorised management access.',
    },
  });
  await post.lock();
  await redis.set(DASHBOARD_KEY, post.id);
  return c.json<UiResponse>({ navigateTo: post.url });
});
crew.post('/menu/open', async (c) => {
  const who = await identity();
  const cfg = await config();
  const visible = cfg.series.filter((s) => allowed(s, who));
  if (!visible.length && !who.admin)
    return c.json<UiResponse>({
      showToast:
        'Ask a moderator to add your Reddit account as a series maintainer.',
    });
  const options = visible.map((s) => ({
    label:
      s.label +
      (s.archived ? ' — Archived' : s.enabled ? ' — Active' : ' — Paused') +
      ' · ' +
      s.time +
      ' ' +
      s.timezone,
    value: s.id,
  }));
  if (!options.length)
    options.push({
      label: 'No series yet — open dashboard',
      value: '__dashboard',
    });
  const monthBySeries = new Map(
    visible.map((s) => [
      s.id,
      localClock(new Date(), s.timezone).date.slice(0, 7),
    ])
  );
  const overview = visible
    .map((s) => {
      const month = monthBySeries.get(s.id) ?? '';
      const hosts = hostNames(s, month);
      const maintainers = s.maintainers.length
        ? s.maintainers.map((m) => 'u/' + m.username).join(', ')
        : 'No maintainers assigned';
      return [
        s.label +
          ': ' +
          (s.archived ? 'ARCHIVED' : s.enabled ? 'ACTIVE' : 'PAUSED'),
        'Maintainers: ' + maintainers,
        'Hosts this month: ' +
          (hosts.length
            ? hosts.map((name) => 'u/' + name).join(', ')
            : 'Volunteer team'),
      ].join('\n');
    })
    .join('\n\n');
  return c.json(
    await form(
      who,
      'choose',
      cfg.revision,
      '',
      'Check-In Crew',
      [
        {
          type: 'paragraph',
          name: 'dashboard',
          label: 'Current setup',
          defaultValue: overview,
          disabled: true,
        },
        select('series', 'Series', options, options[0]?.value),
        select(
          'action',
          'Next step',
          [
            { label: 'Open dashboard', value: 'dashboard' },
            { label: 'View publication history', value: 'history' },
            {
              label: 'Emergency pause selected series',
              value: 'emergencyPause',
            },
            ...(who.admin
              ? [
                  { label: 'Assign volunteer maintainers', value: 'access' },
                  {
                    label: 'Fix a missing publication record',
                    value: 'resolve',
                  },
                ]
              : []),
          ],
          'dashboard'
        ),
      ],
      'Use this hub for access, publication history, recovery and emergency pausing. Open the dashboard for creation, schedules, hosts, templates and posting. Archived series remain available here for history and access management.',
      undefined,
      'Continue'
    )
  );
});
crew.post('/form/choose', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'choose');
  const cfg = await config();
  const id = choice(v, 'series');
  const action = choice(v, 'action');
  if (action === 'dashboard')
    return crew.request('/menu/dashboard', { method: 'POST' });
  if (id === '__new') {
    adminOnly(who);
    return c.json(
      await form(
        who,
        'createType',
        cfg.revision,
        '',
        'Choose a series type',
        [
          select(
            'seriesType',
            'Series type',
            [
              { label: 'Monthly series', value: 'accountability' },
              { label: 'Simple recurring posts', value: 'simple' },
            ],
            'accountability'
          ),
        ],
        'Monthly series: a month-long event with a start post, daily check-ins, and a finish post. Repeats each calendar month. Simple recurring posts: one post template repeated on your chosen daily or weekly schedule.',
        undefined,
        'Continue'
      )
    );
  }
  const s = requireSeries(
    cfg,
    id,
    who,
    ['history', 'access', 'resolve'].includes(action)
  );
  const today = localClock(new Date(), s.timezone).date;
  if (action === 'emergencyPause')
    return c.json(
      await form(
        who,
        'emergencyPause',
        flow.revision,
        id,
        'Pause ' + s.label,
        [
          {
            type: 'boolean',
            name: 'confirmed',
            label: 'Pause automatic posting for this series',
            defaultValue: false,
          },
        ],
        'An already-started publication may finish. Resume later from the dashboard.',
        undefined,
        'Pause series'
      )
    );
  if (action === 'settings')
    return c.json(
      await form(
        who,
        'settings',
        cfg.revision,
        id,
        s.label + ' schedule',
        [
          ...(who.admin
            ? [text('label', 'Name shown in thread titles', s.label)]
            : []),
          text(
            'timezone',
            'Timezone',
            s.timezone,
            'Use a named timezone, such as Europe/London or America/New_York. Daylight saving is handled automatically.'
          ),
          text('time', 'Posting time', s.time, '24-hour time, HH:MM.'),
          ...(who.admin
            ? [
                {
                  type: 'paragraph',
                  name: 'seriesTypeInfo',
                  label: 'Series type',
                  defaultValue:
                    s.seriesType === 'simple'
                      ? `Simple ${s.frequency} schedule. The upcoming window size is set in app settings.`
                      : 'Monthly series',
                  disabled: true,
                } as FormField,
                ...(s.seriesType === 'accountability'
                  ? [
                      select(
                        'signupSticky',
                        'Start post highlighting',
                        stickyOptions,
                        s.sticky.signup
                      ),
                    ]
                  : []),
                select(
                  'dailySticky',
                  s.seriesType === 'simple'
                    ? 'Post highlighting'
                    : 'Daily check-in highlighting',
                  stickyOptions,
                  s.sticky.daily
                ),
                ...(s.seriesType === 'accountability'
                  ? [
                      select(
                        'roundupSticky',
                        'Finish post highlighting',
                        stickyOptions,
                        s.sticky.roundup
                      ),
                    ]
                  : []),
              ]
            : []),
          {
            type: 'boolean',
            name: 'enabled',
            label: 'Enable automatic posting',
            defaultValue: s.enabled,
          } as FormField,
        ],
        'Monthly series have a start post, daily check-ins, and a finish post. Simple recurring posts repeat one post template. Sticky slots are shared across the subreddit. Enabling after today’s posting time publishes today’s missing posts on the next scheduler run.'
      )
    );
  if (action === 'access') {
    adminOnly(who);
    return c.json(
      await form(
        who,
        'access',
        cfg.revision,
        id,
        s.label + ' maintainer access',
        [
          text(
            'names',
            'Reddit usernames',
            s.maintainers.map((m) => m.username).join(', '),
            'Comma-separated. Saving replaces the list. Clear it to revoke all volunteer access.'
          ),
          text(
            'through',
            'Access through month (optional)',
            '',
            'YYYY-MM. Blank means no expiry. Applies to every username in this save.'
          ),
        ],
        s.maintainers
          .map((m) => 'u/' + m.username + ': ' + (m.through || 'no expiry'))
          .join(' · ') ||
          'Only moderators with Everything permissions can assign access.'
      )
    );
  }
  if (action === 'hosts') {
    adminOnly(who);
    return c.json(
      await form(
        who,
        'hostMonth',
        cfg.revision,
        id,
        s.label + ' host month',
        [text('month', 'Month', today.slice(0, 7), 'YYYY-MM')],
        'Choose which assigned maintainers receive host credits this month.',
        undefined,
        'Continue'
      )
    );
  }
  if (action === 'preview')
    return c.json(
      await form(
        who,
        'preview',
        cfg.revision,
        id,
        s.label + ' thread preview',
        [
          text(
            'date',
            'Thread date',
            today,
            'YYYY-MM-DD. Preview any scheduled date. If manual posting is enabled, Post now publishes this dated topic immediately.'
          ),
          select(
            'kind',
            'Thread type',
            s.seriesType === 'simple'
              ? [{ label: 'Scheduled post', value: 'regular' }]
              : [
                  { label: 'Daily / final-day roundup', value: 'regular' },
                  { label: 'Monthly signup (Day 1)', value: 'signup' },
                ],
            'regular'
          ),
        ],
        'Preview uses the standard community prompt and assigned host credits.',
        undefined,
        'Preview'
      )
    );
  if (action === 'history')
    return c.json(
      await form(
        who,
        'history',
        cfg.revision,
        id,
        s.label + ' history',
        [text('month', 'Month', today.slice(0, 7), 'YYYY-MM')],
        '',
        undefined,
        'View history'
      )
    );
  if (action === 'resolve') {
    adminOnly(who);
    return c.json(
      await form(
        who,
        'recoveryMonth',
        cfg.revision,
        id,
        s.label + ' publication recovery',
        [text('month', 'Publication month', today.slice(0, 7), 'YYYY-MM')],
        'Use this when a post exists on Reddit but the dashboard or history still shows its attempt as pending or uncertain. Choose its month, then paste the post link to mark it as posted. If no post was created, you can clear the attempt after checking Reddit.',
        undefined,
        'Find attempts'
      )
    );
  }
  throw new Error('Choose an available action.');
});
async function createDetails(
  who: Identity,
  revision: number,
  type: string,
  frequency = 'daily'
) {
  return form(
    who,
    'create',
    revision,
    type + ':' + frequency,
    type === 'simple' ? 'Create a simple schedule' : 'Create a monthly series',
    [
      text(
        'label',
        'Name shown in thread titles',
        '',
        'For example: Weekend Group.'
      ),
      text('timezone', 'Timezone', 'Europe/London'),
      text('time', 'Posting time', '08:00', '24-hour time, HH:MM.'),
      ...(type === 'simple' && frequency === 'weekly'
        ? [
            select(
              'weekday',
              'Weekly posting day',
              [
                { label: 'Sunday', value: '0' },
                { label: 'Monday', value: '1' },
                { label: 'Tuesday', value: '2' },
                { label: 'Wednesday', value: '3' },
                { label: 'Thursday', value: '4' },
                { label: 'Friday', value: '5' },
                { label: 'Saturday', value: '6' },
              ],
              '1'
            ),
          ]
        : []),
    ],
    type === 'simple'
      ? 'One post template repeated ' +
          frequency +
          (frequency === 'other'
            ? '. Open the dashboard after creation to choose the repeat pattern. New schedules start paused.'
            : '. New schedules start paused.')
      : 'A start post, daily check-ins, and a finish post each calendar month. New series start paused.'
  );
}
crew.post('/form/createType', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'createType');
  const type = choice(v, 'seriesType');
  if (type === 'accountability')
    return c.json(await createDetails(who, flow.revision, type));
  if (type !== 'simple') throw new Error('Choose a series type.');
  return c.json(
    await form(
      who,
      'createTiming',
      flow.revision,
      'simple',
      'Simple recurring posts',
      [
        select(
          'frequency',
          'Repeat',
          [
            {
              label: 'Daily',
              value: 'daily',
            },
            {
              label: 'Weekly',
              value: 'weekly',
            },
            {
              label: 'Other — configure in the dashboard',
              value: 'other',
            },
          ],
          'daily'
        ),
      ],
      'One post template repeated on your chosen schedule.',
      undefined,
      'Continue'
    )
  );
});
crew.post('/form/createTiming', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'createTiming');
  const frequency = choice(v, 'frequency');
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'other')
    throw new Error('Choose a repeat schedule.');
  return c.json(await createDetails(who, flow.revision, 'simple', frequency));
});
crew.post('/form/create', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'create');
  const [seriesType, frequency] = flow.series.split(':');
  if (
    !['accountability', 'simple'].includes(seriesType ?? '') ||
    !['daily', 'weekly', 'other'].includes(frequency ?? '')
  )
    throw new Error('Choose a series type again before creating it.');
  const s: Series = {
    id: generatedSeriesId(),
    label: value(v, 'label').trim(),
    seriesType: seriesType as Series['seriesType'],
    frequency: frequency as Series['frequency'],
    weekday: frequency === 'weekly' ? Number(choice(v, 'weekday') || '1') : 1,
    timezone: value(v, 'timezone').trim(),
    time: value(v, 'time').trim(),
    enabled: false,
    sticky: {
      signup: 'none',
      daily: 'none',
      roundup: 'none',
    },
    templates: {},
    titles: {},
    maintainers: [],
    hosts: {},
  };
  validateSeries(s);
  const seriesLimit = await configuredSeriesLimit();
  await saveConfig(flow.revision, who, (cfg) => {
    checkSeriesCapacity(cfg, seriesLimit);
    if (cfg.series.some((x) => x.id === s.id))
      throw new Error(
        'The generated series ID collided. Try creating it again.'
      );
    cfg.series.push(s);
  });
  return c.json<UiResponse>({
    showToast:
      'Series created and paused. Open Check-In Crew to configure access.',
  });
});
crew.post('/form/settings', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'settings');
  await saveConfig(flow.revision, who, (cfg) => {
    const s = requireSeries(cfg, flow.series, who);
    if (
      s.seriesType === 'simple' &&
      (value(v, 'timezone').trim() !== s.timezone ||
        value(v, 'time').trim() !== s.time)
    )
      throw Error(
        'Use Change schedule in the dashboard to change posting times.'
      );
    s.timezone = value(v, 'timezone').trim();
    s.time = value(v, 'time').trim();
    s.enabled = v.enabled === true;
    if (who.admin) {
      s.label = value(v, 'label').trim();
      s.sticky = {
        signup: (choice(v, 'signupSticky') || s.sticky.signup) as
          'none' | 'slot1' | 'slot2',
        daily: (choice(v, 'dailySticky') || s.sticky.daily) as
          'none' | 'slot1' | 'slot2',
        roundup: (choice(v, 'roundupSticky') || s.sticky.roundup) as
          'none' | 'slot1' | 'slot2',
      };
    }
    validateSeries(s);
  });
  return c.json<UiResponse>({
    showToast:
      v.enabled === true
        ? 'Schedule saved. Automatic posting is enabled.'
        : 'Schedule saved. Automatic posting is paused.',
  });
});
crew.post('/form/access', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'access');
  const through = value(v, 'through').trim();
  if (through && !validMonth(through))
    throw new Error('Use YYYY-MM for the expiry month, or leave it blank.');
  const members = await resolveMembers(value(v, 'names'), through);
  await saveConfig(flow.revision, who, (cfg) => {
    const s = requireSeries(cfg, flow.series, who, true);
    s.maintainers = members;
    for (const month of Object.keys(s.hosts))
      s.hosts[month] = s.hosts[month]!.filter(
        (value) =>
          members.some((m) => m.id === value) || !/^t2_[a-z0-9]+$/i.test(value)
      );
    if (s.hostRoster)
      s.hostRoster = s.hostRoster.filter(
        (value) =>
          members.some((m) => m.id === value) || !/^t2_[a-z0-9]+$/i.test(value)
      );
  });
  return c.json<UiResponse>({
    showToast:
      'Maintainer access updated. Removed accounts lose access immediately.',
  });
});
crew.post('/form/hostMonth', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'hostMonth');
  const month = value(v, 'month').trim();
  if (!validMonth(month)) throw new Error('Use YYYY-MM.');
  const cfg = await config();
  const s = requireSeries(cfg, flow.series, who);
  const members = eligibleHosts(s, month);
  if (!members.length)
    throw new Error('Assign maintainers with access for that month first.');
  return c.json(
    await form(
      who,
      'hosts',
      cfg.revision,
      s.id,
      s.label + ' hosts for ' + month,
      [
        {
          type: 'select',
          name: 'hosts',
          label: 'Credited hosts',
          options: members.map((m) => ({
            label: 'u/' + m.username,
            value: m.id,
          })),
          multiSelect: true,
          defaultValue: s.hosts[month] ?? members.map((m) => m.id),
        },
      ],
      'When no monthly choice is saved, all active maintainers are credited. An empty selection uses a generic volunteer-team credit.',
      { date: month + '-01', month, day: 1, kind: 'signup' }
    )
  );
});
crew.post('/form/hosts', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'hosts');
  const month = flow.slot!.month;
  const selected = Array.isArray(v.hosts)
    ? v.hosts.filter((id): id is string => typeof id === 'string')
    : [];
  await saveConfig(flow.revision, who, (cfg) => {
    const s = requireSeries(cfg, flow.series, who);
    const eligible = eligibleHosts(s, month);
    if (selected.some((id) => !eligible.some((m) => m.id === id)))
      throw new Error('A selected host no longer has access for that month.');
    s.hosts[month] = [...new Set(selected)];
    const selectedNames = s.hosts[month].map(
      (id) => eligible.find((member) => member.id === id)?.username ?? id
    );
    const existingExtras = (s.hostRoster ?? []).filter(
      (name) =>
        !eligible.some(
          (member) => member.username.toLowerCase() === name.toLowerCase()
        )
    );
    s.hostRoster = [...selectedNames, ...existingExtras];
  });
  return c.json<UiResponse>({
    showToast:
      'Monthly host credits saved. Already-published posts keep their original credits.',
  });
});
function chosenSlot(v: Values, series: Series): Slot {
  const date = value(v, 'date').trim();
  if (series.seriesType === 'simple') {
    const slot = slotsForSeries(series, date)[0];
    if (!slot)
      throw new Error(
        series.frequency === 'weekly'
          ? 'Choose the configured weekly posting day.'
          : 'Choose a valid posting date.'
      );
    return slot;
  }
  const slot = parseDate(date);
  if (choice(v, 'kind') === 'signup') {
    if (slot.day !== 1)
      throw new Error('Monthly signup uses the first day of the month.');
    slot.kind = 'signup';
  } else if (choice(v, 'kind') !== 'regular')
    throw new Error('Choose a thread type.');
  return slot;
}
crew.post('/form/preview', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'preview');
  const cfg = await config();
  const s = requireSeries(cfg, flow.series, who);
  const slot = chosenSlot(v, s);
  const content = await preview(s, slot);
  const canPublishNow =
    (await manualPostingAllowed()) &&
    !(await publicationStore.read(publicationKey(s.id, slot)));
  return c.json(
    await form(
      who,
      'publish',
      cfg.revision,
      s.id,
      s.label + ' — review thread',
      [
        {
          type: 'paragraph',
          name: 'title',
          label: 'Title preview',
          defaultValue: content.title,
          disabled: true,
        },
        {
          type: 'paragraph',
          name: 'body',
          label: 'Post preview',
          defaultValue: content.text,
          disabled: true,
        },
        ...(canPublishNow
          ? [
              {
                type: 'boolean' as const,
                name: 'confirmed',
                label: 'Post this dated topic now from the app account',
                defaultValue: false,
              },
            ]
          : []),
      ],
      canPublishNow
        ? 'Publishes a normal Reddit text post in r/' +
            context.subredditName +
            ', even if paused. It keeps the selected date (' +
            slot.date +
            ') and marks this topic as posted; the scheduler will not post it again.'
        : 'Preview only. Manual posting is disabled or publication has already started for this topic.',
      slot,
      canPublishNow ? 'Post now' : 'Close'
    )
  );
});
crew.post('/form/publish', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'publish');
  const cfg = await config();
  const s = requireSeries(cfg, flow.series, who);
  if (!flow.slot)
    return c.json<UiResponse>({
      showToast: 'Preview closed. No post was published.',
    });
  if (v.confirmed !== true)
    throw new Error('Tick the publication confirmation to publish.');
  if (!(await manualPostingAllowed()))
    throw new Error(
      'Manual posting is disabled in the app installation settings.'
    );
  if (cfg.revision !== flow.revision)
    throw new Error(
      'Settings or host credits changed. Preview the thread again.'
    );
  const result = await publish(
    s.id,
    flow.slot,
    who.username,
    false,
    flow.revision
  );
  return c.json<UiResponse>(
    result.status === 'posted' && result.url
      ? { navigateTo: result.url }
      : {
          showToast:
            'Publication is pending or uncertain. Check history; ask a moderator to resolve it before retrying.',
        }
  );
});
crew.post('/form/history', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'history');
  const cfg = await config();
  const s = requireSeries(cfg, flow.series, who, true);
  const month = value(v, 'month').trim();
  if (!validMonth(month)) throw new Error('Use YYYY-MM.');
  const index = await redis.hGetAll('crew:history:' + s.id + ':' + month);
  const entries = await Promise.all(
    Object.keys(index)
      .sort()
      .map(async (key) => {
        const p = await publicationStore.read(key);
        return (
          (index[key]!.startsWith('{')
            ? (() => {
                const slot = JSON.parse(index[key]!) as Slot;
                return `${slot.kind} ${slot.date} ${slot.time ?? ''} ${slot.timezone ?? ''}`;
              })()
            : index[key]) +
          ': ' +
          (p?.status ?? 'ready to retry') +
          (p?.url ? '\n' + p.url : '') +
          (p ? '\n' + p.at + ' · ' + p.actor : '')
        );
      })
  );
  return c.json(
    await form(
      who,
      'close',
      cfg.revision,
      s.id,
      s.label + ' — ' + month,
      [
        {
          type: 'paragraph',
          name: 'history',
          label: 'Publication history',
          defaultValue:
            entries.join('\n\n') || 'No publication attempts this month.',
          disabled: true,
        },
      ],
      'Pending/uncertain entries need a moderator to check whether Reddit accepted the post.',
      undefined,
      'Close'
    )
  );
});
crew.post('/form/close', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'close');
  requireSeries(await config(), flow.series, who, true);
  return c.json<UiResponse>({ showToast: 'Closed.' });
});
crew.post('/form/emergencyPause', async (c) => {
  const who = await identity();
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'emergencyPause');
  if (v.confirmed !== true) throw Error('Confirm pausing the selected series.');
  await saveConfig(flow.revision, who, (cfg) => {
    requireSeries(cfg, flow.series, who).enabled = false;
  });
  return c.json<UiResponse>({
    showToast:
      'Automatic posting paused. Resume from the dashboard when ready.',
  });
});
crew.post('/form/recoveryMonth', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'recoveryMonth');
  const cfg = await config();
  const s = requireSeries(cfg, flow.series, who, true);
  const month = value(v, 'month').trim();
  if (!validMonth(month)) throw Error('Use YYYY-MM.');
  const options = [];
  for (const slot of await historySlots(s, month)) {
    const key = publicationKey(s.id, slot);
    const record = await publicationStore.read(key);
    if (record && ['pending', 'uncertain'].includes(record.status))
      options.push({
        value: key,
        label: `${slot.date} ${slot.time ?? s.time} ${slot.timezone ?? s.timezone} · ${slot.kind} · ${record.status}`,
      });
  }
  if (!options.length)
    return c.json<UiResponse>({
      showToast: 'No pending or uncertain attempts in this month.',
    });
  return c.json(
    await form(
      who,
      'resolve',
      cfg.revision,
      s.id,
      s.label + ' publication recovery',
      [
        select('occurrence', 'Publication attempt', options, options[0]!.value),
        select(
          'resolution',
          'What did you find on Reddit?',
          [
            {
              label: 'The post exists — link it to the app record',
              value: 'link',
            },
            {
              label: 'I checked; no post was created — clear the attempt',
              value: 'clear',
            },
          ],
          'link'
        ),
        text(
          'postLink',
          'Reddit post link',
          '',
          'Paste the post URL, such as https://www.reddit.com/r/yourcommunity/comments/abc123/title/. Only leave blank when choosing to clear an attempt with no post.'
        ),
        {
          type: 'boolean',
          name: 'checked',
          label: 'I checked the community for an existing thread',
          defaultValue: false,
        },
      ],
      'For a Reddit post missing from the app’s publication record: paste its link to mark this attempt as posted without posting again. Wait at least ten minutes after the attempt. Clearing an attempt does not publish a retry; archived series must be restored before retrying.',
      parseDate(month + '-01'),
      'Resolve attempt'
    )
  );
});
crew.post('/form/resolve', async (c) => {
  const who = await identity();
  adminOnly(who);
  const v = await c.req.json<Values>();
  const flow = await session(v, who, 'resolve');
  const cfg = await config();
  const s = requireSeries(cfg, flow.series, who, true);
  if (!flow.slot) throw Error('Choose a publication month first.');
  const slot = (await historySlots(s, flow.slot.month)).find(
    (candidate) => publicationKey(s.id, candidate) === choice(v, 'occurrence')
  );
  if (!slot)
    throw Error('Choose an existing publication attempt for this series.');
  if (v.checked !== true)
    throw new Error('Check the community and tick the confirmation first.');
  const key = publicationKey(s.id, slot);
  const record = await publicationStore.read(key);
  if (!record || !['pending', 'uncertain'].includes(record.status))
    throw new Error('There is no uncertain or pending attempt to resolve.');
  if (Date.now() - Date.parse(record.at) < 10 * 60_000)
    throw new Error('Wait 10 minutes after the attempt before resolving it.');
  const resolution = choice(v, 'resolution');
  const postLink = value(v, 'postLink').trim();
  if (resolution === 'link') {
    let postId: string;
    try {
      const url = new URL(postLink);
      const host = url.hostname.toLowerCase();
      const match =
        host === 'redd.it'
          ? /^\/([a-z0-9]+)\/?$/i.exec(url.pathname)
          : [
                'reddit.com',
                'www.reddit.com',
                'old.reddit.com',
                'new.reddit.com',
                'm.reddit.com',
              ].includes(host)
            ? /^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i.exec(
                url.pathname
              )
            : null;
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !match ||
        url.username ||
        url.password
      )
        throw Error('Invalid link');
      postId = 't3_' + match[1]!.toLowerCase();
    } catch {
      throw new Error(
        'Paste the Reddit post link containing /comments/, or a redd.it post link. For a shared /s/ link, open the post in a browser and copy its address.'
      );
    }
    const post = await reddit.getPostById(postId as `t3_${string}`);
    const content = await preview(s, slot);
    if (
      post.subredditName.toLowerCase() !==
        context.subredditName.toLowerCase() ||
      post.title !== content.title ||
      post.authorName.toLowerCase() !== 'check-in-crew'
    )
      throw new Error(
        'That post does not match this app, series, date and community.'
      );
    await resolvePublication(
      key,
      record,
      { ...record, status: 'posted', postId: post.id, url: post.url },
      who
    );
  } else if (resolution === 'clear') {
    if (postLink)
      throw new Error(
        'To link this post, choose “The post exists”. Clear an attempt only when no post was created, leaving the link blank.'
      );
    await resolvePublication(key, record, undefined, who);
  } else {
    throw new Error('Choose whether the post exists or no post was created.');
  }
  return c.json<UiResponse>({
    showToast:
      resolution === 'link'
        ? 'Post linked. The app’s publication record now shows it as posted.'
        : 'Attempt cleared. The thread can now be retried.',
  });
});
