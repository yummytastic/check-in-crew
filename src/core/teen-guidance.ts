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
  subreddit?: { name?: string | undefined } | undefined;
  moderator?: { name?: string | undefined } | undefined;
  targetPost?: { id?: string | undefined } | undefined;
  targetComment?: { id?: string | undefined } | undefined;
};

export type RemovalReasonLogEntry = {
  id?: string | undefined;
  moderatorName?: string | undefined;
  description?: string | undefined;
  details?: string | undefined;
  target?: { id?: string | undefined } | undefined;
};

export type RemovalReasonFlairDeps = {
  subredditName: string;
  readConfig(): Promise<TeenGuidanceConfig>;
  appUsername(): Promise<string | undefined>;
  removalReasons(): Promise<{ id: string; title?: string | undefined }[]>;
  flairTemplates(): Promise<{ id: string }[]>;
  /**
   * The moderation-log entries to search for this exact action; the trigger
   * omits the reason. Called again (after a delay) while the action is absent.
   */
  findLogEntry(actionId: string): Promise<RemovalReasonLogEntry | undefined>;
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
  | 'missing-action-id'
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
  // The exact action is the only safe link to its removal reason.
  if (!modActionKey(event.id)) return skip('missing-action-id');
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

  const entry = await deps.findLogEntry(event.id!);
  if (!entry || !sameModAction(entry.id, event.id))
    return skip('log-entry-not-found');
  if (entry.target?.id && entry.target.id !== postId)
    return skip('log-target-mismatch');
  if (sameName(entry.moderatorName, app)) return skip('app-action');
  // Record which field held the reason, never its contents.
  const matchedField = reasonTextMatchesTitle(entry.details, reason.title)
    ? 'details'
    : reasonTextMatchesTitle(entry.description, reason.title)
      ? 'description'
      : undefined;
  if (!matchedField) return skip('different-reason');

  const post = await deps.getPost(postId);
  if (!sameName(post.subredditName, deps.subredditName))
    return skip('post-other-subreddit');
  if (post.flairTemplateId === config.flairTemplateId)
    return skip('already-flaired');
  await deps.setPostFlair(postId, config.flairTemplateId);
  return skip('flaired', { matchedField });
}
