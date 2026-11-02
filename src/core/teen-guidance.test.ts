import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findModAction,
  flairPostForRemovalReason,
  parseTeenGuidance,
  selectLogEntry,
  type LogLookup,
  reasonTextMatchesTitle,
  type ModActionEvent,
  type RemovalReasonFlairDeps,
  type RemovalReasonLogEntry,
  type TeenGuidanceConfig,
} from './teen-guidance.ts';

const NOW = Date.parse('2026-11-02T18:34:30Z');
const secondsAgo = (seconds: number) =>
  new Date(NOW - seconds * 1000).toISOString();

const enabled: TeenGuidanceConfig = {
  removalReasonId: 'reason-teen',
  flairTemplateId: 'flair-teen',
  messageOverride: '',
  autoApprove: true,
  flairOnModeratorRemoval: true,
};

const event = (overrides: Partial<ModActionEvent> = {}): ModActionEvent => ({
  id: 'ModAction_1',
  action: 'addremovalreason',
  subreddit: { name: 'loseit_test' },
  moderator: { name: 'Yummytastic' },
  targetPost: { id: 't3_post' },
  ...overrides,
});

function harness(
  options: {
    config?: Partial<TeenGuidanceConfig>;
    reasons?: { id: string; title?: string }[];
    flairs?: { id: string }[];
    entry?: RemovalReasonLogEntry | undefined;
    /** The whole moderation log; overrides `entry`. */
    log?: RemovalReasonLogEntry[];
    post?: { subredditName: string; flairTemplateId?: string };
    app?: string;
  } = {}
) {
  const calls = {
    setFlair: [] as string[],
    logs: [] as { outcome: string; details: Record<string, unknown> }[],
    reddit: 0,
    lookups: [] as LogLookup[],
  };
  const post = options.post ?? {
    subredditName: 'loseit_test',
    flairTemplateId: 'flair-other',
  };
  const deps: RemovalReasonFlairDeps = {
    subredditName: 'loseit_test',
    readConfig: async () => ({ ...enabled, ...options.config }),
    appUsername: async () => {
      calls.reddit++;
      return options.app ?? 'check-in-crew';
    },
    removalReasons: async () => {
      calls.reddit++;
      return (
        options.reasons ?? [
          { id: 'reason-other', title: 'Rule 1: Be kind' },
          { id: 'reason-teen', title: 'Teenage Weightloss Guidance' },
        ]
      );
    },
    flairTemplates: async () => {
      calls.reddit++;
      return options.flairs ?? [{ id: 'flair-teen' }, { id: 'flair-other' }];
    },
    now: () => NOW,
    findLogEntry: async (lookup) => {
      calls.reddit++;
      const log =
        options.log ??
        ('entry' in options
          ? options.entry
            ? [options.entry]
            : []
          : [
              {
                id: 'ModAction_1',
                moderatorName: 'Yummytastic',
                details: '2: Teenage Weightloss Guidance',
                target: { id: 't3_post' },
              },
            ]);
      calls.lookups.push(lookup);
      return selectLogEntry(log, lookup);
    },
    getPost: async () => {
      calls.reddit++;
      return { ...post };
    },
    setPostFlair: async (postId, templateId) => {
      calls.setFlair.push(`${postId}:${templateId}`);
      post.flairTemplateId = templateId;
    },
    log: (outcome, details) => calls.logs.push({ outcome, details }),
  };
  return { deps, calls };
}

void test('teen guidance config keeps automation off unless explicitly enabled', () => {
  assert.equal(parseTeenGuidance(undefined).flairOnModeratorRemoval, false);
  const existing = JSON.stringify({
    removalReasonId: 'r',
    flairTemplateId: 'f',
    messageOverride: '',
    autoApprove: true,
  });
  assert.equal(parseTeenGuidance(existing).flairOnModeratorRemoval, false);
  assert.equal(parseTeenGuidance(existing).autoApprove, true);
  assert.equal(
    parseTeenGuidance(JSON.stringify({ flairOnModeratorRemoval: 'yes' }))
      .flairOnModeratorRemoval,
    false
  );
  assert.equal(
    parseTeenGuidance(JSON.stringify({ flairOnModeratorRemoval: true }))
      .flairOnModeratorRemoval,
    true
  );
  assert.equal(parseTeenGuidance('{not json').flairOnModeratorRemoval, false);
});

