import { reddit, redis } from '@devvit/web/server';
import { config, publicationStore } from './service.ts';

const DAY_MS = 24 * 60 * 60_000;
const SWEEP_KEY = 'crew:thread-lock:sweep';
const SWEEP_INTERVAL_MS = 55 * 60_000;
// Attempts (successful or not) per sweep, so failures cannot make it long.
const MAX_ATTEMPTS_PER_SWEEP = 50;
// A temporary Reddit error is retried on later sweeps; a post that keeps
// failing (e.g. deleted) is given up on rather than retried for months.
const MAX_FAILED_ATTEMPTS = 5;
// Longer than the scan window below, so a thread is never revisited.
const LOCKED_RETENTION_MS = 150 * DAY_MS;

const lockedKey = (publicationKey: string) =>
  `crew:thread-lock:done:${publicationKey}`;
const failuresKey = (publicationKey: string) =>
  `crew:thread-lock:failures:${publicationKey}`;

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
 * "lock after" setting. Runs at most hourly from the scheduler. A thread is
 * marked done only once locked (or found already locked); failures are
 * retried on later sweeps, up to a limit. Done threads are tracked in their
 * own key rather than by rewriting publication
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
  let attempts = 0;
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
        if (attempts >= MAX_ATTEMPTS_PER_SWEEP) return locked;
        const record = await publicationStore.read(key);
        if (record?.status !== 'posted' || !record.postId) continue;
        if (now.getTime() - Date.parse(record.at) < days * DAY_MS) continue;
        if (await redis.get(lockedKey(key))) continue;
        attempts++;
        const markDone = () =>
          redis.set(lockedKey(key), now.toISOString(), {
            expiration: new Date(now.getTime() + LOCKED_RETENTION_MS),
          });
        try {
          const post = await reddit.getPostById(
            record.postId as `t3_${string}`
          );
          // Done only once locked, or confirmed already locked.
          if (!post.locked) await post.lock();
          await markDone();
          await redis.del(failuresKey(key));
          locked++;
        } catch (error) {
          const failures = await redis.incrBy(failuresKey(key), 1);
          await redis.expire(failuresKey(key), LOCKED_RETENTION_MS / 1000);
          if (failures >= MAX_FAILED_ATTEMPTS) {
            console.error(
              'Giving up locking old thread after repeated failures',
              record.postId,
              error
            );
            await markDone();
            await redis.del(failuresKey(key));
          } else
            console.error(
              'Could not lock old thread; will retry',
              record.postId,
              failures,
              error
            );
        }
      }
    }
  }
  return locked;
}
