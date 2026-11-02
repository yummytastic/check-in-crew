import { reddit, redis } from '@devvit/web/server';
import { config, publicationStore } from './service.ts';

const DAY_MS = 24 * 60 * 60_000;
const SWEEP_KEY = 'crew:thread-lock:sweep';
const SWEEP_INTERVAL_MS = 55 * 60_000;
const MAX_LOCKS_PER_SWEEP = 50;
// Longer than the scan window below, so a thread is never revisited.
const LOCKED_RETENTION_MS = 150 * DAY_MS;

const lockedKey = (publicationKey: string) =>
  `crew:thread-lock:done:${publicationKey}`;

/** Months (YYYY-MM) from `from` to `to`, inclusive. */
function monthsBetween(from: Date, to: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)
  );
  while (cursor <= to) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Locks published threads once they are older than their series'
 * "lock after" setting. Runs at most hourly from the scheduler. Each thread is
 * handled once, tracked in its own key rather than by rewriting publication
 * records (which deletion may be changing), so a thread a moderator unlocks
 * on Reddit is never locked again. Only recent history is scanned: turning
 * the setting on does not lock very old threads.
 */
export async function lockOldThreads(now = new Date()): Promise<number> {
  const claimed = await redis.set(SWEEP_KEY, now.toISOString(), {
    nx: true,
    expiration: new Date(now.getTime() + SWEEP_INTERVAL_MS),
  });
  if (!claimed) return 0;
  let locked = 0;
  for (const series of (await config()).series) {
    const days = series.lockAfterDays ?? 0;
    if (!days || series.archived) continue;
    // Month keys are local dates; a few spare days cover timezone edges.
    const from = new Date(now.getTime() - (days + 40) * DAY_MS);
    for (const month of monthsBetween(from, now)) {
      const keys = Object.keys(
        await redis.hGetAll(`crew:history:${series.id}:${month}`)
      );
      for (const key of keys) {
        if (locked >= MAX_LOCKS_PER_SWEEP) return locked;
        const record = await publicationStore.read(key);
        if (record?.status !== 'posted' || !record.postId) continue;
        if (now.getTime() - Date.parse(record.at) < days * DAY_MS) continue;
        if (await redis.get(lockedKey(key))) continue;
        try {
          const post = await reddit.getPostById(
            record.postId as `t3_${string}`
          );
          if (!post.locked) await post.lock();
          locked++;
        } catch (error) {
          // A removed or deleted post cannot be locked; do not retry hourly.
          console.error('Could not lock old thread', record.postId, error);
        }
        await redis.set(lockedKey(key), now.toISOString(), {
          expiration: new Date(now.getTime() + LOCKED_RETENTION_MS),
        });
      }
    }
  }
  return locked;
}