void test('log reason text matches the title with or without a position prefix', () => {
  const title = 'Teenage Weightloss Guidance';
  assert.ok(reasonTextMatchesTitle('2: Teenage Weightloss Guidance', title));
  assert.ok(reasonTextMatchesTitle('7: Teenage Weightloss Guidance', title));
  assert.ok(reasonTextMatchesTitle('Teenage Weightloss Guidance', title));
  assert.ok(
    reasonTextMatchesTitle(' 12 :  teenage  weightloss guidance ', title)
  );
  assert.ok(!reasonTextMatchesTitle('2: Teenage Weightloss', title));
  assert.ok(
    !reasonTextMatchesTitle('2: Teenage Weightloss Guidance extra', title)
  );
  assert.ok(!reasonTextMatchesTitle(undefined, title));
  assert.ok(!reasonTextMatchesTitle('2: ', ''));
});

void test('log entries match only the exact action, with or without the ModAction_ prefix', () => {
  const log = [{ id: 'ModAction_abc-123' }, { id: 'ModAction_def-456' }];
  assert.equal(findModAction(log, 'ModAction_abc-123'), log[0]);
  assert.equal(findModAction(log, 'abc-123'), log[0]);
  assert.equal(findModAction(log, 'ModAction_ABC-123'), log[0]);
  assert.equal(findModAction(log, 'ModAction_zzz'), undefined);
  assert.equal(findModAction(log, ''), undefined);
  assert.equal(findModAction(log, 'ModAction_'), undefined);
  assert.equal(findModAction([{ id: undefined }], ''), undefined);
});

void test('a new different reason never borrows an earlier teen-guidance entry on the same post', async () => {
  const earlierTeenGuidance = {
    id: 'ModAction_earlier',
    moderatorName: 'Yummytastic',
    details: '2: Teenage Weightloss Guidance',
    target: { id: 't3_post' },
  };
  // The newer action has not reached the log yet.
  const lagging = harness({ log: [earlierTeenGuidance] });
  assert.equal(
    await flairPostForRemovalReason(
      event({ id: 'ModAction_newer' }),
      lagging.deps
    ),
    'log-entry-not-found'
  );
  // Once it appears, its own (different) reason is what counts.
  const arrived = harness({
    log: [
      {
        id: 'ModAction_newer',
        moderatorName: 'Yummytastic',
        details: '1: Rule 1: Be kind',
        target: { id: 't3_post' },
      },
      earlierTeenGuidance,
    ],
  });
  assert.equal(
    await flairPostForRemovalReason(
      event({ id: 'ModAction_newer' }),
      arrived.deps
    ),
    'different-reason'
  );
  assert.equal(
    lagging.calls.setFlair.length + arrived.calls.setFlair.length,
    0
  );
});

void test('without an action ID, a lone entry for the same post, moderator and moment matches', async () => {
  const teen = (overrides: Partial<RemovalReasonLogEntry> = {}) => ({
    id: 'ModAction_live',
    moderatorName: 'Yummytastic',
    details: '2: Teenage Weightloss Guidance',
    target: { id: 't3_post' },
    createdAt: secondsAgo(3),
    ...overrides,
  });
  // Reddit omitted the ID; the receipt time bounds the search.
  const received = harness({ log: [teen()] });
  assert.equal(
    await flairPostForRemovalReason(event({ id: undefined }), received.deps),
    'flaired'
  );
  assert.equal(received.calls.lookups[0]?.exactTime, false);
  assert.equal(received.calls.logs.at(-1)?.details.matchMethod, 'time-window');
  // With actionedAt, the window is centred on the action itself.
  const timed = harness({ log: [teen({ createdAt: secondsAgo(62) })] });
  assert.equal(
    await flairPostForRemovalReason(
      event({ id: '', actionedAt: secondsAgo(60) }),
      timed.deps
    ),
    'flaired'
  );
  assert.equal(timed.calls.lookups[0]?.exactTime, true);
});

void test('without an action ID, older, foreign or ambiguous entries never match', async () => {
  const entry = (overrides: Partial<RemovalReasonLogEntry>) => ({
    id: 'ModAction_x',
    moderatorName: 'Yummytastic',
    details: '2: Teenage Weightloss Guidance',
    target: { id: 't3_post' },
    createdAt: secondsAgo(3),
    ...overrides,
  });
  const cases: [string, RemovalReasonLogEntry[], string][] = [
    // The review scenario: an earlier teen-guidance entry on the same post
    // while the newer (different) action has not reached the log.
    [
      'older entry',
      [entry({ createdAt: secondsAgo(600) })],
      'log-entry-not-found',
    ],
    [
      'another moderator',
      [entry({ moderatorName: 'SomeoneElse' })],
      'log-entry-not-found',
    ],
    [
      'another post',
      [entry({ target: { id: 't3_other' } })],
      'log-entry-not-found',
    ],
    ['no timestamp', [entry({ createdAt: undefined })], 'log-entry-not-found'],
    [
      'two reasons moments apart',
      [
        entry({
          id: 'ModAction_a',
          details: '1: Rule 1: Be kind',
          createdAt: secondsAgo(2),
        }),
        entry({ id: 'ModAction_b', createdAt: secondsAgo(8) }),
      ],
      'log-entry-ambiguous',
    ],
  ];
  for (const [name, log, outcome] of cases) {
    const { deps, calls } = harness({ log });
    assert.equal(
      await flairPostForRemovalReason(event({ id: undefined }), deps),
      outcome,
      name
    );
    assert.equal(calls.setFlair.length, 0, name);
  }
});

