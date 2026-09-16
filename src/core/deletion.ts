import { randomUUID } from 'node:crypto';
import { context, reddit, redis, settings } from '@devvit/web/server';
import {
  config,
  requireSeries,
  publicationStore,
  type Identity,
} from './service.ts';
import type { Config, Publication, Series } from './model.ts';

const CONFIG = 'crew:config:v1';
const AUDIT = 'crew:audit';
const RECOVERIES = 'crew:recoveries';
const workKey = (id: string) => `crew:deletion-work:${id}`;
export async function deletionSettings() {
  const raw = await settings.get('bulkDeleteCooldownDays');
  const days =
    typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  return {
    allowMaintainers: (await settings.get('allowMaintainerDeletion')) === true,
    cooldownDays: Number.isInteger(days) && days >= 1 && days <= 30 ? days : 7,
  };
}

// A lease keeps individual deletion and background cleanup from overlapping.
async function withLease<T>(id: string, run: () => Promise<T>): Promise<T> {
  const key = `crew:deletion-lock:${id}`;
  const token = randomUUID();
  if (
    !(await redis.set(key, token, {
      nx: true,
      expiration: new Date(Date.now() + 300_000),
    }))
  )
    throw Error('Deletion is already being processed. Refresh shortly.');
  try {
    return await run();
  } finally {
    const tx = await redis.watch(key);
    let executed = false;
    try {
      if ((await redis.get(key)) === token) {
        await tx.multi();
        await tx.del(key);
        await tx.exec();
        executed = true;
      }
    } finally {
      if (!executed) await tx.unwatch();
    }
  }
}

// Delete old copies too. New configuration edits no longer save full snapshots.
async function change(
  update: (cfg: Config) => void,
  scrub?: { seriesId: string; slotId?: string },
  publication?: { key: string; record: Publication }
) {
  const tx = await redis.watch(CONFIG, AUDIT, RECOVERIES);
  let executed = false;
  try {
    const cfg = await config();
    update(cfg);
    cfg.revision++;
    const audit = scrub ? await redis.hGetAll(AUDIT) : {};
    const recoveries = scrub ? await redis.hGetAll(RECOVERIES) : {};
    await tx.multi();
    await tx.set(CONFIG, JSON.stringify(cfg));
    if (publication)
      await tx.set(publication.key, JSON.stringify(publication.record));
    for (const [key, raw] of Object.entries(audit)) {
      const entry = JSON.parse(raw) as { series?: Series[] };
      if (!entry.series || !scrub) continue;
      if (!scrub.slotId)
        entry.series = entry.series.filter((s) => s.id !== scrub.seriesId);
      else
        for (const s of entry.series)
          if (s.id === scrub.seriesId) {
            delete s.postOverrides?.[scrub.slotId];
            delete s.overrideSlots?.[scrub.slotId];
          }
      await tx.hSet(AUDIT, { [key]: JSON.stringify(entry) });
    }
    for (const key of Object.keys(recoveries)) {
      if (
        key.startsWith(
          `crew:post:${scrub!.seriesId}:${scrub!.slotId ? scrub!.slotId + ':' : ''}`
        )
      )
        await tx.hDel(RECOVERIES, [key]);
    }
    const result = await tx.exec();
    executed = true;
    if (!result?.length)
      throw Error('Settings changed during deletion. Refresh and retry.');
  } finally {
    if (!executed) await tx.unwatch();
  }
}

export async function requestSeriesDeletion(
  id: string,
  revision: number,
  who: Identity,
  confirmation: string,
  deletePosts: boolean
) {
  if (!who.admin)
    throw Error('Only moderators can permanently delete a series.');
  const options = await deletionSettings();
  await change((cfg) => {
    if (cfg.revision !== revision)
      throw Error('Settings changed. Refresh before deleting.');
    const series = requireSeries(cfg, id, who, true);
    if (!series.archived)
      throw Error('Archive this series before deleting it.');
    if (series.deletion)
      throw Error('This series already has a deletion request.');
    if (confirmation !== series.label)
      throw Error('Type the exact series display name to confirm.');
    series.enabled = false;
    series.deletion = {
      token: randomUUID(),
      deletePosts,
      dueAt: new Date(
        Date.now() + (deletePosts ? options.cooldownDays * 86400000 : 0)
      ).toISOString(),
      state: deletePosts ? 'waiting' : 'deleting',
      scanMonth: 0,
    };
  });
}

