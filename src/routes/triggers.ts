import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnModActionRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import {
  TEEN_GUIDANCE_KEY,
  flairPostForRemovalReason,
  sameModAction,
  selectLogEntry,
  type LogLookup,
  type LogSelection,
  parseTeenGuidance,
  type RemovalReasonFlairDeps,
  type RemovalReasonLogEntry,
} from '../core/teen-guidance.ts';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>(
    {
      status: 'success',
    },
    200
  );
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log('App upgraded in subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>(
    {
      status: 'success',
    },
    200
  );
});

const LOG_LOOKUP_DELAYS_MS = [0, 1000, 2000, 4000];

async function findRemovalReasonEntry(
  lookup: LogLookup
): Promise<LogSelection> {
  // The trigger payload has no reason text; the moderation-log entry does.
  // The log can lag the trigger, so read it a few times. A time-window match
  // (used when Reddit omits the action ID) must still be the only candidate
  // on a later read, so a newer entry for the same post makes it ambiguous.
  let latest: RemovalReasonLogEntry[] = [];
  let pending: RemovalReasonLogEntry | undefined;
  for (const delay of LOG_LOOKUP_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    latest = await reddit
      .getModerationLog({
        subredditName: context.subredditName,
        type: 'addremovalreason',
        limit: 25,
      })
      .all();
    const selection = selectLogEntry(latest, lookup);
    if (selection.method === 'action-id' || selection.method === 'ambiguous')
      return selection;
    if (selection.method === 'time-window') {
      if (pending && sameModAction(pending.id, selection.entry.id))
        return selection;
      pending = selection.entry;
    } else if (pending) {
      // The candidate disappeared from view: do not trust it.
      pending = undefined;
    }
  }
  // IDs and times only: shows whether the entry was missing or mismatched.
  console.log(
    'Teen guidance flair: action not matched in moderation log',
    JSON.stringify({
      actionId: lookup.actionId,
      postId: lookup.postId,
      referenceTime: new Date(lookup.referenceTime).toISOString(),
      exactTime: lookup.exactTime,
      recentEntries: latest.slice(0, 5).map((item) => ({
        id: item.id,
        targetId: item.target?.id,
        createdAt: item.createdAt
          ? new Date(item.createdAt).toISOString()
          : undefined,
      })),
    })
  );
  return { method: 'none' };
}

const removalReasonFlairDeps = (): RemovalReasonFlairDeps => ({
  subredditName: context.subredditName,
  readConfig: async () => parseTeenGuidance(await redis.get(TEEN_GUIDANCE_KEY)),
  appUsername: async () => (await reddit.getAppUser())?.username,
  removalReasons: async () =>
    (
      await reddit.getSubredditByName(context.subredditName)
    ).getRemovalReasons(),
  flairTemplates: () => reddit.getPostFlairTemplates(context.subredditName),
  findLogEntry: findRemovalReasonEntry,
  getPost: async (postId) => {
    const post = await reddit.getPostById(postId as `t3_${string}`);
    return {
      subredditName: post.subredditName,
      flairTemplateId: post.flair?.templateId,
    };
  },
  setPostFlair: async (postId, flairTemplateId) => {
    await reddit.setPostFlair({
      subredditName: context.subredditName,
      postId: postId as `t3_${string}`,
      flairTemplateId,
    });
  },
  log: (outcome, details) =>
    console.log('Teen guidance flair:', outcome, JSON.stringify(details)),
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();
  try {
    await flairPostForRemovalReason(input, removalReasonFlairDeps());
  } catch (error) {
    console.error(
      'Teen guidance flair failed',
      JSON.stringify({ actionId: input.id, postId: input.targetPost?.id }),
      error
    );
  }
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});
