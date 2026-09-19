import { context, reddit, redis } from '@devvit/web/server';
import { config, publicationStore, type Identity } from './service.ts';
import { isCheckInCrewAuthor, type Series } from './model.ts';

const CONFIG = 'crew:config:v1';
const AUDIT = 'crew:audit';
const RECOVERIES = 'crew:recoveries';
const JOB = 'crew:privacy-deletion';
const workKey = 'crew:privacy-deletion-work';

type PrivacyJob = {
  username: string;
  startedAt: string;
  state: 'scanning' | 'editing' | 'failed';
  scanMonth: number;
  error?: string;
};

const cleanUsername = (value: string): string =>
  value.replace(/^u\//i, '').trim().toLowerCase();

function validUsername(value: string): boolean {
  return /^[a-z0-9_-]{3,20}$/i.test(value);
}

function mentionPattern(username: string): RegExp {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w/])(?:/?u/)${escaped}(?![\\w-])`, 'gi');
}

function redactText(value: string, username: string): string {
  return value.replace(mentionPattern(username), '[deleted]');
}

function scrubSeries(series: Series, username: string): void {
  const matches = (value: string) => value.toLowerCase() === username;
  series.maintainers = series.maintainers.filter(
    (member) => !matches(member.username)
  );
  for (const month of Object.keys(series.hosts))
    series.hosts[month] = series.hosts[month]!.filter((name) => !matches(name));
  if (series.hostRoster)
    series.hostRoster = series.hostRoster.filter((name) => !matches(name));
  for (const kind of Object.keys(series.templates) as Array<
    keyof typeof series.templates
  >) {
    const value = series.templates[kind];
    if (value !== undefined) series.templates[kind] = redactText(value, username);
  }
  for (const key of Object.keys(series.postOverrides ?? {})) {
    const edit = series.postOverrides?.[key];
    if (!edit) continue;
    if (edit.title !== undefined) edit.title = redactText(edit.title, username);
    if (edit.body !== undefined) edit.body = redactText(edit.body, username);
  }
  if (series.hostCredit !== undefined)
    series.hostCredit = redactText(series.hostCredit, username);
}

function scrubStored(value: unknown, username: string): unknown {
  if (typeof value === 'string')
    return value.toLowerCase() === username ? '[deleted]' : redactText(value, username);
  if (Array.isArray(value)) return value.map((item) => scrubStored(item, username));
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const isPerson =
    typeof input.username === 'string' &&
    input.username.toLowerCase() === username;
  for (const [key, item] of Object.entries(input)) {
    if (isPerson && (key === 'id' || key === 'username')) continue;
    output[key] = scrubStored(item, username);
  }
  return output;
}

async function saveJob(job: PrivacyJob): Promise<void> {
  await redis.set(JOB, JSON.stringify(job));
}

async function job(): Promise<PrivacyJob | undefined> {
  const raw = await redis.get(JOB);
  return raw ? (JSON.parse(raw) as PrivacyJob) : undefined;
}

export async function privacyStatus() {
  const active = await job();
  if (!active) return undefined;
  return {
    state: active.state,
    startedAt: active.startedAt,
    scannedMonths: active.scanMonth,
    pendingPosts: Object.keys(await redis.hGetAll(workKey)).length,
    error: active.error,
  };
}

export async function personalDataDeletionPreview(
  who: Identity,
  input: string
): Promise<{ postCount: number }> {
  if (!who.admin)
    throw Error('Only moderators can process personal-data deletion requests.');
  const username = cleanUsername(input);
  if (!validUsername(username)) throw Error('Enter a valid Reddit username.');
  if (await job())
    throw Error('A personal-data deletion request is already in progress.');
  let postCount = 0;
  const cfg = await config();
  for (let n = 0; n < 1200; n++) {
    const month = `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
    for (const series of cfg.series) {
      const index = await redis.hGetAll(`crew:history:${series.id}:${month}`);
      for (const key of Object.keys(index)) {
        if (!key.startsWith(`crew:post:${series.id}:`)) continue;
        const record = await publicationStore.read(key);
        if (record?.postId && ['posted', 'deleting'].includes(record.status))
          postCount++;
      }
    }
  }
  return { postCount };
}