export async function controlSeriesDeletion(
  id: string,
  revision: number,
  who: Identity,
  action: 'cancel' | 'retry'
) {
  if (!who.admin) throw Error('Only moderators can manage series deletion.');
  await change((cfg) => {
    if (cfg.revision !== revision)
      throw Error('Settings changed. Refresh first.');
    const series = requireSeries(cfg, id, who, true);
    const job = series.deletion;
    if (!job) throw Error('No deletion request exists.');
    if (action === 'cancel') {
      if (job.state !== 'waiting' || Date.now() >= Date.parse(job.dueAt))
        throw Error(
          'The cooldown has ended. Deletion can no longer be cancelled.'
        );
      delete series.deletion;
    } else {
      if (job.state !== 'failed')
        throw Error('Only a failed deletion can be retried.');
      job.state = 'deleting';
      delete job.error;
    }
  });
}

export async function deletionPreview(id: string, key: string, who: Identity) {
  const series = requireSeries(await config(), id, who, true);
  if (!who.admin && !(await deletionSettings()).allowMaintainers)
    throw Error('Maintainer post deletion is disabled in app settings.');
  if (series.deletion) throw Error('This series has a deletion request.');
  if (!key.startsWith(`crew:post:${id}:`))
    throw Error('Choose a post from this series.');
  const record = await publicationStore.read(key);
  if (!record?.postId || !['posted', 'deleting'].includes(record.status))
    throw Error('Choose a recorded published post.');
  const post = await ownPost(record.postId);
  return {
    title: post.title,
    postId: record.postId,
    date: key.slice(`crew:post:${id}:`.length, `crew:post:${id}:`.length + 10),
  };
}
async function ownPost(id: string) {
  if (!/^t3_[a-z0-9]+$/.test(id)) throw Error('Invalid recorded post ID.');
  const post = await reddit.getPostById(id as `t3_${string}`);
  if (
    post.id !== id ||
    post.subredditName.toLowerCase() !== context.subredditName.toLowerCase() ||
    !['check-in-crew', '[deleted]'].includes(post.authorName.toLowerCase())
  )
    throw Error('The recorded post does not belong to this app and community.');
  return post;
}
async function erasePost(id: string, key: string) {
  const record = await publicationStore.read(key);
  if (!record || record.status === 'deleted') return;
  if (!record.postId || !['posted', 'deleting'].includes(record.status))
    throw Error(
      'A pending or uncertain publication needs recovery before bulk deletion can finish.'
    );
  // Persist intent before Reddit deletion; retries are safe if Reddit succeeded but saving failed.
  await publicationStore.write(key, { ...record, status: 'deleting' });
  const post = await ownPost(record.postId);
  if (post.authorName.toLowerCase() !== '[deleted]') await post.delete();
  const slotId = key.slice(`crew:post:${id}:`.length);
  await change(
    (cfg) => {
      const series = cfg.series.find((s) => s.id === id);
      if (!series) throw Error('Series no longer exists.');
      delete series.postOverrides?.[slotId];
      delete series.overrideSlots?.[slotId];
    },
    { seriesId: id, slotId },
    {
      key,
      record: {
        status: 'deleted',
        at: record.at,
        actor: '',
        postId: record.postId,
      },
    }
  );
}
export async function deleteIndividualPost(
  id: string,
  key: string,
  who: Identity,
  revision: number,
  confirmation: string,
  postId: string
) {
  if (confirmation !== 'DELETE')
    throw Error('Type DELETE to confirm permanent post deletion.');
  return withLease(id, async () => {
    if ((await config()).revision !== revision)
      throw Error('Settings changed. Preview deletion again.');
    const target = await deletionPreview(id, key, who);
    if (target.postId !== postId)
      throw Error('The publication changed. Preview deletion again.');
    await erasePost(id, key);
  });
}

