import { context, reddit, redis, settings } from '@devvit/web/server';
import type { Publication, Series, Slot } from './model.ts';

export const ALERT_SETTING = 'alertFailedPosts';
const PENDING_STUCK_MS = 15 * 60_000;
const ALERT_RETENTION_MS = 40 * 24 * 60 * 60_000;
// Two consecutive scheduler ticks (5 minutes apart) must fail before alerting;
// a single failure is usually a brief race with a settings edit.
const FAILURES_BEFORE_ALERT = 2;
const FAILURE_WINDOW_MS = 15 * 60_000;

export type PublicationProblem =
  | { kind: 'uncertain' }
  | { kind: 'stuck' }
  | { kind: 'failed'; message: string };

/** The problem a publication record shows, if any. */
export function recordProblem(
  record: Publication | undefined,
  now: Date
): PublicationProblem | undefined {
  if (record?.status === 'uncertain') return { kind: 'uncertain' };
  if (
    record?.status === 'pending' &&
    now.getTime() - Date.parse(record.at) > PENDING_STUCK_MS
  )
    return { kind: 'stuck' };
  return undefined;
}

const kindLabel: Record<string, string> = {
  signup: 'start post',
  daily: 'check-in',
  roundup: 'finish post',
};

export function alertMessage(
  series: Pick<Series, 'label'>,
  slot: Pick<Slot, 'date' | 'kind'>,
  problem: PublicationProblem
) {
  const what = `${series.label || 'A series'} — ${kindLabel[slot.kind] ?? slot.kind} for ${slot.date}`;
  const detail =
    problem.kind === 'failed'
      ? `Scheduled posting failed on repeated attempts: ${problem.message.slice(0, 200)}`
      : problem.kind === 'uncertain'
        ? 'Reddit did not confirm the post. It may or may not have been created, so Check-In Crew will not retry automatically.'
        : 'The post has been waiting for confirmation for over 15 minutes. It may or may not have been created.';
  return {
    subject: 'Check-In Crew: a scheduled post may be missing',
    bodyMarkdown: [
      `**${what}**`,
      detail,
      'To resolve it: open **Check-In Crew → View publication history**. If the post exists on Reddit, use **Fix a missing publication record**. If it does not, clear the attempt there and use **Post now** from the dashboard, or wait for the next scheduled post.',
      '_You can turn these alerts off in the app settings (General → Alert moderators about missing scheduled posts)._',
    ].join('\n\n'),
  };
}

async function alertsEnabled() {
  return (await settings.get(ALERT_SETTING)) !== false;
}

/** Sends at most one modmail notification per publication. */
async function sendOnce(
  key: string,
  series: Series,
  slot: Slot,
  problem: PublicationProblem
) {
  if (!(await alertsEnabled())) return;
  const claimed = await redis.set(`crew:alert:sent:${key}`, '1', {
    nx: true,
    expiration: new Date(Date.now() + ALERT_RETENTION_MS),
  });
  if (!claimed) return;
  try {
    await reddit.modMail.createModNotification({
      ...alertMessage(series, slot, problem),
      subredditId: context.subredditId as `t5_${string}`,
    });
  } catch (error) {
    // Allow a later tick to try again rather than losing the alert.
    await redis.del(`crew:alert:sent:${key}`);
    throw error;
  }
}

/** After a scheduler attempt returned a record: alert if it shows a problem. */
export async function checkPublication(
  key: string,
  series: Series,
  slot: Slot,
  record: Publication | undefined,
  now = new Date()
) {
  if (record?.status === 'posted') {
    await redis.del(`crew:alert:failures:${key}`);
    return;
  }
  const problem = recordProblem(record, now);
  if (problem) await sendOnce(key, series, slot, problem);
}

/** After a scheduler attempt threw: alert once failures repeat. */
export async function recordFailure(
  key: string,
  series: Series,
  slot: Slot,
  record: Publication | undefined,
  error: unknown,
  now = new Date()
) {
  const problem = recordProblem(record, now);
  if (problem) return sendOnce(key, series, slot, problem);
  const counter = `crew:alert:failures:${key}`;
  const failures = await redis.incrBy(counter, 1);
  await redis.expire(counter, FAILURE_WINDOW_MS / 1000);
  if (failures >= FAILURES_BEFORE_ALERT)
    await sendOnce(key, series, slot, {
      kind: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
}
