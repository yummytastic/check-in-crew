import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  defaults,
  localClock,
  dueSlots,
  postOverrideKey,
  type Config,
} from '../core/model.ts';

const records = new Map<string, string>();
const ctx = { userId: 't2_admin', subredditName: 'loseit_test' };
let banned = false;
let failIdentity = false;
const missingAccounts = new Set<string>();
let manualSetting: boolean | string = true;
const installationSettings = new Map<string, unknown>();
let sent = 0;
const submitted: { title: string; text: string }[] = [];
let beforeExec: (() => void) | undefined;
const stickyPositions: number[] = [];
let removed = 0;
let deleted = 0;
let failDelete = false;
let failDeleteId = '';
let failEdit = false;
let fakePost = {
  id: 't3_trigger',
  authorName: 'AutoModerator',
  subredditName: 'loseit_test',
  title: '[check-in-crew:eu]',
  body: '',
  createdAt: new Date(),
  async remove() {
    removed++;
  },
  async delete() {
    if (failDelete || this.id === failDeleteId)
      throw Error('Reddit deletion failed');
    deleted++;
  },
  async edit({ text }: { text: string }) {
    if (failEdit) throw Error('Reddit editing failed');
    this.body = text;
  },
};
const fakePosts = new Map<string, typeof fakePost>();
const user = (id: string) => ({
  id,
  username: id.slice(3),
  async getModPermissionsForSubreddit() {
    return id === 't2_admin' ? ['all'] : [];
  },
});
const fakeRedis = {
  async get(key: string) {
    return records.get(key);
  },
  async set(key: string, value: string, options?: { nx?: boolean }) {
    if (options?.nx && records.has(key)) return '';
    records.set(key, value);
    return 'OK';
  },
  async del(key: string) {
    records.delete(key);
  },
  async hSet(key: string, fields: Record<string, string>) {
    const hash = JSON.parse(records.get(key) ?? '{}') as Record<string, string>;
    records.set(key, JSON.stringify({ ...hash, ...fields }));
    return Object.keys(fields).length;
  },
  async hGetAll(key: string) {
    return JSON.parse(records.get(key) ?? '{}') as Record<string, string>;
  },
  async hDel(key: string, fields: string[]) {
    const hash = JSON.parse(records.get(key) ?? '{}') as Record<string, string>;
    for (const field of fields) delete hash[field];
    records.set(key, JSON.stringify(hash));
    return fields.length;
  },
  async watch(...keys: string[]) {
    const before = keys.map((key) => records.get(key));
    const tasks: (() => Promise<unknown>)[] = [];
    return {
      async multi() {},
      async unwatch() {},
      async set(k: string, v: string) {
        tasks.push(() => fakeRedis.set(k, v));
      },
      async hSet(k: string, fields: Record<string, string>) {
        tasks.push(() => fakeRedis.hSet(k, fields));
      },
      async hDel(k: string, fields: string[]) {
        tasks.push(() => fakeRedis.hDel(k, fields));
      },
      async del(k: string) {
        tasks.push(() => fakeRedis.del(k));
      },
      async exec() {
        const hook = beforeExec;
        beforeExec = undefined;
        hook?.();
        if (keys.some((key, index) => records.get(key) !== before[index]))
          return [];
        return Promise.all(tasks.map((task) => task()));
      },
    };
  },
};
mock.module('@devvit/web/server', {
  namedExports: {
    context: ctx,
    redis: fakeRedis,
    settings: {
      async get(key: string) {
        if (installationSettings.has(key)) return installationSettings.get(key);
        return manualSetting;
      },
    },
    reddit: {
      async getCurrentUser() {
        if (failIdentity) throw Error('Reddit temporarily unavailable');
        return user(ctx.userId);
      },
      getModerators() {
        return {
          async all() {
            return ctx.userId === 't2_admin' ? [user(ctx.userId)] : [];
          },
        };
      },
      getBannedUsers() {
        return {
          async all() {
            return banned ? [user(ctx.userId)] : [];
          },
        };
      },
      async getUserByUsername(name: string) {
        return user('t2_' + name);
      },
      async getUserById(id: string) {
        return missingAccounts.has(id) ? undefined : user(id);
      },
      async getSubredditByName() {
        return {
          userFlairsEnabled: true,
          usersCanAssignUserFlairs: true,
        };
      },
      async submitPost(content: { title: string; text: string }) {
        sent++;
        submitted.push(content);
        return {
          id: 't3_post',
          url: 'https://www.reddit.com/r/loseit_test/comments/post',
          async sticky(position: number) {
            stickyPositions.push(position);
          },
        };
      },
      async getPostById(id: string) {
        return fakePosts.get(id) ?? fakePost;
      },
    },
  },
});
const { crew } = await import('./crew.ts');
const { automation } = await import('./automation.ts');
const { processSeriesDeletions, deletionSettings } =
  await import('../core/deletion.ts');
