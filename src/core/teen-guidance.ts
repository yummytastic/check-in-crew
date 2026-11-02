// Teenage weight-loss guidance: shared configuration and the optional
// "flair the post when another moderator applies the guidance removal reason"
// automation. Reddit, Redis and logging are passed in so the decision logic
// can be tested without the Devvit runtime.

export const TEEN_GUIDANCE_KEY = 'crew:teen-guidance:v1';

export type TeenGuidanceConfig = {
  removalReasonId: string;
  flairTemplateId: string;
  messageOverride: string;
  autoApprove: boolean;
  /** Off unless explicitly enabled, including for existing installations. */
  flairOnModeratorRemoval: boolean;
};

export const defaultTeenGuidance: TeenGuidanceConfig = {
  removalReasonId: '',
  flairTemplateId: '',
  messageOverride: '',
  autoApprove: true,
  flairOnModeratorRemoval: false,
};

export function parseTeenGuidance(
  raw: string | null | undefined
): TeenGuidanceConfig {
  if (!raw) return { ...defaultTeenGuidance };
  try {
    const value = JSON.parse(raw) as Partial<TeenGuidanceConfig>;
    return {
      removalReasonId:
        typeof value.removalReasonId === 'string' ? value.removalReasonId : '',
      flairTemplateId:
        typeof value.flairTemplateId === 'string' ? value.flairTemplateId : '',
      messageOverride:
        typeof value.messageOverride === 'string' ? value.messageOverride : '',
      autoApprove: value.autoApprove !== false,
      flairOnModeratorRemoval: value.flairOnModeratorRemoval === true,
    };
  } catch {
    return { ...defaultTeenGuidance };
  }
}

const normaliseTitle = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The moderation log shows an applied reason as "<position>: <title>", e.g.
 * "2: Teenage Weightloss Guidance". The position depends on each community's
 * reason order, so only the title is compared. The prefix is optional.
 */
export function reasonTextMatchesTitle(
  logText: string | undefined,
  title: string
): boolean {
  if (!logText || !title.trim()) return false;
  const withoutPosition = logText.replace(/^\s*\d+\s*:\s*/, '');
  return normaliseTitle(withoutPosition) === normaliseTitle(title);
}

const modActionKey = (id: string | undefined) =>
  (id ?? '')
    .trim()
    .replace(/^ModAction_/i, '')
    .toLowerCase();

/**
 * True only for the same moderator action. The log uses "ModAction_<uuid>";
 * the prefix is ignored in case the trigger reports the bare ID. There is
 * deliberately no fallback on the target post: an earlier action on the same
 * post may carry a different reason.
 */
export function sameModAction(
  a: string | undefined,
  b: string | undefined
): boolean {
  const key = modActionKey(a);
  return key !== '' && key === modActionKey(b);
}

export function findModAction<T extends { id?: string | undefined }>(
  entries: T[],
  actionId: string
): T | undefined {
  return entries.find((entry) => sameModAction(entry.id, actionId));
}

export type ModActionEvent = {
  id?: string | undefined;
  action?: string | undefined;
  actionedAt?: string | Date | undefined;
  subreddit?: { name?: string | undefined } | undefined;
  moderator?: { name?: string | undefined } | undefined;
  targetPost?: { id?: string | undefined } | undefined;
  targetComment?: { id?: string | undefined } | undefined;
};

export type RemovalReasonLogEntry = {
  id?: string | undefined;
  moderatorName?: string | undefined;
  createdAt?: string | Date | undefined;
  description?: string | undefined;
  details?: string | undefined;
  target?: { id?: string | undefined } | undefined;
};

/** What identifies the log entry for one moderator action. */
export type LogLookup = {
  actionId?: string | undefined;
  postId: string;
  moderatorName?: string | undefined;
  /** The event's actionedAt when given; otherwise when it was received. */
  referenceTime: number;
  /** Whether referenceTime is the action's own time (a tighter window). */
  exactTime: boolean;
};

export type LogSelection =
  | { entry: RemovalReasonLogEntry; method: 'action-id' | 'time-window' }
  | { entry?: undefined; method: 'none' | 'ambiguous' };

// With the action's own time, the entry is within seconds of it. Without it,
// the action happened shortly before the trigger was received.
const EXACT_WINDOW_MS = 15_000;
const RECEIVED_WINDOW_BEFORE_MS = 90_000;
const RECEIVED_WINDOW_AFTER_MS = 5_000;

/**
 * Picks the log entry for one action. With an action ID only that exact entry
 * counts. Reddit can omit the ID, so otherwise an entry must be for the same
 * post, by the same moderator when known, inside a short time window, and the
 * only such entry; two candidates are ambiguous and nothing is chosen.
 */
export function selectLogEntry(
  entries: RemovalReasonLogEntry[],
  lookup: LogLookup
): LogSelection {
  if (modActionKey(lookup.actionId)) {
    const entry = findModAction(entries, lookup.actionId!);
    return entry ? { entry, method: 'action-id' } : { method: 'none' };
  }
  const from =
    lookup.referenceTime -
    (lookup.exactTime ? EXACT_WINDOW_MS : RECEIVED_WINDOW_BEFORE_MS);
  const to =
    lookup.referenceTime +
    (lookup.exactTime ? EXACT_WINDOW_MS : RECEIVED_WINDOW_AFTER_MS);
  const candidates = entries.filter((entry) => {
    if (entry.target?.id !== lookup.postId) return false;
    if (
      lookup.moderatorName &&
      !sameName(entry.moderatorName, lookup.moderatorName)
    )
      return false;
    const at = entry.createdAt ? new Date(entry.createdAt).getTime() : NaN;
    return Number.isFinite(at) && at >= from && at <= to;
  });
  if (candidates.length > 1) return { method: 'ambiguous' };
  return candidates[0]
    ? { entry: candidates[0], method: 'time-window' }
    : { method: 'none' };
}