void test('log selection windows: exact time ±15s, receipt time 90s before to 5s after', () => {
  const at = (iso: string) => ({
    id: 'ModAction_1',
    target: { id: 't3_post' },
    createdAt: iso,
  });
  const base = { postId: 't3_post', referenceTime: NOW };
  const pick = (iso: string, exactTime: boolean) =>
    selectLogEntry([at(iso)], { ...base, exactTime }).method;
  assert.equal(pick(secondsAgo(15), true), 'time-window');
  assert.equal(pick(secondsAgo(-15), true), 'time-window');
  assert.equal(pick(secondsAgo(16), true), 'none');
  assert.equal(pick(secondsAgo(90), false), 'time-window');
  assert.equal(pick(secondsAgo(91), false), 'none');
  assert.equal(pick(secondsAgo(-5), false), 'time-window');
  assert.equal(pick(secondsAgo(-6), false), 'none');
  // An action ID, when present, is the only thing that counts.
  assert.equal(
    selectLogEntry([at(secondsAgo(1))], {
      ...base,
      exactTime: true,
      actionId: 'ModAction_other',
    }).method,
    'none'
  );
  assert.equal(
    selectLogEntry([at(secondsAgo(600))], {
      ...base,
      exactTime: true,
      actionId: 'ModAction_1',
    }).method,
    'action-id'
  );
});

void test('diagnostic logs never include the log entry text', async () => {
  const marker = 'GUIDANCE TEXT THAT MUST NOT BE LOGGED';
  for (const entry of [
    {
      id: 'ModAction_1',
      details: `2: Teenage Weightloss Guidance`,
      description: marker,
      target: { id: 't3_post' },
    },
    { id: 'ModAction_1', details: marker, target: { id: 't3_post' } },
    { id: 'ModAction_1', details: marker, target: { id: 't1_other' } },
  ]) {
    const { deps, calls } = harness({ entry });
    await flairPostForRemovalReason(event(), deps);
    assert.ok(calls.logs.length > 0);
    assert.doesNotMatch(JSON.stringify(calls.logs), /MUST NOT BE LOGGED/);
  }
});

void test('another moderator applying the reason to a post sets the flair', async () => {
  const { deps, calls } = harness();
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.deepEqual(calls.setFlair, ['t3_post:flair-teen']);
  // Diagnosis uses IDs, the outcome and which log field matched.
  assert.deepEqual(calls.logs, [
    {
      outcome: 'flaired',
      details: {
        actionId: 'ModAction_1',
        postId: 't3_post',
        matchedField: 'details',
        matchMethod: 'action-id',
      },
    },
  ]);
});

void test('the reason title can come from the log description instead', async () => {
  const { deps, calls } = harness({
    entry: {
      id: 'ModAction_1',
      description: 'Teenage Weightloss Guidance',
      target: { id: 't3_post' },
    },
  });
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.equal(calls.setFlair.length, 1);
  assert.equal(calls.logs[0]?.details.matchedField, 'description');
});

void test('a post carrying another flair has it replaced', async () => {
  const { deps, calls } = harness({
    post: { subredditName: 'loseit_test', flairTemplateId: 'flair-other' },
  });
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.deepEqual(calls.setFlair, ['t3_post:flair-teen']);
});

void test('a post with no flair receives it', async () => {
  const { deps, calls } = harness({ post: { subredditName: 'loseit_test' } });
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.equal(calls.setFlair.length, 1);
});