const { processPersonalDataDeletion } = await import('../core/privacy.ts');
const { checkTrackedAccounts } = await import('../core/account-cleanup.ts');
const { api } = await import('./api.ts');
const {
  publish,
  config,
  preview,
  publicationStore,
  upcomingSimpleSlots,
  configuredPreviewCounts,
  configuredSeriesLimit,
} = await import('../core/service.ts');
const { parseDate } = await import('../core/model.ts');
async function dashboardAction(body: Record<string, unknown>) {
  const response = await api.request('/dashboard/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}
type Reply = {
  showToast?: string;
  navigateTo?: string;
  showForm?: {
    name: string;
    form: {
      description?: string;
      fields: {
        name: string;
        defaultValue?: unknown;
        options?: { label: string; value: string }[];
      }[];
    };
  };
};
async function request(path: string, values = {}): Promise<Reply> {
  const response = await crew.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  return (await response.json()) as Reply;
}
function fields(reply: Reply): Record<string, unknown> {
  assert.ok(reply.showForm, JSON.stringify(reply));
  return Object.fromEntries(
    reply.showForm.form.fields.map((f) => [f.name, f.defaultValue])
  );
}
function reset(): Config {
  records.clear();
  ctx.userId = 't2_admin';
  banned = false;
  failIdentity = false;
  missingAccounts.clear();
  manualSetting = true;
  installationSettings.clear();
  installationSettings.set('enableCommunityCalculator', false);
  installationSettings.set('allowMaintainerDeletion', false);
  sent = 0;
  submitted.length = 0;
  beforeExec = undefined;
  stickyPositions.length = 0;
  removed = 0;
  deleted = 0;
  failDelete = false;
  failDeleteId = '';
  failEdit = false;
  fakePosts.clear();
  const cfg = defaults();
  cfg.series[0]!.maintainers = [
    { id: 't2_volunteer', username: 'volunteer', through: '' },
  ];
  records.set('crew:config:v1', JSON.stringify(cfg));
  fakePost = {
    ...fakePost,
    id: 't3_trigger',
    authorName: 'AutoModerator',
    subredditName: 'loseit_test',
    title: '[check-in-crew:eu]',
    body: '',
    createdAt: new Date(),
  };
  return cfg;
}
async function openAction(action: string, series = 'eu') {
  const menu = await request('/menu/open');
  return request('/form/choose', {
    ...fields(menu),
    series: [series],
    action: [action],
  });
}
void test('post and comment calculator menu reviews adult values and suppresses teen hints', async () => {
  reset();
  installationSettings.set('enableCommunityCalculator', true);
  fakePost.body = 'I am 170 cm and weigh 75 kg.';
  const menu = await request('/menu/bmi', { location: 'post', targetId: 't3_trigger' });
  assert.equal(menu.showForm?.name, 'bmiUnits');
  const inputs = await request('/form/bmiUnits', fields(menu));
  assert.equal(inputs.showForm?.name, 'bmiInputs');
  const result = await request('/form/bmiInputs', fields(inputs));
  assert.equal(result.showForm?.name, 'bmiResult');
  assert.match(result.showForm?.form.description ?? '', /Estimated BMI: 26/);

  fakePost.body = '';
  const low = await request('/menu/bmi', { location: 'post', targetId: 't3_trigger' });
  const lowInputs = await request('/form/bmiUnits', fields(low));
  const lowResult = await request('/form/bmiInputs', {
    ...fields(lowInputs),
    heightCm: '170',
    weightKg: String(18.45 * 1.7 ** 2),
  });
  assert.match(lowResult.showForm?.form.description ?? '', /Rounded up from 18\.450/);

  fakePost.body = '16/f, 170 cm, 60 kg';
  const teen = await request('/menu/bmi', { location: 'post', targetId: 't3_trigger' });
  assert.match(teen.showForm?.form.fields.find((field) => field.name === 'session')?.name ?? '', /session/);
  const teenInputs = await request('/form/bmiUnits', fields(teen));
  assert.equal(
    teenInputs.showForm?.form.fields
      .filter((field) => /^(height|weight)(Cm|Feet|Inches|Kg|Lb|Stone|Pounds)$/.test(field.name))
      .some((field) => field.defaultValue !== undefined),
    false
  );
});
void test('post calculator can be limited to moderators', async () => {
  reset();
  installationSettings.set('enableCommunityCalculator', true);
  installationSettings.set('communityCalculatorModeratorsOnly', true);
  ctx.userId = 't2_member';
  const denied = await request('/menu/bmi', { location: 'post', targetId: 't3_trigger' });
  assert.match(denied.showToast ?? '', /limited to moderators/);

  ctx.userId = 't2_admin';
  const allowed = await request('/menu/bmi', { location: 'post', targetId: 't3_trigger' });
  assert.equal(allowed.showForm?.name, 'bmiUnits');
});
void test('automatic account checks remove active access without historic deletion', async () => {
  reset();
  missingAccounts.add('t2_volunteer');
  fakePost.body = 'Thanks u/volunteer for hosting.';
  const start = new Date('2026-09-01T00:00:00Z');
  await checkTrackedAccounts(start);
  assert.equal(JSON.parse(JSON.parse(records.get('crew:account-status:v1')!).volunteer).checks, 1);
  await checkTrackedAccounts(new Date('2026-09-01T12:00:00Z'));
  assert.equal(JSON.parse(JSON.parse(records.get('crew:account-status:v1')!).volunteer).checks, 2);
  await checkTrackedAccounts(new Date('2026-09-02T00:00:00Z'));
  assert.equal(
    Object.keys(JSON.parse(records.get('crew:account-status:v1') ?? '{}')).length,
    0
  );
  assert.equal(records.has('crew:privacy-deletion'), false);
  const updated = JSON.parse(records.get('crew:config:v1')!) as Config;
  assert.equal(updated.series[0]!.maintainers.some((member) => member.username === 'volunteer'), false);
  assert.equal(fakePost.body, 'Thanks u/volunteer for hosting.');
});
void test('server form and automation integration', async (t) => {
  await t.test('personal-data deletion removes identity records and redacts recorded host credits', async () => {
    const cfg = reset();
    const series = cfg.series[0]!;
    series.hostRoster = ['volunteer'];
    series.hosts['2026-09'] = ['volunteer'];
    series.postOverrides = {
      '2026-09-01:daily': { body: 'Thanks u/volunteer for hosting.' },
    };
    records.set('crew:config:v1', JSON.stringify(cfg));
    await fakeRedis.hSet('crew:audit', {
      '0': JSON.stringify({ by: 'volunteer', series: [series] }),
    });
    const key = 'crew:post:eu:2026-09-01:daily';
    await fakeRedis.hSet('crew:history:eu:2026-09', {
      [key]: JSON.stringify({ date: '2026-09-01' }),
    });
    records.set(
      key,
      JSON.stringify({
        status: 'posted',
        at: new Date().toISOString(),
        actor: 'volunteer',
        postId: 't3_privacy',
      })
    );
    fakePost = {
      ...fakePost,
      id: 't3_privacy',
      authorName: 'check-in-crew',
      body: 'Hosted by u/volunteer and u/another.',
    };
    fakePosts.set('t3_privacy', fakePost);
    const impact = await dashboardAction({
      action: 'personalDataDeletionPreview',
      revision: cfg.revision,
      username: 'u/volunteer',
    });
    assert.equal(impact.status, 200);
    assert.equal(impact.data.postCount, 1);
    const response = await dashboardAction({
      action: 'personalDataDeletion',
      revision: cfg.revision,
      username: 'u/volunteer',
      confirmation: 'DELETE',
    });
    assert.equal(response.status, 200);
    for (let tick = 0; tick < 20; tick++) await processPersonalDataDeletion();
    failEdit = true;
    await processPersonalDataDeletion();
    assert.equal(
      (JSON.parse(records.get('crew:privacy-deletion') ?? '{}') as { state?: string }).state,
      'failed'
    );
    failEdit = false;
    const retry = await dashboardAction({
      action: 'retryPersonalDataDeletion',
      revision: (await config()).revision,
    });
    assert.equal(retry.status, 200);
    await processPersonalDataDeletion();
    assert.equal(records.has('crew:privacy-deletion'), false);
    const saved = await config();
    assert.deepEqual(saved.series[0]!.maintainers, []);
    assert.deepEqual(saved.series[0]!.hosts['2026-09'], []);
    assert.deepEqual(saved.series[0]!.hostRoster, []);
    assert.equal(saved.series[0]!.postOverrides?.['2026-09-01:daily']?.body, 'Thanks [deleted] for hosting.');
    assert.equal((await publicationStore.read(key))?.actor, '[deleted]');
    assert.equal(fakePost.body, 'Hosted by [deleted] and u/another.');
    assert.equal(records.get('crew:audit')?.includes('volunteer'), false);
  });
  await t.test(
    'people panel saves independent roles and host order, preserving historic selections',
    async () => {
      const cfg = reset();
      cfg.series[0]!.hosts['2026-08'] = ['t2_volunteer'];
      records.set('crew:config:v1', JSON.stringify(cfg));
      const result = await dashboardAction({
        action: 'people',
        revision: cfg.revision,
        seriesId: 'eu',
        hostMonth: '2026-09',
        people: [
          {
            username: 'u/hostonly',
            host: true,
            maintainer: false,
            through: '',
          },
          { username: 'volunteer', host: true, maintainer: false, through: '' },
          {
            username: 'bothroles',
            host: true,
            maintainer: true,
            through: '2026-10',
          },
          { username: 'manager', host: false, maintainer: true, through: '' },
        ],
      });
      assert.equal(result.status, 200);
      const saved = (await config()).series[0]!;
      assert.deepEqual(saved.hosts['2026-08'], ['volunteer']);
      assert.deepEqual(saved.hostRoster, [
        'hostonly',
        'volunteer',
        'bothroles',
      ]);
      assert.deepEqual(saved.hosts['2026-09'], saved.hostRoster);
      assert.deepEqual(saved.maintainers, [
        { id: 't2_bothroles', username: 'bothroles', through: '2026-10' },
        { id: 't2_manager', username: 'manager', through: '' },
      ]);
      const content = await preview(saved, parseDate('2026-11-01'));
      assert.ok(
        content.text.includes('u/hostonly and u/volunteer and u/bothroles')
      );
      assert.ok(!content.text.includes('u/manager'));
    }
  );
  await t.test(
    'people panel blocks volunteer grants, duplicate names and stale writes',
    async () => {
      const cfg = reset();
      const body = {
        action: 'people',
        revision: cfg.revision,
        seriesId: 'eu',
        hostMonth: '2026-09',
        people: [
          { username: 'newperson', host: false, maintainer: true, through: '' },
        ],
      };
      ctx.userId = 't2_volunteer';
      assert.equal((await dashboardAction(body)).status, 403);
      ctx.userId = 't2_admin';
      assert.equal(
        (
          await dashboardAction({
            ...body,
            people: [
              ...body.people,
              { ...body.people[0], username: 'NEWPERSON' },
            ],
          })
        ).status,
        400
      );
      assert.equal(
        (await dashboardAction({ ...body, revision: cfg.revision + 1 })).status,
        400
      );
      assert.deepEqual(
        (await config()).series[0]!.maintainers,
        cfg.series[0]!.maintainers
      );
      assert.equal(
        (
          await dashboardAction({
            ...body,
            people: [{ ...body.people[0], through: 'bad-month' }],
          })
        ).status,
        400
      );
      assert.equal(
        (await dashboardAction({ ...body, people: [] })).status,
        200
      );
      const cleared = (await config()).series[0]!;
      assert.deepEqual(cleared.maintainers, []);
      assert.deepEqual(cleared.hostRoster, []);
    }
  );
  await t.test(
    'public options and access checks reveal no management data or account names',
    async () => {
      reset();
      installationSettings.set('enableCommunityCalculator', false);
      const read = async (path: string) => {
        const res = await api.request(path);
        return { status: res.status, data: await res.json() };
      };
      ctx.userId = '';
      assert.deepEqual((await read('/public')).data, {
        calculatorEnabled: false,
        flairEnabled: true,
        community: 'loseit_test',
      });
      installationSettings.set('enableCommunityCalculator', true);
      assert.deepEqual((await read('/public')).data, {
        calculatorEnabled: true,
        flairEnabled: true,
        community: 'loseit_test',
      });
      assert.deepEqual((await read('/access')).data, { access: 'signed-out' });
      assert.equal((await read('/dashboard')).status, 400);
      ctx.userId = 't2_stranger';
      assert.deepEqual((await read('/access')).data, { access: 'unassigned' });
      assert.equal((await read('/dashboard')).status, 403);
      assert.equal(
        (
          await dashboardAction({
            action: 'pause',
            revision: 0,
            seriesIds: ['eu'],
          })
        ).status,
        400
      );
      ctx.userId = 't2_volunteer';
      assert.deepEqual((await read('/access')).data, { access: 'authorised' });
      banned = true;
      assert.deepEqual((await read('/access')).data, { access: 'unassigned' });
      banned = false;
      failIdentity = true;
      assert.deepEqual(await read('/access'), {
        status: 503,
        data: {
          access: 'failed',
          error: 'Could not check access. Please retry.',
        },
      });
      failIdentity = false;
      ctx.userId = 't2_admin';
      assert.deepEqual((await read('/access')).data, { access: 'authorised' });
      ctx.userId = 't2_volunteer';
      const cfg = await config();
      cfg.series[0]!.maintainers = [];
      records.set('crew:config:v1', JSON.stringify(cfg));
      assert.deepEqual((await read('/access')).data, { access: 'unassigned' });
    }
  );
  async function seedDeletion() {
    const cfg = reset();
    const slot = { ...parseDate('2026-09-14'), kind: 'daily' as const };
    const key = 'crew:post:eu:' + postOverrideKey(slot);
    cfg.series[0]!.postOverrides = {
      [postOverrideKey(slot)]: { body: 'Remove this saved text' },
    };
    records.set('crew:config:v1', JSON.stringify(cfg));
    records.set(
      key,
      JSON.stringify({
        status: 'posted',
        at: '2026-09-14T08:00:00Z',
        actor: 'volunteer',
        postId: 't3_abc123',
        url: 'https://redd.it/abc123',
      })
    );
    await fakeRedis.hSet('crew:history:eu:2026-09', {
      [key]: JSON.stringify(slot),
    });
    await fakeRedis.hSet('crew:audit', {
      old: JSON.stringify({ by: 'admin', series: cfg.series }),
    });
    fakePost = {
      ...fakePost,
      id: 't3_abc123',
      authorName: 'check-in-crew',
      title: 'A published title',
    };
    return { cfg, key, slot };
  }
  await t.test(
    'individual deletion requires typed confirmation, current scope and setting; purges saved copies and prevents reposting',
    async () => {
      const { key, slot } = await seedDeletion();
      const requestDelete = async (extra = {}) =>
        dashboardAction({
          action: 'deletePost',
          seriesId: 'eu',
          revision: (await config()).revision,
          publicationKey: key,
          postId: 't3_abc123',
          confirmation: 'DELETE',
          ...extra,
        });
      ctx.userId = 't2_volunteer';
      assert.equal((await requestDelete()).status, 400);
      installationSettings.set('allowMaintainerDeletion', true);
      assert.equal(
        (await requestDelete({ confirmation: 'delete' })).status,
        400
      );
      assert.equal((await requestDelete({ seriesId: 'us' })).status, 400);
      assert.equal((await requestDelete({ postId: 't3_wrong' })).status, 400);
      assert.equal(deleted, 0);
      const preview = await dashboardAction({
        action: 'deletePostPreview',
        seriesId: 'eu',
        revision: (await config()).revision,
        publicationKey: key,
      });
      assert.equal(preview.data.title, 'A published title');
      installationSettings.set('allowMaintainerDeletion', false);
      assert.equal((await requestDelete()).status, 400);
      ctx.userId = 't2_admin';
      assert.equal((await requestDelete()).status, 200);
      assert.equal(deleted, 1);
      const saved = JSON.parse(records.get(key)!);
      assert.equal(saved.status, 'deleted');
      assert.equal(saved.actor, '');
      assert.equal(saved.url, undefined);
      assert.equal(
        (await config()).series[0]!.postOverrides?.[postOverrideKey(slot)],
        undefined
      );
      assert.ok(!records.get('crew:audit')!.includes('Remove this saved text'));
      await publish('eu', slot, 'admin');
      assert.equal(sent, 0);
      assert.equal((await requestDelete()).status, 400);
      assert.equal(deleted, 1);
    }
  );
  await t.test(
    'post deletion verifies ownership and failures remain retryable',
    async () => {
      const { key } = await seedDeletion();
      const run = async () =>
        dashboardAction({
          action: 'deletePost',
          seriesId: 'eu',
          revision: (await config()).revision,
          publicationKey: key,
          postId: 't3_abc123',
          confirmation: 'DELETE',
        });
      fakePost.authorName = 'someone_else';
      assert.equal((await run()).status, 400);
      assert.equal(deleted, 0);
      fakePost.authorName = 'check-in-crew';
      fakePost.subredditName = 'another_community';
      assert.equal((await run()).status, 400);
      fakePost.subredditName = 'loseit_test';
      failDelete = true;
      assert.equal((await run()).status, 400);
      assert.equal(JSON.parse(records.get(key)!).status, 'deleting');
      failDelete = false;
      assert.equal((await run()).status, 200);
      assert.equal(deleted, 1);
    }
  );
  await t.test(
    'bulk deletion cooldown is fixed at confirmation, cancellable, moderator-only and blocks restoration',
    async () => {
      await seedDeletion();
      assert.equal((await deletionSettings()).cooldownDays, 7);
      for (const days of [0, 31, true, 1.5, 'bad']) {
        installationSettings.set('bulkDeleteCooldownDays', days);
        assert.equal((await deletionSettings()).cooldownDays, 7);
        const res = await crew.request('/settings/deletion-cooldown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: days }),
        });
        assert.equal((await res.json()).success, false);
      }
      installationSettings.set('bulkDeleteCooldownDays', 1);
      const run = async (action: string, extra = {}) =>
        dashboardAction({
          action,
          seriesId: 'eu',
          revision: (await config()).revision,
          confirmation: 'EU',
          deletePosts: true,
          confirmed: true,
          ...extra,
        });
      assert.equal((await run('deleteSeries')).status, 400);
      await run('archive');
      assert.equal(
        (await run('deleteSeries', { confirmation: 'wrong' })).status,
        400
      );
      ctx.userId = 't2_volunteer';
      installationSettings.set('allowMaintainerDeletion', true);
      assert.equal((await run('deleteSeries')).status, 400);
      ctx.userId = 't2_admin';
      const before = Date.now();
      assert.equal((await run('deleteSeries')).status, 200);
      const job = (await config()).series[0]!.deletion!;
      assert.ok(Date.parse(job.dueAt) >= before + 86400000);
      installationSettings.set('bulkDeleteCooldownDays', 7);
      await processSeriesDeletions(new Date(before + 86300000));
      assert.equal(deleted, 0);
      assert.equal((await config()).series[0]!.deletion!.dueAt, job.dueAt);
      assert.equal((await run('unarchive')).status, 400);
      assert.equal((await run('cancelDeletion')).status, 200);
      assert.equal((await config()).series[0]!.deletion, undefined);
      assert.equal((await config()).series[0]!.archived, true);
      assert.equal((await config()).series[0]!.enabled, false);
    }
  );
  await t.test(
    'concurrent individual deletion cannot send two delete requests',
    async () => {
      const { key, cfg } = await seedDeletion();
      const body = {
        action: 'deletePost',
        seriesId: 'eu',
        revision: cfg.revision,
        publicationKey: key,
        postId: 't3_abc123',
        confirmation: 'DELETE',
      };
      const results = await Promise.all([
        dashboardAction(body),
        dashboardAction(body),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      assert.equal(deleted, 1);
    }
  );
  await t.test(
    'successful Reddit deletion with a failed save can be finished safely',
    async () => {
      const { key } = await seedDeletion();
      const run = async () =>
        dashboardAction({
          action: 'deletePost',
          seriesId: 'eu',
          revision: (await config()).revision,
          publicationKey: key,
          postId: 't3_abc123',
          confirmation: 'DELETE',
        });
      beforeExec = () => {
        const cfg = JSON.parse(records.get('crew:config:v1')!) as Config;
        cfg.revision++;
        records.set('crew:config:v1', JSON.stringify(cfg));
      };
      assert.equal((await run()).status, 400);
      assert.equal(deleted, 1);
      assert.equal(JSON.parse(records.get(key)!).status, 'deleting');
      fakePost.authorName = '[deleted]';
      assert.equal((await run()).status, 200);
      assert.equal(deleted, 1);
      assert.equal(JSON.parse(records.get(key)!).status, 'deleted');
    }
  );
  await t.test(
    'bulk deletion cannot silently discard an unresolved publication',
    async () => {
      const { cfg, key } = await seedDeletion();
      cfg.series[0]!.archived = true;
      records.set('crew:config:v1', JSON.stringify(cfg));
      records.set(
        key,
        JSON.stringify({
          status: 'uncertain',
          at: '2020-01-01T00:00:00Z',
          actor: 'scheduler',
        })
      );
      await dashboardAction({
        action: 'deleteSeries',
        revision: cfg.revision,
        seriesId: 'eu',
        confirmation: 'EU',
        deletePosts: true,
      });
      const now = new Date(Date.now() + 8 * 86400000);
      for (let n = 0; n < 21; n++) await processSeriesDeletions(now);
      assert.equal((await config()).series[0]!.deletion!.state, 'failed');
      assert.match((await config()).series[0]!.deletion!.error!, /recovery/);
      assert.equal(JSON.parse(records.get(key)!).status, 'uncertain');
      assert.equal(deleted, 0);
      assert.equal(
        (
          await dashboardAction({
            action: 'cancelDeletion',
            revision: (await config()).revision,
            seriesId: 'eu',
          })
        ).status,
        400
      );
    }
  );
  await t.test(
    'bulk worker finds old and future history, retains failures and completes cleanup on retry',
    async () => {
      const { key } = await seedDeletion();
      const cfg = await config();
      cfg.series[0]!.archived = true;
      records.set('crew:config:v1', JSON.stringify(cfg));
      const far = 'crew:post:eu:2099-12-25:daily';
      records.set(
        far,
        JSON.stringify({
          ...JSON.parse(records.get(key)!),
          postId: 't3_future',
        })
      );
      fakePosts.set('t3_future', { ...fakePost, id: 't3_future' });
      await fakeRedis.hSet('crew:history:eu:2099-12', { [far]: 'daily' });
      await dashboardAction({
        action: 'deleteSeries',
        revision: cfg.revision,
        seriesId: 'eu',
        confirmation: 'EU',
        deletePosts: true,
      });
      const now = new Date(Date.now() + 8 * 86400000);
      for (let n = 0; n < 20; n++) await processSeriesDeletions(now);
      assert.equal((await config()).series[0]!.deletion!.scanMonth, 1200);
      failDeleteId = 't3_future';
      await processSeriesDeletions(now);
      assert.equal((await config()).series[0]!.deletion!.state, 'failed');
      assert.equal(deleted, 1);
      assert.equal(JSON.parse(records.get(key)!).status, 'deleted');
      failDeleteId = '';
      await dashboardAction({
        action: 'retryDeletion',
        revision: (await config()).revision,
        seriesId: 'eu',
      });
      for (let n = 0; n < 22; n++) await processSeriesDeletions(now);
      assert.equal(deleted, 2);
      assert.equal(
        (await config()).series.some((s) => s.id === 'eu'),
        false
      );
      assert.equal(
        (await config()).series.some((s) => s.id === 'us'),
        true
      );
      assert.equal(records.has(key), false);
      assert.equal(records.has(far), false);
      assert.ok(!records.get('crew:audit')!.includes('Remove this saved text'));
      assert.ok(!records.has('crew:deletion-work:eu'));
    }
  );
  await t.test(
    'series data deletion preserves Reddit posts and erases archived snapshots',
    async () => {
      const { cfg, key } = await seedDeletion();
      cfg.series[0]!.archived = true;
      records.set('crew:config:v1', JSON.stringify(cfg));
      assert.equal(
        (
          await dashboardAction({
            action: 'deleteSeries',
            revision: cfg.revision,
            seriesId: 'eu',
            confirmation: 'EU',
            deletePosts: false,
          })
        ).status,
        200
      );
      for (let n = 0; n < 42; n++) await processSeriesDeletions();
      assert.equal(deleted, 0);
      assert.ok(!(await config()).series.some((s) => s.id === 'eu'));
      assert.ok(!records.has(key));
      assert.ok(!records.get('crew:audit')!.includes('Remove this saved text'));
    }
  );
  await t.test(
    'archive preserves data, excludes the limit and stops all publishing; restore stays paused',
    async () => {
      const cfg = reset();
      const series = cfg.series[0]!;
      series.enabled = true;
      series.hostRoster = ['volunteer'];
      series.templates.daily = 'Kept template';
      series.postOverrides = {
        '2099-12-25:daily': { body: 'Kept custom post' },
      };
      records.set('crew:config:v1', JSON.stringify(cfg));
      const old = parseDate('2026-09-14');
      records.set(
        'crew:post:eu:2026-09-14:daily',
        JSON.stringify({
          status: 'posted',
          at: '2026-09-14T07:00:00Z',
          actor: 'scheduler',
          url: 'https://www.reddit.com/r/loseit_test/comments/post',
        })
      );
      await fakeRedis.hSet('crew:history:eu:2026-09', {
        'crew:post:eu:2026-09-14:daily': JSON.stringify(old),
      });
      const staleSettings = await openAction('settings');
      const action = {
        action: 'archive',
        seriesId: 'eu',
        revision: 0,
        confirmed: true,
      };
      ctx.userId = 't2_volunteer';
      assert.equal((await dashboardAction(action)).status, 403);
      ctx.userId = 't2_admin';
      assert.equal(
        (await dashboardAction({ ...action, confirmed: false })).status,
        400
      );
      assert.equal((await dashboardAction(action)).status, 200);
      const archived = (await config()).series[0]!;
      assert.equal(archived.archived, true);
      assert.equal(archived.enabled, false);
      assert.deepEqual(archived.postOverrides, series.postOverrides);
      assert.deepEqual(archived.hostRoster, series.hostRoster);
      assert.equal(archived.templates.daily, 'Kept template');
      assert.deepEqual(
        dueSlots(
          { ...archived, enabled: true },
          new Date('2026-09-15T10:00:00Z')
        ),
        []
      );
      await assert.rejects(
        publish('eu', parseDate('2099-12-25'), 'admin'),
        /unavailable/
      );
      assert.equal(
        (
          await dashboardAction({
            action: 'resume',
            seriesIds: ['eu'],
            revision: 1,
          })
        ).status,
        400
      );
      assert.match(
        (
          await request('/form/settings', {
            ...fields(staleSettings),
            enabled: true,
          })
        ).showToast!,
        /changed|archived/
      );
      const current = await (
        await api.request('/dashboard?month=2026-09')
      ).json();
      assert.equal(current.series.length, 1);
      assert.equal(current.seriesCount, 1);
      const archiveView = await (
        await api.request('/dashboard?month=2026-09&view=archived')
      ).json();
      assert.equal(archiveView.series.length, 0);
      assert.equal(archiveView.archivedSeries[0].history[0].status, 'posted');
      installationSettings.set('maxSeries', 1);
      const restore = {
        action: 'unarchive',
        seriesId: 'eu',
        revision: 1,
        confirmed: true,
      };
      assert.equal((await dashboardAction(restore)).status, 400);
      assert.equal((await config()).series[0]!.archived, true);
      installationSettings.set('maxSeries', 2);
      assert.equal((await dashboardAction(restore)).status, 200);
      const restored = (await config()).series[0]!;
      assert.equal(restored.archived, false);
      assert.equal(restored.enabled, false);
      assert.equal(restored.id, 'eu');
      assert.equal(
        (
          await dashboardAction({
            action: 'archive',
            seriesId: 'eu',
            revision: 2,
            confirmed: true,
          })
        ).status,
        200
      );
      assert.equal(
        (
          await dashboardAction({
            action: 'archive',
            seriesId: 'us',
            revision: 3,
            confirmed: true,
          })
        ).status,
        200
      );
      const empty = await (await api.request('/dashboard')).json();
      assert.equal(empty.series.length, 0);
      assert.equal(empty.seriesCount, 0);
      assert.equal(empty.archivedCount, 2);
      const access = await openAction('access', 'eu');
      assert.match(
        (
          await request('/form/access', {
            ...fields(access),
            names: '',
            through: '',
          })
        ).showToast!,
        /updated/
      );
      ctx.userId = 't2_volunteer';
      assert.equal((await api.request('/dashboard?view=archived')).status, 403);
    }
  );
  await t.test(
    'native hub is streamlined and emergency pause works without the dashboard',
    async () => {
      const cfg = reset();
      cfg.series[0]!.enabled = true;
      records.set('crew:config:v1', JSON.stringify(cfg));
      const hub = await request('/menu/open');
      assert.deepEqual(
        hub
          .showForm!.form.fields.find((f) => f.name === 'action')!
          .options!.map((o) => o.value),
        ['dashboard', 'history', 'emergencyPause', 'access', 'resolve']
      );
      assert.ok(
        !hub
          .showForm!.form.fields.find((f) => f.name === 'series')!
          .options!.some((o) => o.value === '__new')
      );
      ctx.userId = 't2_volunteer';
      const pause = await openAction('emergencyPause');
      assert.match(
        (
          await request('/form/emergencyPause', {
            ...fields(pause),
            confirmed: false,
          })
        ).showToast!,
        /Confirm/
      );
      assert.equal((await config()).series[0]!.enabled, true);
      assert.match(
        (
          await request('/form/emergencyPause', {
            ...fields(pause),
            confirmed: true,
          })
        ).showToast!,
        /paused/
      );
      assert.equal((await config()).series[0]!.enabled, false);
      assert.equal((await config()).series[1]!.enabled, false);
    }
  );
  await t.test(
    'native recovery targets the selected timed occurrence, preserving neighbouring attempts',
    async () => {
      const cfg = reset();
      cfg.series[0]!.seriesType = 'simple';
      records.set('crew:config:v1', JSON.stringify(cfg));
      const slots = ['08:00', '14:00'].map((time) => ({
        ...parseDate('2026-09-14'),
        kind: 'daily' as const,
        time,
        timezone: 'UTC',
        at: `2026-09-14T${time}:00.000Z`,
      }));
      const keys = slots.map((slot) => 'crew:post:eu:' + postOverrideKey(slot));
      for (let i = 0; i < slots.length; i++) {
        records.set(
          keys[i]!,
          JSON.stringify({
            status: 'uncertain',
            at: '2020-01-01T00:00:00Z',
            actor: 'scheduler',
          })
        );
        await fakeRedis.hSet('crew:history:eu:2026-09', {
          [keys[i]!]: JSON.stringify(slots[i]),
        });
      }
      const start = await openAction('resolve');
      const picker = await request('/form/recoveryMonth', {
        ...fields(start),
        month: '2026-09',
      });
      const options = picker.showForm!.form.fields.find(
        (f) => f.name === 'occurrence'
      )!.options!;
      assert.equal(options.length, 2);
      assert.match(options[1]!.label, /14:00/);
      const base = {
        ...fields(picker),
        checked: true,
        resolution: ['clear'],
        postLink: '',
      };
      assert.match(
        (
          await request('/form/resolve', {
            ...base,
            occurrence: ['crew:post:us:2026-09-14:daily'],
          })
        ).showToast!,
        /existing publication/
      );
      assert.match(
        (await request('/form/resolve', { ...base, occurrence: [keys[1]] }))
          .showToast!,
        /cleared/
      );
      assert.ok(records.has(keys[0]!));
      assert.ok(!records.has(keys[1]!));
      const unresolved = records.get(keys[0]!)!;
      const linkAttempt = (postLink: string) =>
        request('/form/resolve', {
          ...base,
          occurrence: [keys[0]],
          resolution: ['link'],
          postLink,
        });
      for (const link of [
        '',
        't3_abc123',
        'https://reddit.com.example.com/r/loseit_test/comments/abc123/title/',
        'https://www.reddit.com/r/loseit_test/s/sharetoken',
      ]) {
        assert.match(
          (await linkAttempt(link)).showToast!,
          /Paste the Reddit post link/
        );
        assert.equal(records.get(keys[0]!), unresolved);
      }
      fakePost = {
        ...fakePost,
        id: 't3_abc123',
        authorName: 'check-in-crew',
        title: (await preview(cfg.series[0]!, slots[0]!)).title,
      };
      for (const link of [
        'https://www.reddit.com/r/loseit_test/comments/abc123/example/?share_id=test',
        'https://redd.it/abc123',
      ]) {
        records.set(keys[0]!, unresolved);
        assert.match(
          (await linkAttempt(link)).showToast!,
          /now shows it as posted/
        );
        assert.equal(JSON.parse(records.get(keys[0]!)!).postId, 't3_abc123');
        assert.equal(JSON.parse(records.get(keys[0]!)!).status, 'posted');
      }
      records.set(keys[0]!, unresolved);
      fakePost.authorName = 'someone_else';
      assert.match(
        (await linkAttempt('https://redd.it/abc123')).showToast!,
        /does not match/
      );
      assert.equal(records.get(keys[0]!), unresolved);
      assert.match(
        (
          await request('/form/resolve', {
            ...base,
            occurrence: [keys[0]],
            postLink: 'https://redd.it/abc123',
          })
        ).showToast!,
        /choose “The post exists”/
      );
      assert.equal(records.get(keys[0]!), unresolved);
    }
  );
  await t.test(
    'series limit is configurable and enforced by both creation interfaces',
    async () => {
      reset();
      assert.equal(await configuredSeriesLimit(), 10);
      for (const value of [0, 61, 1.5, 'invalid', false]) {
        installationSettings.set('maxSeries', value);
        assert.equal(await configuredSeriesLimit(), 10);
        const response = await crew.request('/settings/series-limit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        assert.equal((await response.json()).success, false);
      }
      for (const value of [1, 10, '60']) {
        installationSettings.set('maxSeries', value);
        assert.equal(await configuredSeriesLimit(), Number(value));
        const response = await crew.request('/settings/series-limit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        assert.equal((await response.json()).success, true);
      }
      installationSettings.set('maxSeries', 2);
      const create = {
        action: 'create',
        revision: 0,
        label: 'Extra',
        seriesType: 'simple',
        frequency: 'daily',
        time: '08:00',
        timezone: 'Europe/London',
      };
      const blocked = await dashboardAction(create);
      assert.equal(blocked.status, 400);
      assert.match(String(blocked.data.error), /limit of 2 series/);
      const choose = await openAction('settings', '__new');
      const details = await request('/form/createType', {
        ...fields(choose),
        seriesType: ['accountability'],
      });
      const denied = await request('/form/create', {
        ...fields(details),
        label: 'Extra',
        time: '08:00',
        timezone: 'Europe/London',
      });
      assert.match(denied.showToast!, /limit of 2 series/);
      // Both paused default series count. Lowering the cap preserves them and their controls.
      installationSettings.set('maxSeries', 1);
      assert.equal((await config()).series.length, 2);
      assert.equal(
        (
          await dashboardAction({
            action: 'pause',
            revision: 0,
            seriesIds: ['eu'],
          })
        ).status,
        200
      );
      installationSettings.set('maxSeries', 60);
      assert.equal(
        (await dashboardAction({ ...create, revision: 1 })).status,
        200
      );
      const cfg = await config();
      assert.equal(cfg.series.length, 3);
      cfg.series = Array.from({ length: 60 }, (_, i) => ({
        ...cfg.series[0]!,
        id: `s${i}`,
      }));
      records.set('crew:config:v1', JSON.stringify(cfg));
      assert.equal(
        (await dashboardAction({ ...create, revision: cfg.revision })).status,
        400
      );
    }
  );
  await t.test(
    'simple defaults and community note reach previews, dated editors and publishing',
    async () => {
      const cfg = reset();
      const daily = cfg.series[0]!;
      daily.seriesType = 'simple';
      daily.enabled = true;
      const weekly = cfg.series[1]!;
      weekly.seriesType = 'simple';
      weekly.frequency = 'weekly';
      records.set('crew:config:v1', JSON.stringify(cfg));
      installationSettings.set(
        'defaultSimpleDailyTitle',
        'Daily chat: {series} {weekday} {date}'
      );
      installationSettings.set(
        'defaultSimpleWeeklyTitle',
        'Weekly chat: {series} {date}'
      );
      installationSettings.set(
        'defaultSimpleTemplate',
        '{host_credit}\n\n{community_note}'
      );
      installationSettings.set(
        'defaultCommunityNote',
        'Welcome to our community.'
      );
      installationSettings.set('defaultDailyTitle', 'Monthly check-in {day}');
      const slot = parseDate('2099-12-25');
      const first = await preview(daily, slot);
      assert.match(first.title, /^Daily chat: EU Friday 2099-12-25$/);
      assert.match(first.text, /Welcome to our community/);
      assert.doesNotMatch(first.text, /Hosted by u\/volunteer/);
      daily.showHostCredit = true;
      assert.match((await preview(daily, slot)).text, /Hosted by u\/volunteer/);
      assert.equal(
        (await preview(weekly, slot)).title,
        'Weekly chat: US 2099-12-25'
      );
      const editor = await api.request(
        '/dashboard/preview?seriesId=eu&date=2099-12-25&kind=daily'
      );
      assert.equal(
        ((await editor.json()) as { inherited: { title: string } }).inherited
          .title,
        'Daily chat: {series} {weekday} {date}'
      );
      const dashboard = await api.request('/dashboard?month=2099-12');
      const data = (await dashboard.json()) as {
        series: {
          defaultTitles: { daily: string };
          titles: { daily: string };
        }[];
      };
      assert.equal(
        data.series[0]!.defaultTitles.daily,
        data.series[0]!.titles.daily
      );
      assert.match(data.series[1]!.defaultTitles.daily, /^Weekly chat/);
      await publish('eu', slot, 'scheduler', true);
      assert.equal(submitted[0]!.title, first.title);
      assert.equal(submitted[0]!.text, first.text);
      installationSettings.set('defaultCommunityNote', '');
      assert.doesNotMatch(
        (await preview(daily, parseDate('2099-12-26'))).text,
        /Welcome to our community|Be kind/
      );
      installationSettings.set(
        'defaultCommunityNote',
        'New community message.'
      );
      assert.match(
        (await preview(daily, parseDate('2099-12-26'))).text,
        /New community message/
      );
      assert.equal(
        (await preview({ ...daily, seriesType: 'accountability' }, slot)).title,
        'Monthly check-in 25'
      );
    }
  );
  await t.test(
    'explicit custom templates survive default changes until restored',
    async () => {
      const cfg = reset();
      cfg.series[0]!.seriesType = 'simple';
      records.set('crew:config:v1', JSON.stringify(cfg));
      installationSettings.set('defaultSimpleDailyTitle', 'Original {series}');
      installationSettings.set('defaultSimpleTemplate', 'Original body');
      assert.equal(
        (
          await dashboardAction({
            action: 'templates',
            seriesId: 'eu',
            revision: 0,
            dailyTitle: 'Original {series}',
            dailyTemplate: 'Original body',
          })
        ).status,
        200
      );
      installationSettings.set('defaultSimpleDailyTitle', 'Changed {series}');
      installationSettings.set('defaultSimpleTemplate', 'Changed body');
      const slot = parseDate('2099-12-25');
      assert.equal(
        (await preview((await config()).series[0]!, slot)).title,
        'Original EU'
      );
      assert.match(
        (await preview((await config()).series[0]!, slot)).text,
        /Original body/
      );
      assert.equal(
        (
          await dashboardAction({
            action: 'templates',
            seriesId: 'eu',
            revision: 1,
            resetKinds: ['daily'],
            resetTitleKinds: ['daily'],
          })
        ).status,
        200
      );
      assert.equal(
        (await preview((await config()).series[0]!, slot)).title,
        'Changed EU'
      );
      assert.match(
        (await preview((await config()).series[0]!, slot)).text,
        /Changed body/
      );
    }
  );
  await t.test(
    'new installations generate stable internal IDs while keeping display labels',
    async () => {
      records.clear();
      const first = await config();
      const second = await config();
      assert.deepEqual(
        first.series.map((series) => series.label),
        ['EU', 'US']
      );
      assert.deepEqual(
        second.series.map((series) => series.id),
        first.series.map((series) => series.id)
      );
      assert.ok(
        first.series.every((series) => /^s[a-f0-9]{11}$/.test(series.id))
      );
      assert.notEqual(first.series[0]!.id, first.series[1]!.id);
      reset();
    }
  );
  await t.test(
    'Post now can publish a future topic, records the user, and prevents its later scheduled duplicate',
    async () => {
      const cfg = reset();
      cfg.series[0]!.enabled = true;
      cfg.series[0]!.postOverrides = {
        '2099-12-25:daily': {
          title: 'Christmas topic',
          body: 'Special conversation',
        },
      };
      records.set('crew:config:v1', JSON.stringify(cfg));
      ctx.userId = 't2_volunteer';
      const action = {
        action: 'publish',
        revision: 0,
        seriesId: 'eu',
        date: '2099-12-25',
        kind: 'daily',
        confirmed: true,
      };
      manualSetting = false;
      assert.equal((await dashboardAction(action)).status, 403);
      manualSetting = true;
      assert.equal(
        (await dashboardAction({ ...action, confirmed: false })).status,
        400
      );
      assert.equal((await dashboardAction(action)).status, 200);
      assert.equal(submitted[0]!.title, 'Christmas topic');
      await publish('eu', parseDate('2099-12-25'), 'scheduler', true);
      assert.equal(sent, 1);
      const response = await api.request('/dashboard?month=2099-12');
      const data = (await response.json()) as {
        series: {
          days: {
            date: string;
            canPublish: boolean;
            canEdit: boolean;
            publicationActor?: string;
            publicationAt?: string;
          }[];
        }[];
      };
      const posted = data.series[0]!.days.find(
        (day) => day.date === '2099-12-25'
      )!;
      assert.equal(posted.canPublish, false);
      assert.equal(posted.canEdit, false);
      assert.equal(posted.publicationActor, 'volunteer');
      assert.ok(posted.publicationAt);
      assert.equal(
        data.series[0]!.days.find((day) => day.date === '2099-12-26')!
          .canPublish,
        true
      );
    }
  );
  await t.test(
    'manual testing also supports past unposted topics and future native previews while paused',
    async () => {
      reset();
      const action = {
        action: 'publish',
        revision: 0,
        seriesId: 'eu',
        date: '2020-12-25',
        kind: 'daily',
        confirmed: true,
      };
      assert.equal((await dashboardAction(action)).status, 200);
      const form = await openAction('preview');
      const review = await request('/form/preview', {
        ...fields(form),
        date: '2099-12-26',
      });
      assert.equal(Object.hasOwn(fields(review), 'confirmed'), true);
      const result = await request('/form/publish', {
        ...fields(review),
        confirmed: true,
      });
      assert.ok(result.navigateTo);
      assert.equal(sent, 2);
      manualSetting = false;
      const response = await api.request('/dashboard?month=2099-12');
      const data = (await response.json()) as {
        series: { days: { canPublish: boolean }[] }[];
      };
      assert.ok(
        data.series.every((series) =>
          series.days.every((day) => !day.canPublish)
        )
      );
    }
  );
  await t.test(
    'simple preview windows roll over months and replace published dates without losing saved edits',
    async () => {
      const cfg = reset();
      const series = cfg.series[0]!;
      series.seriesType = 'simple';
      series.postOverrides = { '2026-12-26:daily': { body: 'Special day' } };
      const now = new Date('2026-12-25T07:00:00Z');
      let slots = await upcomingSimpleSlots(series, now);
      assert.equal(slots.length, 15);
      assert.equal(slots[0]!.date, '2026-12-25');
      assert.equal(slots.at(-1)!.date, '2027-01-08');
      records.set(
        'crew:post:eu:2026-12-25:daily',
        JSON.stringify({ status: 'posted' })
      );
      slots = await upcomingSimpleSlots(series, now);
      assert.equal(slots.length, 15);
      assert.equal(slots[0]!.date, '2026-12-26');
      assert.equal(slots.at(-1)!.date, '2027-01-09');
      installationSettings.set('dailyPostsAhead', 2);
      assert.equal((await upcomingSimpleSlots(series, now)).length, 2);
      installationSettings.set('dailyPostsAhead', 20);
      assert.equal((await upcomingSimpleSlots(series, now)).length, 20);
      assert.equal(
        series.postOverrides['2026-12-26:daily']!.body,
        'Special day'
      );
      series.frequency = 'weekly';
      series.weekday = 5;
      slots = await upcomingSimpleSlots(series, now);
      assert.equal(slots.length, 5);
      assert.equal(slots[0]!.date, '2027-01-01');
      assert.equal(slots.at(-1)!.date, '2027-01-29');
      installationSettings.set('weeklyPostsAhead', '60');
      assert.equal((await upcomingSimpleSlots(series, now)).length, 60);
    }
  );
  await t.test(
    'installation settings control dashboard window sizes and reject invalid counts',
    async () => {
      const cfg = reset();
      cfg.series[0]!.seriesType = 'simple';
      cfg.series[1]!.seriesType = 'simple';
      cfg.series[1]!.frequency = 'weekly';
      records.set('crew:config:v1', JSON.stringify(cfg));
      installationSettings.set('dailyPostsAhead', 3);
      installationSettings.set('weeklyPostsAhead', '2');
      const response = await api.request('/dashboard?month=2020-01');
      assert.equal(response.status, 200);
      const data = (await response.json()) as {
        series: {
          days: { date: string }[];
          historyDays: unknown[];
          previewCount: number;
        }[];
      };
      assert.equal(data.series[0]!.days.length, 3);
      assert.equal(data.series[1]!.days.length, 2);
      assert.equal(data.series[0]!.previewCount, 3);
      assert.ok(data.series[0]!.days[0]!.date > '2020-01-31');
      assert.equal(data.series[0]!.historyDays.length, 31);
      for (const value of [0, -1, 1.5, 61, 'nonsense', true]) {
        const result = await crew.request('/settings/preview-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        assert.equal(
          ((await result.json()) as { success: boolean }).success,
          false
        );
      }
      for (const value of [1, 15, 60, '5']) {
        const result = await crew.request('/settings/preview-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        assert.equal(
          ((await result.json()) as { success: boolean }).success,
          true
        );
      }
      installationSettings.set('dailyPostsAhead', 0);
      installationSettings.set('weeklyPostsAhead', 'invalid');
      assert.deepEqual(await configuredPreviewCounts(), {
        daily: 15,
        weekly: 5,
        other: 5,
      });
    }
  );
  await t.test(
    'simple schedules can be changed while retaining the series history',
    async () => {
      const cfg = reset();
      cfg.series[0]!.seriesType = 'simple';
      cfg.series[0]!.enabled = true;
      records.set('crew:config:v1', JSON.stringify(cfg));
      const rule = {
        frequency: 'other' as const,
        unit: 'months' as const,
        interval: 1,
        start: '2099-01-15T08:00',
        weekdays: [],
        monthMode: 'last' as const,
        monthDay: 1,
        ordinal: 1,
        monthWeekday: 1,
        shortMonth: 'last' as const,
      };
      assert.equal(
        (
          await dashboardAction({
            action: 'schedulePreview',
            revision: 0,
            seriesId: 'eu',
            timezone: 'Europe/London',
            schedule: rule,
          })
        ).status,
        200
      );
      assert.equal(
        (
          await dashboardAction({
            action: 'scheduleSave',
            revision: 0,
            seriesId: 'eu',
            timezone: 'Europe/London',
            schedule: rule,
            confirmed: true,
          })
        ).status,
        200
      );
      const saved = (await config()).series[0]!;
      assert.equal(saved.frequency, 'other');
      assert.equal(saved.schedule?.monthMode, 'last');
      assert.equal(saved.scheduleHistory?.[0]?.frequency, 'daily');
      assert.equal(
        (
          await dashboardAction({
            action: 'schedulePreview',
            revision: 1,
            seriesId: 'eu',
            timezone: 'Europe/London',
            schedule: {
              ...rule,
              frequency: 'weekly',
              unit: 'weeks',
              start: '2099-03-02T08:00',
              weekdays: [1],
            },
          })
        ).status,
        200
      );
    }
  );
  await t.test(
    'a dated edit previews without saving, publishes with live placeholders, and leaves other dates untouched',
    async () => {
      const cfg = reset();
      cfg.series[0]!.enabled = true;
      records.set('crew:config:v1', JSON.stringify(cfg));
      ctx.userId = 't2_volunteer';
      const edit = {
        action: 'postOverride',
        revision: 0,
        seriesId: 'eu',
        date: '2099-12-25',
        kind: 'daily',
        postTitle: 'Christmas with {series}',
        postBody: '{host_credit}\n\nA festive conversation for {day} {month}.',
      };
      assert.equal(
        (await dashboardAction({ ...edit, action: 'postPreview' })).data.title,
        'Christmas with EU'
      );
      assert.equal((await config()).series[0]!.postOverrides, undefined);
      assert.equal((await dashboardAction(edit)).status, 200);
      assert.equal(sent, 0);
      const current = await config();
      const special = await preview(
        current.series[0]!,
        parseDate('2099-12-25')
      );
      assert.match(special.text, /u\/volunteer/);
      assert.match(special.text, /25 December 2099/);
      assert.doesNotMatch(
        (await preview(current.series[0]!, parseDate('2099-12-26'))).text,
        /festive/
      );
      assert.doesNotMatch(
        (await preview(current.series[1]!, parseDate('2099-12-25'))).text,
        /festive/
      );
      await publish('eu', parseDate('2099-12-25'), 'scheduler', true);
      assert.equal(submitted[0]!.title, special.title);
      assert.equal(submitted[0]!.text, special.text);
      assert.equal(
        (await dashboardAction({ ...edit, revision: 1 })).status,
        400
      );
    }
  );
  await t.test(
    'future overrides enforce access, validation, stale revisions and resetting defaults',
    async () => {
      reset();
      const edit = {
        action: 'postOverride',
        revision: 0,
        seriesId: 'eu',
        date: '2099-12-25',
        kind: 'daily',
        postBody: 'Special day',
      };
      ctx.userId = 't2_stranger';
      assert.equal((await dashboardAction(edit)).status, 400);
      ctx.userId = 't2_volunteer';
      assert.equal(
        (await dashboardAction({ ...edit, seriesId: 'us' })).status,
        400
      );
      assert.equal(
        (await dashboardAction({ ...edit, postTitle: 'bad\ntitle' })).status,
        400
      );
      assert.equal(
        (await dashboardAction({ ...edit, postBody: ' ' })).status,
        400
      );
      assert.equal(
        (await dashboardAction({ ...edit, kind: 'signup' })).status,
        400
      );
      assert.equal(
        (await dashboardAction({ ...edit, date: '2020-12-25' })).status,
        400
      );
      assert.equal((await dashboardAction(edit)).status, 200);
      assert.equal((await dashboardAction(edit)).status, 400);
      const res = await api.request(
        '/dashboard/preview?seriesId=eu&date=2099-12-25&kind=daily'
      );
      const data = (await res.json()) as {
        editable: boolean;
        override: { body: string };
        revision: number;
      };
      assert.equal(data.editable, true);
      assert.equal(data.override.body, 'Special day');
      assert.equal(data.revision, 1);
      assert.equal(
        (
          await dashboardAction({
            ...edit,
            revision: 1,
            postBody: null,
            postTitle: null,
          })
        ).status,
        200
      );
      assert.deepEqual((await config()).series[0]!.postOverrides, {});
    }
  );
  await t.test(
    'publication and editing cannot race into a stale scheduled post',
    async () => {
      reset();
      const key = 'crew:post:eu:2099-12-25:daily';
      beforeExec = () =>
        records.set(key, JSON.stringify({ status: 'pending' }));
      const result = await dashboardAction({
        action: 'postOverride',
        revision: 0,
        seriesId: 'eu',
        date: '2099-12-25',
        kind: 'daily',
        postBody: 'Too late',
      });
      assert.equal(result.status, 400);
      assert.equal((await config()).series[0]!.postOverrides, undefined);
      reset();
      beforeExec = () => {
        const cfg = JSON.parse(records.get('crew:config:v1')!) as Config;
        cfg.revision++;
        records.set('crew:config:v1', JSON.stringify(cfg));
      };
      await assert.rejects(publish('eu', parseDate('2099-12-25'), 'admin'));
      assert.equal(sent, 0);
      assert.equal(records.has(key), false);
    }
  );
  await t.test('moderators can change a series display name', async () => {
    reset();
    assert.equal(
      (
        await dashboardAction({
          action: 'update',
          revision: 0,
          seriesId: 'eu',
          label: 'Morning Crew',
        })
      ).status,
      200
    );
    assert.equal((await config()).series[0]!.label, 'Morning Crew');
  });
  await t.test(
    'creation only asks for relevant timing and preserves the selected type',
    async () => {
      for (const [type, frequency] of [
        ['accountability', 'daily'],
        ['simple', 'daily'],
        ['simple', 'weekly'],
        ['simple', 'other'],
      ] as const) {
        reset();
        const chooseType = await openAction('settings', '__new');
        assert.equal(chooseType.showForm?.name, 'createType');
        assert.ok(!Object.hasOwn(fields(chooseType), 'frequency'));
        let details = await request('/form/createType', {
          ...fields(chooseType),
          seriesType: [type],
        });
        if (type === 'simple') {
          assert.equal(details.showForm?.name, 'createTiming');
          assert.ok(!Object.hasOwn(fields(details), 'weekday'));
          details = await request('/form/createTiming', {
            ...fields(details),
            frequency: [frequency],
          });
        }
        assert.equal(details.showForm?.name, 'create');
        assert.equal(
          Object.hasOwn(fields(details), 'weekday'),
          frequency === 'weekly'
        );
        const result = await request('/form/create', {
          ...fields(details),
          id: 'new-series',
          label: 'New Series',
          weekday: ['3'],
          seriesType: ['forged'],
          frequency: ['forged'],
        });
        assert.match(result.showToast!, /created/);
        const saved = (
          JSON.parse(records.get('crew:config:v1')!) as Config
        ).series.at(-1)!;
        assert.equal(saved.seriesType, type);
        assert.equal(saved.frequency, frequency);
        assert.equal(saved.weekday, frequency === 'weekly' ? 3 : 1);
        assert.equal(saved.enabled, false);
        assert.match(saved.id, /^s[a-f0-9]{11}$/);
      }
    }
  );
  await t.test(
    'non-maintainers cannot open management; another series cannot be forged',
    async () => {
      reset();
      const adminMenu = await request('/menu/open');
      assert.match(String(fields(adminMenu).dashboard), /EU: PAUSED/);
      assert.match(String(fields(adminMenu).dashboard), /u\/volunteer/);
      ctx.userId = 't2_stranger';
      assert.match((await request('/menu/open')).showToast!, /Ask a moderator/);
      ctx.userId = 't2_volunteer';
      const menu = await request('/menu/open');
      const denied = await request('/form/choose', {
        ...fields(menu),
        series: ['us'],
        action: ['settings'],
      });
      assert.match(denied.showToast!, /do not have access/);
    }
  );
  await t.test(
    'a volunteer cannot grant access or use another account’s form',
    async () => {
      reset();
      const access = await openAction('access');
      ctx.userId = 't2_volunteer';
      const denied = await request('/form/access', {
        ...fields(access),
        names: 'attacker',
      });
      assert.match(denied.showToast!, /Everything/);
      const ownForm = await openAction('settings');
      ctx.userId = 't2_admin';
      assert.match(
        (await request('/form/settings', fields(ownForm))).showToast!,
        /does not belong/
      );
    }
  );
  await t.test(
    'revocation and bans are rechecked at submission time',
    async () => {
      const cfg = reset();
      ctx.userId = 't2_volunteer';
      const settings = await openAction('settings');
      cfg.series[0]!.maintainers = [];
      records.set('crew:config:v1', JSON.stringify(cfg));
      assert.match(
        (await request('/form/settings', fields(settings))).showToast!,
        /do not have access/
      );
      reset();
      ctx.userId = 't2_volunteer';
      const fresh = await openAction('settings');
      banned = true;
      assert.match(
        (await request('/form/settings', fields(fresh))).showToast!,
        /cannot manage/
      );
    }
  );
  await t.test(
    'stale form cannot overwrite another moderator’s settings',
    async () => {
      reset();
      const first = await openAction('settings');
      const second = await openAction('settings');
      assert.match(
        (await request('/form/settings', { ...fields(first), time: '09:00' }))
          .showToast!,
        /saved/
      );
      assert.match(
        (await request('/form/settings', { ...fields(second), time: '10:00' }))
          .showToast!,
        /Someone changed/
      );
      assert.equal(
        (JSON.parse(records.get('crew:config:v1')!) as Config).series[0]!.time,
        '09:00'
      );
    }
  );
  await t.test(
    'manual preview requires explicit confirmation and cannot be replayed into duplicate posts',
    async () => {
      reset();
      ctx.userId = 't2_volunteer';
      const dateForm = await openAction('preview');
      const review = await request('/form/preview', fields(dateForm));
      assert.equal(review.showForm?.name, 'publish');
      assert.match(
        (await request('/form/publish', fields(review))).showToast!,
        /confirmation/
      );
      assert.equal(sent, 0);
      const values = { ...fields(review), confirmed: true };
      assert.ok((await request('/form/publish', values)).navigateTo);
      assert.ok((await request('/form/publish', values)).navigateTo);
      assert.equal(sent, 1);
    }
  );
  await t.test(
    'manual posting setting hides the publish action and blocks stale submissions',
    async () => {
      reset();
      ctx.userId = 't2_volunteer';
      const dateForm = await openAction('preview');
      manualSetting = 'false';
      const review = await request('/form/preview', fields(dateForm));
      assert.equal(Object.hasOwn(fields(review), 'confirmed'), false);
      assert.match(
        (
          await request('/form/publish', {
            ...fields(review),
            confirmed: true,
          })
        ).showToast!,
        /Manual posting is disabled/
      );
    }
  );
  await t.test(
    'configured sticky slots are applied after publication',
    async () => {
      const cfg = reset();
      cfg.series[0]!.sticky = {
        signup: 'slot1',
        daily: 'slot2',
        roundup: 'none',
      };
      records.set('crew:config:v1', JSON.stringify(cfg));
      const dateForm = await openAction('preview');
      const review = await request('/form/preview', fields(dateForm));
      assert.ok(
        (await request('/form/publish', { ...fields(review), confirmed: true }))
          .navigateTo
      );
      const today = localClock(new Date(), 'Europe/London').date;
      assert.deepEqual(stickyPositions, [today.endsWith('-01') ? 1 : 2]);
    }
  );
  await t.test(
    'changed host credits invalidate a previous publication preview',
    async () => {
      const cfg = reset();
      const dateForm = await openAction('preview');
      const review = await request('/form/preview', fields(dateForm));
      cfg.revision++;
      records.set('crew:config:v1', JSON.stringify(cfg));
      assert.match(
        (await request('/form/publish', { ...fields(review), confirmed: true }))
          .showToast!,
        /changed/
      );
      assert.equal(sent, 0);
    }
  );
  await t.test(
    'paused scheduler never publishes; repeated scheduled runs do not duplicate',
    async () => {
      const cfg = reset();
      await automation.request('/scheduler/tick', { method: 'POST' });
      assert.equal(sent, 0);
      cfg.series[0]!.enabled = true;
      cfg.series[0]!.time = '00:00';
      records.set('crew:config:v1', JSON.stringify(cfg));
      await automation.request('/scheduler/tick', { method: 'POST' });
      const expected = localClock(new Date(), 'Europe/London').date.endsWith(
        '-01'
      )
        ? 2
        : 1;
      assert.equal(sent, expected);
      await automation.request('/scheduler/tick', { method: 'POST' });
      assert.equal(sent, expected);
    }
  );
});
