import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const ctx = { userId: 't2_member', subredditName: 'loseit_test' };
const saved = new Map<string, unknown>();
let current = { flairText: 'Old flair', flairCssClass: '' };
let banned = false;
let enabled = true;
let selfAssign = true;
let failWrite = false;
const templates = [
  {
    id: 'public',
    text: 'Member',
    modOnly: false,
    allowUserEdits: true,
    allowableContent: 'text',
  },
  {
    id: 'reserved',
    text: 'Moderator',
    modOnly: true,
    allowUserEdits: false,
    allowableContent: 'text',
  },
];
const writes: Record<string, unknown>[] = [];
mock.module('@devvit/web/server', {
  namedExports: {
    context: ctx,
    settings: {
      async get(key: string) {
        return saved.get(key);
      },
    },
    reddit: {
      async getCurrentUser() {
        return {
          id: ctx.userId,
          username: 'member',
          async getUserFlairBySubreddit() {
            return current;
          },
        };
      },
      getBannedUsers() {
        return {
          async all() {
            return banned ? ['member'] : [];
          },
        };
      },
      async getSubredditByName() {
        return {
          userFlairsEnabled: enabled,
          usersCanAssignUserFlairs: selfAssign,
        };
      },
      async getUserFlairTemplates() {
        return templates;
      },
      async setUserFlair(value: Record<string, unknown>) {
        if (failWrite) throw Error('Reddit unavailable');
        writes.push(value);
      },
    },
  },
});
const { flair } = await import('./flair.ts');
const read = () => flair.request('/');
const body = () => ({
  formatId: '5',
  values: { flair7: { value: 'My new flair' } },
  preview: 'My new flair',
  confirm: true,
  previous: { text: 'Old flair', css: '' },
});
const post = (data: unknown) =>
  flair.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
void test('self-service flair enforces ownership, fresh settings, public templates and explicit Apply', async () => {
  saved.set('allowReplacingExistingFlair', true);
  assert.equal((await read()).status, 200);
  assert.equal(writes.length, 0);
  assert.equal(
    (
      await post({
        ...body(),
        values: { flair7: { value: 'Moderator' } },
        preview: 'Moderator',
      })
    ).status,
    400
  );
  assert.equal((await post({ ...body(), confirm: false })).status, 400);
  assert.equal(
    (await post({ ...body(), preview: 'forged preview' })).status,
    400
  );
  assert.equal(
    (
      await post({
        ...body(),
        username: 'someone_else',
        subredditName: 'other',
      })
    ).status,
    200
  );
  assert.deepEqual(writes[0], {
    username: 'member',
    subredditName: 'loseit_test',
    flairTemplateId: 'public',
    text: 'My new flair',
  });
  ctx.userId = '';
  assert.equal((await read()).status, 400);
  assert.equal((await post(body())).status, 400);
  ctx.userId = 't2_member';
  saved.set('enableUserFlair', false);
  assert.equal((await post(body())).status, 400);
  saved.clear();
  banned = true;
  assert.equal((await post(body())).status, 400);
  banned = false;
  enabled = false;
  assert.equal((await post(body())).status, 400);
  enabled = true;
  saved.set('flairFormat5Name', '');
  assert.equal((await post(body())).status, 400);
  saved.clear();
  saved.set('flairFormat5Text', 'New: {flair7}');
  assert.equal((await post(body())).status, 400);
  saved.clear();
  current.flairText = 'Changed elsewhere';
  assert.equal((await post(body())).status, 400);
  current.flairText = 'Old flair';
  saved.set('userFlairTemplate', 'reserved');
  assert.equal((await post(body())).status, 400);
  saved.clear();
  saved.set('allowReplacingExistingFlair', true);
  current.flairCssClass = 'mod';
  assert.equal(
    (await post({ ...body(), previous: { text: 'Old flair', css: 'mod' } }))
      .status,
    200
  );
  current = { flairText: 'Moderator', flairCssClass: '' };
  assert.equal(
    (await post({ ...body(), previous: { text: 'Moderator', css: '' } }))
      .status,
    400
  );
  saved.clear();
  current = { flairText: 'Old flair', flairCssClass: '' };
  assert.equal((await post(body())).status, 400);
  saved.set('allowReplacingExistingFlair', true);
  assert.equal((await post(body())).status, 200);
  saved.clear();
  current = { flairText: '', flairCssClass: '' };
  selfAssign = false;
  assert.equal((await read()).status, 400);
  saved.set('allowBotFlairAssignment', true);
  assert.equal((await read()).status, 200);
  assert.equal(
    (
      await post({
        ...body(),
        previous: { text: '', css: '' },
      })
    ).status,
    200
  );
  selfAssign = true;
  saved.clear();
  const writesBeforeFailure = writes.length;
  failWrite = true;
  assert.equal((await post(body())).status, 400);
  failWrite = false;
  assert.equal(writes.length, writesBeforeFailure);
  current.flairText = 'Old flair';
  current.flairCssClass = 'progress10';
  saved.set('allowReplacingExistingFlair', true);
  assert.equal(
    (
      await post({
        ...body(),
        previous: { text: 'Old flair', css: 'progress10' },
      })
    ).status,
    200
  );
  assert.equal(writes.length, writesBeforeFailure + 1);
});