void test('a post already carrying the selected flair is left alone', async () => {
  const { deps, calls } = harness({
    post: { subredditName: 'loseit_test', flairTemplateId: 'flair-teen' },
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'already-flaired'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('duplicate deliveries flair once', async () => {
  const { deps, calls } = harness();
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'already-flaired'
  );
  assert.deepEqual(calls.setFlair, ['t3_post:flair-teen']);
});

void test('a removal reason on a comment never flairs the containing post', async () => {
  const { deps, calls } = harness();
  assert.equal(
    await flairPostForRemovalReason(
      event({ targetComment: { id: 't1_comment' } }),
      deps
    ),
    'comment-target'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('a log entry for a different item is not trusted', async () => {
  const { deps, calls } = harness({
    entry: {
      id: 'ModAction_1',
      details: '2: Teenage Weightloss Guidance',
      target: { id: 't1_comment' },
    },
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'log-target-mismatch'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('a different removal reason does nothing', async () => {
  const { deps, calls } = harness({
    entry: {
      id: 'ModAction_1',
      details: '1: Rule 1: Be kind',
      target: { id: 't3_post' },
    },
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'different-reason'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('duplicate reason titles are ambiguous and skipped', async () => {
  const { deps, calls } = harness({
    reasons: [
      { id: 'reason-teen', title: 'Teenage Weightloss Guidance' },
      { id: 'reason-copy', title: 'teenage weightloss  guidance' },
    ],
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'duplicate-reason-title'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test("the app's own removal-reason action is ignored", async () => {
  const byEvent = harness();
  assert.equal(
    await flairPostForRemovalReason(
      event({ moderator: { name: 'Check-In-Crew' } }),
      byEvent.deps
    ),
    'app-action'
  );
  const byLog = harness({
    entry: {
      id: 'ModAction_1',
      moderatorName: 'check-in-crew',
      details: '2: Teenage Weightloss Guidance',
      target: { id: 't3_post' },
    },
  });
  assert.equal(
    await flairPostForRemovalReason(
      event({ moderator: undefined }),
      byLog.deps
    ),
    'app-action'
  );
  assert.equal(byEvent.calls.setFlair.length + byLog.calls.setFlair.length, 0);
});

void test('unrelated moderator actions and a disabled setting make no Reddit calls', async () => {
  const unrelated = harness();
  assert.equal(
    await flairPostForRemovalReason(
      event({ action: 'removelink' }),
      unrelated.deps
    ),
    'ignored'
  );
  const disabled = harness({ config: { flairOnModeratorRemoval: false } });
  assert.equal(
    await flairPostForRemovalReason(event(), disabled.deps),
    'disabled'
  );
  for (const { calls } of [unrelated, disabled]) {
    assert.equal(calls.reddit, 0);
    assert.equal(calls.setFlair.length, 0);
  }
  // Unrelated actions stay silent; a removal reason while off is logged by ID.
  assert.equal(unrelated.calls.logs.length, 0);
  assert.deepEqual(disabled.calls.logs, [
    { outcome: 'disabled', details: { actionId: 'ModAction_1' } },
  ]);
});

void test('missing or foreign event fields are skipped', async () => {
  for (const [input, outcome] of [
    [event({ targetPost: undefined }), 'missing-post'],
    [event({ targetPost: { id: '' } }), 'missing-post'],
    [event({ targetPost: { id: 't1_comment' } }), 'missing-post'],
    [event({ subreddit: { name: 'loseit' } }), 'other-subreddit'],
  ] as const) {
    const { deps, calls } = harness();
    assert.equal(await flairPostForRemovalReason(input, deps), outcome);
    assert.equal(calls.setFlair.length, 0);
  }
});

void test('missing or stale configuration is skipped', async () => {
  const cases: [Parameters<typeof harness>[0], string][] = [
    [{ config: { removalReasonId: '' } }, 'not-configured'],
    [{ config: { flairTemplateId: '' } }, 'not-configured'],
    [{ reasons: [{ id: 'reason-other', title: 'Rule 1' }] }, 'reason-missing'],
    [{ flairs: [{ id: 'flair-other' }] }, 'flair-missing'],
  ];
  for (const [options, outcome] of cases) {
    const { deps, calls } = harness(options);
    assert.equal(await flairPostForRemovalReason(event(), deps), outcome);
    assert.equal(calls.setFlair.length, 0);
  }
});

void test('a missing log entry or a post from elsewhere is skipped', async () => {
  const noEntry = harness({ entry: undefined });
  assert.equal(
    await flairPostForRemovalReason(event(), noEntry.deps),
    'log-entry-not-found'
  );
  const elsewhere = harness({ post: { subredditName: 'loseit' } });
  assert.equal(
    await flairPostForRemovalReason(event(), elsewhere.deps),
    'post-other-subreddit'
  );
  assert.equal(
    noEntry.calls.setFlair.length + elsewhere.calls.setFlair.length,
    0
  );
});