export type RemovalReasonFlairDeps = {
  subredditName: string;
  readConfig(): Promise<TeenGuidanceConfig>;
  appUsername(): Promise<string | undefined>;
  removalReasons(): Promise<{ id: string; title?: string | undefined }[]>;
  flairTemplates(): Promise<{ id: string }[]>;
  /**
   * The moderation-log entry for this action (the trigger omits the reason),
   * chosen with selectLogEntry. A time-window match should be confirmed on a
   * second read so a newer entry still reaching the log makes it ambiguous.
   */
  findLogEntry(lookup: LogLookup): Promise<LogSelection>;
  /** When the trigger was received, for events without actionedAt. */
  now?(): number;
  getPost(postId: string): Promise<{
    subredditName: string;
    flairTemplateId?: string | undefined;
  }>;
  setPostFlair(postId: string, flairTemplateId: string): Promise<void>;
  log(
    outcome: RemovalReasonFlairOutcome,
    details: Record<string, unknown>
  ): void;
};

export type RemovalReasonFlairOutcome =
  | 'ignored'
  | 'disabled'
  | 'comment-target'
  | 'missing-post'
  | 'log-entry-ambiguous'
  | 'other-subreddit'
  | 'app-action'
  | 'not-configured'
  | 'reason-missing'
  | 'flair-missing'
  | 'duplicate-reason-title'
  | 'log-entry-not-found'
  | 'log-target-mismatch'
  | 'different-reason'
  | 'post-other-subreddit'
  | 'already-flaired'
  | 'flaired';

const sameName = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Sets the configured post flair when another moderator applies the configured
 * teen-guidance removal reason to a post. Only ever sets post flair. Repeat
 * deliveries are harmless: a post already carrying the template is left alone.
 * Logs IDs, an outcome code and which log field matched; never usernames,
 * guidance text or the log entry's text.
 */
export async function flairPostForRemovalReason(
  event: ModActionEvent,
  deps: RemovalReasonFlairDeps
): Promise<RemovalReasonFlairOutcome> {
  // Every moderator action reaches this handler; leave unrelated ones quietly.
  if (event.action !== 'addremovalreason') return 'ignored';
  const config = await deps.readConfig();
  if (!config.flairOnModeratorRemoval) {
    // Logged (IDs only) so a playtest can tell "off" from "not delivered".
    deps.log('disabled', { actionId: event.id });
    return 'disabled';
  }

  const postId = event.targetPost?.id ?? '';
  const ids = { actionId: event.id, postId: postId || undefined };
  const skip = (
    outcome: RemovalReasonFlairOutcome,
    extra: Record<string, unknown> = {}
  ) => {
    deps.log(outcome, { ...ids, ...extra });
    return outcome;
  };

  // A reason on a comment can also name the containing post; never flair it.
  if (event.targetComment?.id) return skip('comment-target');
  if (!/^t3_[A-Za-z0-9]+$/.test(postId)) return skip('missing-post');
  if (
    event.subreddit?.name &&
    !sameName(event.subreddit.name, deps.subredditName)
  )
    return skip('other-subreddit');

  const app = await deps.appUsername();
  if (sameName(event.moderator?.name, app)) return skip('app-action');

  if (!config.removalReasonId || !config.flairTemplateId)
    return skip('not-configured');
  const [reasons, flairs] = await Promise.all([
    deps.removalReasons(),
    deps.flairTemplates(),
  ]);
  const reason = reasons.find((item) => item.id === config.removalReasonId);
  if (!reason?.title?.trim()) return skip('reason-missing');
  if (!flairs.some((item) => item.id === config.flairTemplateId))
    return skip('flair-missing');
  // The log identifies a reason only by title, so a shared title is ambiguous.
  if (
    reasons.filter(
      (item) =>
        item.title &&
        normaliseTitle(item.title) === normaliseTitle(reason.title!)
    ).length > 1
  )
    return skip('duplicate-reason-title');

  const actionedAt = event.actionedAt
    ? new Date(event.actionedAt).getTime()
    : NaN;
  const exactTime = Number.isFinite(actionedAt);
  const selection = await deps.findLogEntry({
    actionId: event.id,
    postId,
    moderatorName: event.moderator?.name || undefined,
    referenceTime: exactTime ? actionedAt : (deps.now?.() ?? Date.now()),
    exactTime,
  });
  if (selection.method === 'ambiguous')
    return skip('log-entry-ambiguous', { exactTime });
  const entry = selection.entry;
  if (!entry) return skip('log-entry-not-found', { exactTime });
  const matchMethod = selection.method;
  if (entry.target?.id && entry.target.id !== postId)
    return skip('log-target-mismatch', { matchMethod });
  if (sameName(entry.moderatorName, app)) return skip('app-action');
  // Record which field held the reason, never its contents.
  const matchedField = reasonTextMatchesTitle(entry.details, reason.title)
    ? 'details'
    : reasonTextMatchesTitle(entry.description, reason.title)
      ? 'description'
      : undefined;
  if (!matchedField) return skip('different-reason', { matchMethod });

  const post = await deps.getPost(postId);
  if (!sameName(post.subredditName, deps.subredditName))
    return skip('post-other-subreddit');
  if (post.flairTemplateId === config.flairTemplateId)
    return skip('already-flaired');
  await deps.setPostFlair(postId, config.flairTemplateId);
  return skip('flaired', { matchedField, matchMethod });
}