export async function requestPersonalDataDeletion(
  who: Identity,
  input: string,
  confirmation: string
): Promise<void> {
  if (!who.admin)
    throw Error('Only moderators can process personal-data deletion requests.');
  const username = cleanUsername(input);
  if (!validUsername(username)) throw Error('Enter a valid Reddit username.');
  if (confirmation !== 'DELETE')
    throw Error('Type DELETE to confirm this personal-data deletion request.');
  if (await job())
    throw Error('A personal-data deletion request is already in progress.');

  const tx = await redis.watch(CONFIG, AUDIT, RECOVERIES, JOB);
  let executed = false;
  try {
    if (await redis.get(JOB))
      throw Error('A personal-data deletion request is already in progress.');
    const cfg = await config();
    for (const series of cfg.series) scrubSeries(series, username);
    cfg.revision++;
    const audit = await redis.hGetAll(AUDIT);
    const recoveries = await redis.hGetAll(RECOVERIES);
    const next: PrivacyJob = {
      username,
      startedAt: new Date().toISOString(),
      state: 'scanning',
      scanMonth: 0,
    };
    await tx.multi();
    await tx.set(CONFIG, JSON.stringify(cfg));
    for (const [key, raw] of Object.entries(audit))
      await tx.hSet(AUDIT, {
        [key]: JSON.stringify(scrubStored(JSON.parse(raw), username)),
      });
    for (const [key, raw] of Object.entries(recoveries))
      await tx.hSet(RECOVERIES, {
        [key]: JSON.stringify(scrubStored(JSON.parse(raw), username)),
      });
    await tx.hSet(AUDIT, {
      [String(cfg.revision)]: JSON.stringify({
        at: new Date().toISOString(),
        action: 'Personal-data deletion started',
      }),
    });
    await tx.set(JOB, JSON.stringify(next));
    const result = await tx.exec();
    executed = true;
    if (!result?.length) throw Error('Settings changed. Reopen the dashboard and retry.');
  } finally {
    if (!executed) await tx.unwatch();
  }
}

export async function retryPersonalDataDeletion(who: Identity): Promise<void> {
  if (!who.admin)
    throw Error('Only moderators can process personal-data deletion requests.');
  const active = await job();
  if (!active || active.state !== 'failed')
    throw Error('There is no failed personal-data deletion request to retry.');
  active.state = active.scanMonth < 1200 ? 'scanning' : 'editing';
  delete active.error;
  await saveJob(active);
}

async function ownPost(id: string) {
  if (!/^t3_[a-z0-9]+$/.test(id)) throw Error('Invalid recorded post ID.');
  const post = await reddit.getPostById(id as `t3_${string}`);
  if (
    post.id !== id ||
    post.subredditName.toLowerCase() !== context.subredditName.toLowerCase() ||
    !isCheckInCrewAuthor(post.authorName)
  )
    throw Error('The recorded post does not belong to this app and community.');
  return post;
}

export async function processPersonalDataDeletion(): Promise<void> {
  const active = await job();
  if (!active || active.state === 'failed') return;
  try {
    const cfg = await config();
    if (active.scanMonth < 1200) {
      const end = Math.min(active.scanMonth + 60, 1200);
      for (let n = active.scanMonth; n < end; n++) {
        const month = `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
        for (const series of cfg.series) {
          const index = await redis.hGetAll(`crew:history:${series.id}:${month}`);
          const keys = Object.keys(index).filter((key) =>
            key.startsWith(`crew:post:${series.id}:`)
          );
          if (keys.length)
            await redis.hSet(workKey, Object.fromEntries(keys.map((key) => [key, '1'])));
        }
      }
      active.scanMonth = end;
      active.state = end < 1200 ? 'scanning' : 'editing';
      await saveJob(active);
      return;
    }
    const pending = Object.keys(await redis.hGetAll(workKey)).slice(0, 10);
    for (const key of pending) {
      const record = await publicationStore.read(key);
      if (record?.actor.toLowerCase() === active.username)
        await publicationStore.write(key, { ...record, actor: '[deleted]' });
      if (record?.postId && ['posted', 'deleting'].includes(record.status)) {
        const post = await ownPost(record.postId);
        if (post.authorName.toLowerCase() !== '[deleted]') {
          const body = post.body ?? '';
          const text = redactText(body, active.username);
          if (text !== body) await post.edit({ text });
        }
      }
      await redis.hDel(workKey, [key]);
    }
    if (Object.keys(await redis.hGetAll(workKey)).length) return;
    await redis.del(workKey);
    await redis.del(JOB);
  } catch (error) {
    active.state = 'failed';
    active.error = error instanceof Error ? error.message : 'Personal-data cleanup failed.';
    await saveJob(active);
  }
}