export async function processSeriesDeletions(now = new Date()) {
  // One series per tick, bounded discovery and deletion batches.
  const series = (await config()).series.find(
    (s) =>
      s.deletion &&
      s.deletion.state !== 'failed' &&
      Date.parse(s.deletion.dueAt) <= now.getTime()
  );
  if (!series?.deletion) return;
  const id = series.id,
    token = series.deletion.token;
  await withLease(id, async () => {
    const update = async (run: (s: Series) => void) =>
      change((cfg) => {
        const s = cfg.series.find((s) => s.id === id);
        if (!s?.archived || s.deletion?.token !== token)
          throw Error('Deletion request changed.');
        run(s);
      });
    try {
      await update((s) => {
        s.deletion!.state = 'deleting';
      });
      const job = (await config()).series.find((s) => s.id === id)!.deletion!;
      // Older builds indexed by month only. Scan the full supported date range,
      // including future posts published manually, so none are silently omitted.
      if (job.scanMonth < 1200) {
        const end = Math.min(job.scanMonth + 60, 1200);
        for (let n = job.scanMonth; n < end; n++) {
          const month = `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
          const index = await redis.hGetAll(`crew:history:${id}:${month}`);
          const keys = Object.keys(index).filter((k) =>
            k.startsWith(`crew:post:${id}:`)
          );
          if (keys.length)
            await redis.hSet(
              workKey(id),
              Object.fromEntries(keys.map((k) => [k, month]))
            );
        }
        await update((s) => {
          s.deletion!.scanMonth = end;
        });
        return;
      }
      const work = await redis.hGetAll(workKey(id));
      for (const key of Object.keys(work).slice(0, 10)) {
        if (job.deletePosts) await erasePost(id, key);
        else {
          const p = await publicationStore.read(key);
          if (
            p?.status === 'pending' &&
            now.getTime() - Date.parse(p.at) < 600000
          )
            throw Error(
              'A publication is still in progress. Retry after ten minutes.'
            );
        }
        // Keep records until every Reddit deletion has succeeded, for visible partial failures.
        await redis.hDel(workKey(id), [key]);
      }
      if (Object.keys(await redis.hGetAll(workKey(id))).length) return;
      // Cleanup is resumable too; erase each monthly index and its publications in bounded batches.
      if (job.scanMonth < 2400) {
        const end = Math.min(job.scanMonth + 60, 2400);
        let erased = 0;
        for (let n = job.scanMonth - 1200; n < end - 1200; n++) {
          const month = `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
          const indexKey = `crew:history:${id}:${month}`;
          const index = await redis.hGetAll(indexKey);
          for (const key of Object.keys(index)) {
            if (erased >= 50) {
              await update((s) => {
                s.deletion!.scanMonth = n + 1200;
              });
              return;
            }
            if (key.startsWith(`crew:post:${id}:`)) await redis.del(key);
            await redis.hDel(indexKey, [key]);
            erased++;
          }
          await redis.del(indexKey);
        }
        await update((s) => {
          s.deletion!.scanMonth = end;
        });
        return;
      }
      await change(
        (cfg) => {
          if (cfg.series.find((s) => s.id === id)?.deletion?.token !== token)
            throw Error('Deletion request changed.');
          cfg.series = cfg.series.filter((s) => s.id !== id);
        },
        { seriesId: id }
      );
      await redis.del(workKey(id));
    } catch (error) {
      await update((s) => {
        s.deletion!.state = 'failed';
        s.deletion!.error =
          error instanceof Error
            ? error.message
            : 'Deletion failed. Retry after checking publication history.';
      });
    }
  });
}
